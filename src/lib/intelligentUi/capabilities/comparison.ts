import { z } from "zod";
import type { ComparisonDefinition, JsonObject } from "../types";
import {
  base,
  finite,
  finiteValue,
  id,
  items,
  knownStrings,
  provenance,
  text,
} from "./shared";
export const comparisonSchema = z.object({
  ...base,
  kind: z.literal("comparison"),
  props: z.object({
    columns: z
      .array(z.object({ key: id, label: text }))
      .min(1)
      .refine(
        (columns) =>
          new Set(columns.map((column) => column.key)).size === columns.length,
      ),
    items: items(
      z.object({
        id,
        label: text,
        values: z.record(id, z.union([z.string(), finite, z.boolean()])),
      }),
    ),
    provenance,
  }),
});
export interface ComparisonState extends JsonObject {
  selected: string[];
  filter: string;
  sortKey: string;
  descending: boolean;
  numericFilterKey: string;
  min: number | "";
  max: number | "";
}
export function initialComparison(): ComparisonState {
  return {
    selected: [],
    filter: "",
    sortKey: "",
    descending: false,
    numericFilterKey: "",
    min: "",
    max: "",
  };
}
export function normalizeComparison(
  definition: ComparisonDefinition,
  state: JsonObject,
): ComparisonState {
  const columns = definition.props.columns.map((column) => column.key);
  return {
    selected: knownStrings(
      state.selected,
      definition.props.items.map((item) => item.id),
    ),
    filter: typeof state.filter === "string" ? state.filter : "",
    sortKey:
      typeof state.sortKey === "string" && columns.includes(state.sortKey)
        ? state.sortKey
        : "",
    descending: state.descending === true,
    numericFilterKey:
      typeof state.numericFilterKey === "string" &&
      columns.includes(state.numericFilterKey)
        ? state.numericFilterKey
        : "",
    min: finiteValue(state.min) ?? "",
    max: finiteValue(state.max) ?? "",
  };
}
export function deriveComparison(
  definition: ComparisonDefinition,
  input: JsonObject,
) {
  const state = normalizeComparison(definition, input);
  const numericColumns = definition.props.columns.filter((column) =>
    definition.props.items.some(
      (item) => typeof item.values[column.key] === "number",
    ),
  );
  const items = definition.props.items
    .filter((item) =>
      [item.label, ...Object.values(item.values)]
        .join(" ")
        .toLowerCase()
        .includes(state.filter.toLowerCase()),
    )
    .filter((item) => {
      if (!state.numericFilterKey || (state.min === "" && state.max === ""))
        return true;
      const value = item.values[state.numericFilterKey];
      return (
        typeof value === "number" &&
        (state.min === "" || value >= state.min) &&
        (state.max === "" || value <= state.max)
      );
    })
    .sort((a, b) => {
      const left = a.values[state.sortKey],
        right = b.values[state.sortKey];
      const result =
        typeof left === "number" && typeof right === "number"
          ? left - right
          : String(left ?? a.label).localeCompare(String(right ?? b.label));
      return state.descending ? -result : result;
    });
  return { state, items, numericColumns };
}
export const comparisonCapability = {
  schema: comparisonSchema,
  initial: initialComparison,
  normalize: normalizeComparison,
  derive: deriveComparison,
  prompt:
    'comparison: props {columns:[{key,label}],items:[{id,label,values:{columnKey:value}}],provenance:"user"|"source"|"example"}.',
};
