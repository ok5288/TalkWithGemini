"use client";

import React, { useId } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/primitives";
import MarkdownRenderer from "@/components/content/MarkdownRenderer";
import {
  deriveFlashcards,
  deriveQuiz,
  moveFlashcard,
  rateFlashcard,
  restartQuiz,
  submitQuiz,
} from "@/lib/intelligentUi/catalog";
import type {
  FlashcardsDefinition,
  JsonObject,
  QuizDefinition,
} from "@/lib/intelligentUi/types";

interface LearningProps<D> {
  definition: D;
  state: JsonObject;
  onChange: (state: JsonObject) => void;
}
export function QuizUi({
  definition,
  state,
  onChange,
}: LearningProps<QuizDefinition>) {
  const t = useTranslations("IntelligentUi"),
    prefix = useId();
  const result = deriveQuiz(definition, state);
  const current = result.state;
  return (
    <div className="space-y-4">
      {result.questions.map((question) => (
        <fieldset
          key={question.id}
          className="space-y-2"
          disabled={current.submitted}
        >
          <legend className="mb-2 font-medium">{question.prompt}</legend>
          {question.options.map((option) => (
            <label key={option.id} className="flex items-start gap-2 text-sm">
              <input
                className="mt-1 accent-red-600"
                type={question.multiple ? "checkbox" : "radio"}
                name={`${prefix}-${question.id}`}
                checked={
                  current.answers[question.id]?.includes(option.id) ?? false
                }
                onChange={() => {
                  const selected = current.answers[question.id] ?? [];
                  let next = [option.id];
                  if (question.multiple)
                    next = selected.includes(option.id)
                      ? selected.filter((id) => id !== option.id)
                      : [...selected, option.id];
                  onChange({
                    ...current,
                    answers: { ...current.answers, [question.id]: next },
                  });
                }}
              />
              <span>{option.label}</span>
            </label>
          ))}
          {current.submitted && (
            <p className="text-sm text-muted-foreground">
              {question.explanation}
            </p>
          )}
        </fieldset>
      ))}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          disabled={!result.canSubmit}
          onClick={() => onChange(submitQuiz(definition, current))}
        >
          {t("grade")}
        </Button>
        {current.submitted && (
          <>
            <Button
              size="sm"
              variant="secondary"
              disabled={!result.incorrectIds.length}
              onClick={() =>
                onChange(restartQuiz(definition, current, "incorrect"))
              }
            >
              {t("retryIncorrect")}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => onChange(restartQuiz(definition, current, "all"))}
            >
              {t("retryAll")}
            </Button>
          </>
        )}
      </div>
      {current.submitted && (
        <div role="status" className="space-y-1">
          <p>
            {t("score", {
              count: result.score,
              total: result.questions.length,
            })}
          </p>
          <p>
            {t("latestScore", {
              count: result.latestScore,
              total: definition.props.questions.length,
            })}
          </p>
          {!result.incorrectIds.length && <p>{t("allCorrect")}</p>}
        </div>
      )}
    </div>
  );
}

export function FlashcardsUi({
  definition,
  state,
  onChange,
}: LearningProps<FlashcardsDefinition>) {
  const t = useTranslations("IntelligentUi");
  const result = deriveFlashcards(definition, state);
  const current = result.state;
  return (
    <div className="space-y-4">
      <p role="status" className="text-sm text-muted-foreground">
        {t("knownProgress", {
          count: result.knownCount,
          total: definition.props.cards.length,
        })}
      </p>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={current.review === "unmastered"}
          onChange={(event) =>
            onChange({
              ...current,
              review: event.target.checked ? "unmastered" : "all",
              revealed: false,
            })
          }
        />
        {t("reviewUnmastered")}
      </label>
      {result.current ? (
        <>
          <p className="text-sm">
            {t("cardProgress", {
              count: result.index + 1,
              total: result.cards.length,
            })}
          </p>
          <div className="min-w-0 overflow-x-auto rounded-md border border-border p-4">
            <MarkdownRenderer content={result.current.front} readOnly />
            {current.revealed && (
              <div className="mt-4 border-t border-border pt-4">
                <MarkdownRenderer content={result.current.back} readOnly />
              </div>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              disabled={result.index <= 0}
              onClick={() => onChange(moveFlashcard(definition, current, -1))}
            >
              {t("previousCard")}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={result.index >= result.cards.length - 1}
              onClick={() => onChange(moveFlashcard(definition, current, 1))}
            >
              {t("nextCard")}
            </Button>
            <Button
              size="sm"
              disabled={current.revealed}
              onClick={() => onChange({ ...current, revealed: true })}
            >
              {t("showAnswer")}
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              disabled={!current.revealed}
              onClick={() =>
                onChange(rateFlashcard(definition, current, "known"))
              }
            >
              {t("known")}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={!current.revealed}
              onClick={() =>
                onChange(rateFlashcard(definition, current, "again"))
              }
            >
              {t("again")}
            </Button>
          </div>
        </>
      ) : (
        <p role="status">{t("allMastered")}</p>
      )}
    </div>
  );
}
