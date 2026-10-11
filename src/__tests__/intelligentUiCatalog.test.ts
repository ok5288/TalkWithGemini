import { describe, expect, it } from "vitest";
import { parseNativeDefinition } from "@/lib/intelligentUi/schema";
import { calculateUi } from "@/lib/intelligentUi/calculations";
import { hasValidUiInputs } from "@/lib/intelligentUi/catalog";
import type { FormDefinition } from "@/lib/intelligentUi/types";
const base = { version: 1 as const, title: "Example", summary: "Example" };
describe("native semantic validation regressions", () => {
  it("rejects missing scale operands", () => {
    expect(
      calculateUi(
        {
          ...base,
          kind: "calculator",
          props: {
            operation: "scale",
            inputs: [
              { id: "a", label: "Amount", value: 100 },
              { id: "b", label: "Original", value: 10 },
            ],
          },
        },
        {},
      ).error,
    ).toBeTruthy();
  });
  it("rejects duplicate quiz answer IDs", () => {
    expect(
      parseNativeDefinition({
        ...base,
        kind: "quiz",
        props: {
          questions: [
            {
              id: "q",
              prompt: "Pick",
              multiple: true,
              options: [{ id: "a", label: "A" }],
              answerIds: ["a", "a"],
              explanation: "A",
            },
          ],
        },
      }),
    ).toBeNull();
  });
  it("rejects out-of-option defaults and restored field values", () => {
    const definition: FormDefinition = {
      ...base,
      kind: "form",
      props: {
        fields: [
          {
            id: "f",
            label: "Pick",
            type: "select",
            required: true,
            options: [{ value: "a", label: "A" }],
          },
        ],
      },
    };
    expect(
      parseNativeDefinition({
        ...definition,
        props: {
          fields: [{ ...definition.props.fields[0], defaultValue: "outside" }],
        },
      }),
    ).toBeNull();
    expect(hasValidUiInputs(definition, { values: { f: "outside" } })).toBe(
      false,
    );
  });
});

describe("native state and field constraints", () => {
  const field = {
    id: "f",
    label: "Field",
    type: "select" as const,
    options: [{ value: "a", label: "A" }],
  };
  it("rejects restored invalid choices even when optional", () => {
    const definition: FormDefinition = {
      ...base,
      kind: "form",
      props: { fields: [field] },
    };
    expect(hasValidUiInputs(definition, { values: { f: "outside" } })).toBe(
      false,
    );
  });
  it.each([
    { ...field, options: [] },
    { ...field, options: [field.options[0], field.options[0]] },
    { ...field, type: "multiselect", defaultValue: ["a", "outside"] },
    { ...field, type: "number", defaultValue: "3" },
    { ...field, type: "number", defaultValue: "" },
    { ...field, defaultValue: "" },
    { ...field, type: "text", defaultValue: [] },
    { ...field, type: "checkbox", defaultValue: "" },
    { ...field, type: "number", min: 4, max: 2 },
    { ...field, type: "checkbox", defaultValue: "true" },
    { ...field, type: "number", min: 0, max: 2, step: 1, defaultValue: 0.5 },
  ])("rejects incoherent definitions %#", (invalid) => {
    expect(
      parseNativeDefinition({
        ...base,
        kind: "form",
        props: { fields: [invalid] },
      }),
    ).toBeNull();
  });
  it("validates required checkbox and multi-select values without coercion", () => {
    const definition: FormDefinition = {
      ...base,
      kind: "form",
      props: {
        fields: [
          { ...field, type: "multiselect", required: true },
          { id: "ok", label: "Consent", type: "checkbox", required: true },
        ],
      },
    };
    expect(
      hasValidUiInputs(definition, { values: { f: ["a"], ok: true } }),
    ).toBe(true);
    expect(
      hasValidUiInputs(definition, { values: { f: ["a", "a"], ok: true } }),
    ).toBe(false);
    expect(
      hasValidUiInputs(definition, { values: { f: ["a"], ok: false } }),
    ).toBe(false);
  });
});

it("applies identical bounds and step checks to calculator defaults and restored values", () => {
  const definition = {
    ...base,
    kind: "calculator" as const,
    props: {
      operation: "add" as const,
      inputs: [
        { id: "a", label: "A", value: 0.5, min: 0, step: 1 },
        { id: "b", label: "B", value: 2 },
      ],
    },
  };
  expect(parseNativeDefinition(definition)).toBeNull();
  expect(calculateUi(definition, {})).toEqual({ error: "range" });
  expect(hasValidUiInputs(definition, {})).toBe(false);
  const valid = {
    ...definition,
    props: {
      ...definition.props,
      inputs: [
        { ...definition.props.inputs[0], value: 1 },
        definition.props.inputs[1],
      ],
    },
  };
  expect(parseNativeDefinition(valid)).not.toBeNull();
  expect(calculateUi(valid, { values: { a: 0.5 } })).toEqual({
    error: "range",
  });
  expect(calculateUi(valid, { values: { a: 2 } })).toEqual({ value: 4 });
  const decimal = {
    ...definition,
    props: {
      ...definition.props,
      inputs: [
        { ...definition.props.inputs[0], value: 0.3, min: 0.1, step: 0.1 },
        definition.props.inputs[1],
      ],
    },
  };
  expect(parseNativeDefinition(decimal)).not.toBeNull();
  expect(calculateUi(decimal, {}).value).toBeCloseTo(2.3);
});
