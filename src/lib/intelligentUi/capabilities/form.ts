import { z } from "zod";
import { isWithinNumericBounds } from "./numeric";
import type {
  FormDefinition,
  JsonObject,
  JsonValue,
  UiFormField,
} from "../types";
import { base, bounds, id, items, record, text, validBounds } from "./shared";
export type FormError = "required" | "invalidField" | "fieldRange";
export function validateFormValue(
  field: UiFormField,
  value: JsonValue | undefined,
): FormError | null {
  if (value === undefined) return field.required ? "required" : null;
  if (value === null) return "invalidField";
  if (field.type === "checkbox") {
    if (typeof value !== "boolean") return "invalidField";
    return field.required && !value ? "required" : null;
  }
  if (field.type === "text") {
    if (typeof value !== "string") return "invalidField";
    return field.required && value === "" ? "required" : null;
  }
  if (field.type === "number" || field.type === "range") {
    if (value === "") return field.required ? "required" : null;
    if (typeof value !== "number" || !Number.isFinite(value))
      return "invalidField";
    if (!isWithinNumericBounds(value, field)) return "fieldRange";
    return null;
  }
  const allowed = field.options?.map((option) => option.value) ?? [];
  if (field.type === "select") {
    if (value === "") return field.required ? "required" : null;
    return typeof value === "string" && allowed.includes(value)
      ? null
      : "invalidField";
  }
  if (Array.isArray(value) && value.length === 0)
    return field.required ? "required" : null;
  return Array.isArray(value) &&
    value.every((item) => typeof item === "string" && allowed.includes(item)) &&
    new Set(value).size === value.length
    ? null
    : "invalidField";
}
const fieldSchema = z
  .object({
    id,
    label: text,
    type: z.enum([
      "text",
      "number",
      "select",
      "multiselect",
      "range",
      "checkbox",
    ]),
    required: z.boolean().optional(),
    options: z.array(z.object({ value: id, label: text })).optional(),
    ...bounds,
    defaultValue: z
      .union([
        z.string(),
        z.number().finite(),
        z.boolean(),
        z.array(z.string()),
      ])
      .optional(),
  })
  .refine((field) => {
    if (!validBounds(field)) return false;
    if (
      field.options &&
      new Set(field.options.map((option) => option.value)).size !==
        field.options.length
    )
      return false;
    if (
      (field.type === "select" || field.type === "multiselect") &&
      !field.options?.length
    )
      return false;
    if (field.defaultValue !== undefined) {
      if (
        (field.type === "number" || field.type === "range") &&
        typeof field.defaultValue !== "number"
      )
        return false;
      if (
        field.type === "select" &&
        !field.options?.some((option) => option.value === field.defaultValue)
      )
        return false;
    }
    return (
      field.defaultValue === undefined ||
      validateFormValue({ ...field, required: false }, field.defaultValue) ===
        null
    );
  });
export const formSchema = z.object({
  ...base,
  kind: z.literal("form"),
  props: z.object({ fields: items(fieldSchema) }),
});
export interface FormState extends JsonObject {
  values: JsonObject;
}
export function initialForm(definition: FormDefinition): FormState {
  return {
    values: Object.fromEntries(
      definition.props.fields.map((field) => {
        let value: JsonValue = "";
        if (field.type === "checkbox") value = false;
        else if (field.type === "multiselect") value = [];
        else if (field.type === "number" || field.type === "range")
          value = field.min ?? Math.min(field.max ?? 0, 0);
        return [field.id, structuredClone(field.defaultValue ?? value)];
      }),
    ),
  };
}
export function normalizeForm(
  definition: FormDefinition,
  state: JsonObject,
): FormState {
  const values = record(state.values),
    initial = initialForm(definition).values;
  return {
    values: Object.fromEntries(
      definition.props.fields.map((field) => [
        field.id,
        Object.hasOwn(values, field.id) ? values[field.id] : initial[field.id],
      ]),
    ),
  };
}
export function getFormErrors(
  definition: FormDefinition,
  state: JsonObject,
): Record<string, FormError> {
  const { values } = normalizeForm(definition, state);
  const errors: Record<string, FormError> = {};
  for (const field of definition.props.fields) {
    const error = validateFormValue(field, values[field.id]);
    if (error) errors[field.id] = error;
  }
  return errors;
}
export const formCapability = {
  schema: formSchema,
  initial: initialForm,
  normalize: normalizeForm,
  validate: getFormErrors,
  prompt:
    'form: props {fields:[{id,label,type:"text"|"number"|"select"|"multiselect"|"range"|"checkbox",required?,options?:[{value,label}],min?,max?,step?,defaultValue?}]}; defaults must match type, options and bounds.',
};
