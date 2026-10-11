import { z } from "zod";
import type { JsonObject, QuizDefinition } from "../types";
import { base, id, items, knownStrings, record, text } from "./shared";
export const quizSchema = z.object({
  ...base,
  kind: z.literal("quiz"),
  props: z.object({
    questions: items(
      z
        .object({
          id,
          prompt: text,
          options: items(z.object({ id, label: text })),
          answerIds: z.array(id).min(1),
          explanation: text,
          multiple: z.boolean().optional(),
        })
        .refine(
          (question) =>
            new Set(question.answerIds).size === question.answerIds.length &&
            question.answerIds.every((answer) =>
              question.options.some((option) => option.id === answer),
            ) &&
            (question.multiple || question.answerIds.length === 1),
        ),
    ),
  }),
});
export interface QuizState extends JsonObject {
  questionIds: string[];
  answers: Record<string, string[]>;
  submitted: boolean;
  latestAnswers: Record<string, string[]>;
}
export function initialQuiz(definition: QuizDefinition): QuizState {
  return {
    questionIds: definition.props.questions.map((question) => question.id),
    answers: {},
    submitted: false,
    latestAnswers: {},
  };
}
function normalizeAnswers(
  definition: QuizDefinition,
  value: JsonObject,
): Record<string, string[]> {
  return Object.fromEntries(
    definition.props.questions
      .filter((question) => Object.hasOwn(value, question.id))
      .map((question) => {
        const selected = knownStrings(
          value[question.id],
          question.options.map((option) => option.id),
        );
        return [
          question.id,
          question.multiple ? selected : selected.slice(0, 1),
        ];
      }),
  );
}
export function normalizeQuiz(
  definition: QuizDefinition,
  input: JsonObject,
): QuizState {
  const allIds = definition.props.questions.map((question) => question.id);
  const ids =
    input.questionIds === undefined
      ? allIds
      : knownStrings(input.questionIds, allIds);
  const questionIds = ids.length ? ids : allIds;
  const answers = normalizeAnswers(definition, record(input.answers));
  const submitted = input.submitted === true;
  const latestAnswers = normalizeAnswers(
    definition,
    record(input.latestAnswers),
  );
  // Older v1 states saved only answers/submitted. Restore them as an all-question round.
  if (submitted && input.latestAnswers === undefined)
    for (const id of questionIds) latestAnswers[id] = answers[id] ?? [];
  return {
    questionIds,
    answers: Object.fromEntries(
      questionIds
        .filter((id) => Object.hasOwn(answers, id))
        .map((id) => [id, answers[id]]),
    ),
    submitted,
    latestAnswers,
  };
}
export function isQuizAnswerCorrect(
  question: QuizDefinition["props"]["questions"][number],
  answers: string[],
): boolean {
  return (
    answers.length === question.answerIds.length &&
    question.answerIds.every((id) => answers.includes(id))
  );
}
export function deriveQuiz(definition: QuizDefinition, input: JsonObject) {
  const state = normalizeQuiz(definition, input);
  const questions = definition.props.questions.filter((question) =>
    state.questionIds.includes(question.id),
  );
  const score = questions.filter((question) =>
    isQuizAnswerCorrect(question, state.answers[question.id] ?? []),
  ).length;
  const latestScore = definition.props.questions.filter((question) =>
    isQuizAnswerCorrect(question, state.latestAnswers[question.id] ?? []),
  ).length;
  const incorrectIds = definition.props.questions
    .filter(
      (question) =>
        Object.hasOwn(state.latestAnswers, question.id) &&
        !isQuizAnswerCorrect(question, state.latestAnswers[question.id]),
    )
    .map((question) => question.id);
  return {
    state,
    questions,
    score,
    latestScore,
    incorrectIds,
    canSubmit:
      !state.submitted &&
      questions.every(
        (question) => (state.answers[question.id]?.length ?? 0) > 0,
      ),
  };
}
export function submitQuiz(
  definition: QuizDefinition,
  input: JsonObject,
): QuizState {
  const { state, canSubmit } = deriveQuiz(definition, input);
  if (!canSubmit) return state;
  return {
    ...state,
    submitted: true,
    latestAnswers: {
      ...state.latestAnswers,
      ...structuredClone(state.answers),
    },
  };
}
export function restartQuiz(
  definition: QuizDefinition,
  input: JsonObject,
  mode: "incorrect" | "all",
): QuizState {
  const { state, incorrectIds } = deriveQuiz(definition, input);
  if (mode === "incorrect" && !incorrectIds.length) return state;
  return {
    questionIds:
      mode === "all"
        ? definition.props.questions.map((question) => question.id)
        : incorrectIds,
    answers: {},
    submitted: false,
    latestAnswers: state.latestAnswers,
  };
}
export const quizCapability = {
  schema: quizSchema,
  initial: initialQuiz,
  normalize: normalizeQuiz,
  derive: deriveQuiz,
  prompt:
    "quiz: props {questions:[{id,prompt,options:[{id,label}],answerIds:[optionId],explanation,multiple?}]}; unique answer IDs must belong to options. Retry and grading are local.",
};
