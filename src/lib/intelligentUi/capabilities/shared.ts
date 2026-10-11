import { z } from "zod";
import type { JsonObject, JsonValue } from "../types";
export const text = z.string().min(1);
export const id = text.refine(
  (value) => !["__proto__", "prototype", "constructor"].includes(value),
);
export const finite = z.number().finite();
export const bounds = {
  min: finite.optional(),
  max: finite.optional(),
  step: finite.positive().optional(),
};
export const base = { version: z.literal(1), title: text, summary: text };
export const provenance = z.enum(["user", "source", "example"]);
export function items<T extends z.ZodType<{ id: string }>>(schema: T) {
  return z
    .array(schema)
    .min(1)
    .refine(
      (values) =>
        new Set(values.map((value) => value.id)).size === values.length,
      "IDs must be unique",
    );
}
export function validBounds(value: { min?: number; max?: number }): boolean {
  return (
    value.min === undefined || value.max === undefined || value.min <= value.max
  );
}
export function strings(value: JsonValue | undefined): string[] {
  return Array.isArray(value)
    ? [
        ...new Set(
          value.filter((item): item is string => typeof item === "string"),
        ),
      ]
    : [];
}
export function record(value: JsonValue | undefined): JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}
export function knownStrings(
  value: JsonValue | undefined,
  ids: string[],
): string[] {
  return strings(value).filter((id) => ids.includes(id));
}
export function finiteValue(value: JsonValue | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}
