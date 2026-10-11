import { z } from "zod";
import type { FlashcardsDefinition, JsonObject } from "../types";
import { base, id, items, record, text } from "./shared";
export const flashcardsSchema = z.object({
  ...base,
  kind: z.literal("flashcards"),
  props: z.object({ cards: items(z.object({ id, front: text, back: text })) }),
});
export interface FlashcardsState extends JsonObject {
  currentId: string;
  revealed: boolean;
  review: "all" | "unmastered";
  ratings: Record<string, "known" | "again">;
}
export function initialFlashcards(
  definition: FlashcardsDefinition,
): FlashcardsState {
  return {
    currentId: definition.props.cards[0].id,
    revealed: false,
    review: "all",
    ratings: {},
  };
}
export function normalizeFlashcards(
  definition: FlashcardsDefinition,
  input: JsonObject,
): FlashcardsState {
  const raw = record(input.ratings),
    ratings: FlashcardsState["ratings"] = {};
  for (const card of definition.props.cards) {
    const rating = raw[card.id];
    if (rating === "known" || rating === "again") ratings[card.id] = rating;
  }
  const review = input.review === "unmastered" ? "unmastered" : "all";
  const cards = definition.props.cards.filter(
    (card) => review === "all" || ratings[card.id] !== "known",
  );
  const currentId =
    typeof input.currentId === "string" &&
    cards.some((card) => card.id === input.currentId)
      ? input.currentId
      : (cards[0]?.id ?? "");
  return {
    currentId,
    revealed: currentId === input.currentId && input.revealed === true,
    review,
    ratings,
  };
}
export function deriveFlashcards(
  definition: FlashcardsDefinition,
  input: JsonObject,
) {
  const state = normalizeFlashcards(definition, input);
  const cards = definition.props.cards.filter(
    (card) => state.review === "all" || state.ratings[card.id] !== "known",
  );
  return {
    state,
    cards,
    current: cards.find((card) => card.id === state.currentId),
    index: cards.findIndex((card) => card.id === state.currentId),
    knownCount: Object.values(state.ratings).filter(
      (rating) => rating === "known",
    ).length,
  };
}
export function moveFlashcard(
  definition: FlashcardsDefinition,
  input: JsonObject,
  direction: -1 | 1,
): FlashcardsState {
  const { state, cards, index } = deriveFlashcards(definition, input);
  const next = cards[index + direction];
  return next ? { ...state, currentId: next.id, revealed: false } : state;
}
export function rateFlashcard(
  definition: FlashcardsDefinition,
  input: JsonObject,
  rating: "known" | "again",
): FlashcardsState {
  const { state, current } = deriveFlashcards(definition, input);
  if (!current || !state.revealed) return state;
  return normalizeFlashcards(definition, {
    ...state,
    ratings: { ...state.ratings, [current.id]: rating },
  });
}
export const flashcardsCapability = {
  schema: flashcardsSchema,
  initial: initialFlashcards,
  normalize: normalizeFlashcards,
  derive: deriveFlashcards,
  prompt:
    "flashcards: props {cards:[{id,front,back}]}; front/back use safe Markdown and math. Use stable unique IDs. Reveal, self-rating and unmastered review are local.",
};
