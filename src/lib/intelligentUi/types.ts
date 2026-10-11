import type { ExplorerDefinition } from "./explorer/types";
export type { ExplorerDefinition } from "./explorer/types";
export type JsonValue =
  string | number | boolean | null | JsonValue[] | JsonObject;
export interface JsonObject {
  [key: string]: JsonValue;
}
interface Definition<K extends string, P> {
  version: 1;
  kind: K;
  title: string;
  summary: string;
  props: P;
}
export type ChecklistDefinition = Definition<
  "checklist",
  { items: { id: string; label: string; checked?: boolean }[] }
>;
export type ComparisonDefinition = Definition<
  "comparison",
  {
    columns: { key: string; label: string }[];
    items: {
      id: string;
      label: string;
      values: Record<string, string | number | boolean>;
    }[];
    provenance: "user" | "source" | "example";
  }
>;
export interface UiFormField {
  id: string;
  label: string;
  type: "text" | "number" | "select" | "multiselect" | "range" | "checkbox";
  required?: boolean;
  options?: { value: string; label: string }[];
  min?: number;
  max?: number;
  step?: number;
  defaultValue?: JsonValue;
}
export type FormDefinition = Definition<"form", { fields: UiFormField[] }>;
export type ChartDefinition = Definition<
  "chart",
  {
    charts: { id: string; label: string; source: string }[];
    provenance: "user" | "source" | "example";
  }
>;
export type QuizDefinition = Definition<
  "quiz",
  {
    questions: {
      id: string;
      prompt: string;
      options: { id: string; label: string }[];
      answerIds: string[];
      explanation: string;
      multiple?: boolean;
    }[];
  }
>;
export type CalculatorDefinition = Definition<
  "calculator",
  {
    operation:
      | "add"
      | "subtract"
      | "multiply"
      | "divide"
      | "scale"
      | "split"
      | "weighted";
    inputs: {
      id: string;
      label: string;
      value: number;
      min?: number;
      max?: number;
      step?: number;
    }[];
    precision?: number;
  }
>;
export type FlashcardsDefinition = Definition<
  "flashcards",
  { cards: { id: string; front: string; back: string }[] }
>;
export type NativeDefinition =
  | ChecklistDefinition
  | ComparisonDefinition
  | FormDefinition
  | ChartDefinition
  | QuizDefinition
  | CalculatorDefinition
  | FlashcardsDefinition
  | ExplorerDefinition;
export interface HtmlDefinition {
  version: 1;
  title: string;
  summary: string;
  html: string;
}
export interface IntelligentUiBlock {
  id: string;
  type: "intelligent_ui";
  schemaVersion: 1;
  renderer: "native" | "html";
  definition: NativeDefinition | HtmlDefinition | null;
  definitionRevision: number;
  status: "receiving" | "preview" | "ready" | "failed" | "cancelled";
  fallbackMarkdown: string;
  state: JsonObject;
  stateRevision: number;
  staticSnapshot: string;
  sourceRefs: string[];
  unsupportedPayload?: string;
  /** Explicitly imported user data; never populated from model JSON. */
  dataSnapshot?: import("./explorer/types").ExplorerDataset;
  /** Reference identities only. Re-resolve live access before using content. */
  sourceBindings?: import("./sources/types").UiSourceBinding[];
}
