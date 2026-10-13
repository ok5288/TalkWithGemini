import { isExplorerEnabled } from "./featurePolicy";
import { explorerCapability } from "./capabilities/explorer";
import { deriveExplorer } from "./explorer";
import { z } from "zod";
import type { JsonObject, NativeDefinition } from "./types";
import { checklistCapability } from "./capabilities/checklist";
import { comparisonCapability } from "./capabilities/comparison";
import { formCapability, getFormErrors } from "./capabilities/form";
import { chartCapability } from "./capabilities/chart";
import { quizCapability } from "./capabilities/quiz";
import { calculatorCapability } from "./capabilities/calculator";
import { flashcardsCapability } from "./capabilities/flashcards";
import { calculateUi } from "./calculations";
export const nativeCapabilities = {
  checklist: checklistCapability,
  comparison: comparisonCapability,
  form: formCapability,
  chart: chartCapability,
  quiz: quizCapability,
  calculator: calculatorCapability,
  flashcards: flashcardsCapability,
  explorer: explorerCapability,
} as const;
export const nativeDefinitionSchema = z.union([
  z.discriminatedUnion("kind", [
    checklistCapability.schema,
    comparisonCapability.schema,
    formCapability.schema,
    chartCapability.schema,
    quizCapability.schema,
    calculatorCapability.schema,
    flashcardsCapability.schema,
  ]),
  explorerCapability.schema,
]);
// The directory pairs each discriminant with its own typed implementation. These
// dispatch functions are the JSON persistence seam; renderers use typed derives.
export function getNativeInitialState(
  definition: NativeDefinition,
): JsonObject {
  const capability = nativeCapabilities[definition.kind];
  return (capability.initial as (definition: NativeDefinition) => JsonObject)(
    definition,
  );
}
export function normalizeNativeState(
  definition: NativeDefinition,
  state: JsonObject,
): JsonObject {
  const capability = nativeCapabilities[definition.kind];
  return (
    capability.normalize as (
      definition: NativeDefinition,
      state: JsonObject,
    ) => JsonObject
  )(definition, state);
}
export function hasValidUiInputs(
  definition: NativeDefinition,
  state: JsonObject,
): boolean {
  if (definition.kind === "explorer")
    return deriveExplorer(definition, state).errors.length === 0;
  if (definition.kind === "form")
    return Object.keys(getFormErrors(definition, state)).length === 0;
  if (definition.kind === "calculator")
    return !calculateUi(definition, state).error;
  return true;
}
export function getNativePromptInstructions(): string[] {
  return Object.entries(nativeCapabilities)
    .filter(([kind]) => kind !== "explorer" || isExplorerEnabled())
    .map(([, capability]) => capability.prompt);
}
export { deriveComparison } from "./capabilities/comparison";
export { deriveChart } from "./capabilities/chart";
export { deriveQuiz, submitQuiz, restartQuiz } from "./capabilities/quiz";
export {
  deriveFlashcards,
  moveFlashcard,
  rateFlashcard,
} from "./capabilities/flashcards";
export { getFormErrors } from "./capabilities/form";

export { deriveExplorer } from "./explorer";
