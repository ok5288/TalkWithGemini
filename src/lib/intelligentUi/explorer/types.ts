import type { JsonObject } from "../types";
export type ExplorerCell = string | number | boolean | null;
export interface ExplorerUnit {
  kind: "scalar" | "currency" | "percent" | "quantity";
  code?: string;
  precision?: number;
}
export interface ExplorerColumn {
  id: string;
  label: string;
  type: "text" | "number" | "boolean" | "date";
  unit?: ExplorerUnit;
}
export interface ExplorerDataset {
  id: string;
  version: string;
  columns: ExplorerColumn[];
  rows: { id: string; values: Record<string, ExplorerCell> }[];
}
export interface ExplorerParameter {
  id: string;
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  unit?: ExplorerUnit;
}
export type ExplorerInput =
  | { field: string }
  | { parameter: string }
  | { node: string }
  | { constant: number; unit?: ExplorerUnit };
export type ExplorerOperation =
  | "add"
  | "subtract"
  | "multiply"
  | "divide"
  | "scale"
  | "split"
  | "count"
  | "sum"
  | "min"
  | "max"
  | "average"
  | "weighted";
export interface ExplorerNode {
  id: string;
  label: string;
  stage: "row" | "aggregate" | "scalar";
  operation: ExplorerOperation;
  inputs: ExplorerInput[];
  collection?: "filtered" | "selected";
  unit?: ExplorerUnit;
}
export interface ExplorerDefinition {
  version: 1;
  kind: "explorer";
  title: string;
  summary: string;
  props: {
    dataset:
      | { kind: "inline"; data: ExplorerDataset }
      | { kind: "context"; alias: string; version: string };
    provenance: "user" | "source" | "example";
    parameters: ExplorerParameter[];
    nodes: ExplorerNode[];
    filters?: { field: string; operator: "lte" | "gte"; parameter: string }[];
    chart?: { type: "bar" | "line" | "scatter"; x: string; y: string };
    metrics?: string[];
  };
}
export interface ExplorerState extends JsonObject {
  parameters: JsonObject;
  selected: string[];
  visibleColumns: string[];
  search: string;
  sortKey: string;
  descending: boolean;
  ranges: JsonObject;
}
export interface ExplorerError {
  code: string;
  field?: string;
  row?: string;
}
