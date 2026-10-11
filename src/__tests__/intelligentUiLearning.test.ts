import { describe, expect, it } from "vitest";
import {
  deriveFlashcards,
  deriveQuiz,
  getNativeInitialState,
  moveFlashcard,
  normalizeNativeState,
  rateFlashcard,
  restartQuiz,
  submitQuiz,
} from "@/lib/intelligentUi/catalog";
import { parseNativeDefinition } from "@/lib/intelligentUi/schema";
import type {
  FlashcardsDefinition,
  QuizDefinition,
} from "@/lib/intelligentUi/types";
const quiz: QuizDefinition = {
  version: 1,
  kind: "quiz",
  title: "Test",
  summary: "Practice",
  props: {
    questions: ["one", "two"].map((id) => ({
      id,
      prompt: id,
      options: [
        { id: "a", label: "A" },
        { id: "b", label: "B" },
      ],
      answerIds: ["a"],
      explanation: "A is correct",
    })),
  },
};
const cards: FlashcardsDefinition = {
  version: 1,
  kind: "flashcards",
  title: "Cards",
  summary: "Learn",
  props: {
    cards: [
      { id: "one", front: "$x$", back: "X" },
      { id: "two", front: "Y?", back: "Y" },
    ],
  },
};
describe("quiz learning state", () => {
  it("restores the old all-question state with latest results", () => {
    const result = deriveQuiz(quiz, {
      answers: { one: ["a"], two: ["b"] },
      submitted: true,
    });
    expect(result.state.questionIds).toEqual(["one", "two"]);
    expect(result.score).toBe(1);
    expect(result.latestScore).toBe(1);
    expect(result.incorrectIds).toEqual(["two"]);
  });
  it("starts only incorrect questions, hides completion, and preserves latest results", () => {
    const submitted = submitQuiz(quiz, { answers: { one: ["a"], two: ["b"] } });
    const retry = restartQuiz(quiz, submitted, "incorrect");
    expect(retry).toMatchObject({
      questionIds: ["two"],
      submitted: false,
      answers: {},
      latestAnswers: { one: ["a"], two: ["b"] },
    });
    const final = submitQuiz(quiz, { ...retry, answers: { two: ["a"] } });
    expect(deriveQuiz(quiz, final)).toMatchObject({
      score: 1,
      latestScore: 2,
      incorrectIds: [],
    });
    expect(submitQuiz(quiz, final)).toEqual(final);
    expect(restartQuiz(quiz, final, "incorrect")).toEqual(final);
  });
  it("restarts all without losing recent results; explicit initial state clears everything", () => {
    const submitted = submitQuiz(quiz, { answers: { one: ["a"], two: ["b"] } });
    expect(restartQuiz(quiz, submitted, "all")).toMatchObject({
      questionIds: ["one", "two"],
      submitted: false,
      latestAnswers: submitted.latestAnswers,
    });
    expect(getNativeInitialState(quiz)).toEqual({
      questionIds: ["one", "two"],
      answers: {},
      submitted: false,
      latestAnswers: {},
    });
  });
  it("rejects scoring unanswered rounds and normalizes unknown identifiers", () => {
    expect(submitQuiz(quiz, { answers: { one: ["a"] } }).submitted).toBe(false);
    const normalized = normalizeNativeState(quiz, {
      questionIds: ["missing"],
      answers: { one: ["fake", "a", "a"], other: ["a"] },
      latestAnswers: { other: ["a"] },
    });
    expect(normalized).toMatchObject({
      questionIds: ["one", "two"],
      answers: { one: ["a"] },
      latestAnswers: {},
    });
  });
});
describe("flashcard learning state", () => {
  it("validates the v1 schema and rejects duplicate card identity", () => {
    expect(parseNativeDefinition(cards)).toEqual(cards);
    expect(
      parseNativeDefinition({
        ...cards,
        props: { cards: [cards.props.cards[0], cards.props.cards[0]] },
      }),
    ).toBeNull();
  });
  it("requires reveal before rating and hides the next answer", () => {
    const initial = getNativeInitialState(cards);
    expect(rateFlashcard(cards, initial, "known").ratings).toEqual({});
    const rated = rateFlashcard(cards, { ...initial, revealed: true }, "known");
    expect(rated.ratings).toEqual({ one: "known" });
    const next = moveFlashcard(cards, rated, 1);
    expect(next).toMatchObject({ currentId: "two", revealed: false });
    expect(moveFlashcard(cards, next, 1)).toEqual(next);
  });
  it("restores current progress and filters learned cards without cross-instance mutation", () => {
    const source = {
      currentId: "one",
      revealed: true,
      review: "unmastered",
      ratings: { one: "known", two: "again", foreign: "known" },
    };
    const result = deriveFlashcards(cards, source);
    expect(result.state).toEqual({
      currentId: "two",
      revealed: false,
      review: "unmastered",
      ratings: { one: "known", two: "again" },
    });
    const learned = rateFlashcard(
      cards,
      { ...result.state, revealed: true },
      "known",
    );
    expect(deriveFlashcards(cards, learned).cards).toEqual([]);
    expect(source.ratings.two).toBe("again");
    expect(getNativeInitialState(cards)).toEqual({
      currentId: "one",
      revealed: false,
      review: "all",
      ratings: {},
    });
  });
});
