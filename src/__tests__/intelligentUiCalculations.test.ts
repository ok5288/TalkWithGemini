import { describe, it, expect } from "vitest";
import { calculateUi } from "@/lib/intelligentUi/calculations";
import type { CalculatorDefinition } from "@/lib/intelligentUi/types";
const run = (
  operation: CalculatorDefinition["props"]["operation"],
  values: number[],
) =>
  calculateUi(
    {
      version: 1,
      kind: "calculator",
      title: "x",
      summary: "x",
      props: {
        operation,
        inputs: values.map((value, i) => ({
          id: String(i),
          label: String(i),
          value,
        })),
      },
    },
    {},
  );
describe("host calculations", () => {
  it("supports arithmetic and scale", () => {
    expect(run("add", [2, 3]).value).toBe(5);
    expect(run("subtract", [5, 3]).value).toBe(2);
    expect(run("multiply", [2, 3]).value).toBe(6);
    expect(run("divide", [6, 3]).value).toBe(2);
    expect(run("scale", [10, 2, 5]).value).toBe(25);
  });
  it("distributes currency remainders exactly", () => {
    expect(run("split", [100, 3]).values).toEqual([33.34, 33.33, 33.33]);
  });
  it("computes weighted scores", () => {
    expect(run("weighted", [80, 1, 100, 3]).value).toBe(95);
  });
  it("rejects invalid operations", () => {
    for (const [operation, values] of [
      ["divide", [1, 0]],
      ["split", [1, 0]],
      ["weighted", [1, 0]],
      ["weighted", [1, -1]],
      ["scale", [1, 0, 2]],
      ["add", [Infinity]],
    ] as const) {
      expect(run(operation, [...values]).error).toBeTruthy();
    }
  });

  it("rejects unsafe intermediate results before cancellation can hide loss", () => {
    expect(
      run("subtract", [Number.MAX_SAFE_INTEGER, -2, Number.MAX_SAFE_INTEGER])
        .error,
    ).toBe("unsafeNumber");
    expect(run("scale", [Number.MAX_SAFE_INTEGER, 1, 2]).error).toBe(
      "unsafeNumber",
    );
    expect(
      run("scale", [
        Number.MAX_SAFE_INTEGER,
        Number.MAX_SAFE_INTEGER,
        Number.MAX_SAFE_INTEGER,
      ]).value,
    ).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("rounds split amounts in decimal minor units", () => {
    expect(run("split", [1.005, 1]).values).toEqual([1.01]);
    expect(run("split", [1.005, 2]).values).toEqual([0.51, 0.5]);
  });
});

it("retains invalid persisted operands instead of substituting defaults", () => {
  const definition: CalculatorDefinition = {
    version: 1,
    kind: "calculator",
    title: "Sum",
    summary: "Sum",
    props: {
      operation: "add",
      inputs: [
        { id: "a", label: "A", value: 2 },
        { id: "b", label: "B", value: 3 },
      ],
    },
  };
  for (const value of [null, "", false, [], {}])
    expect(calculateUi(definition, { values: { a: value } })).toEqual({
      error: "finite",
    });
  expect(calculateUi(definition, { values: {} })).toEqual({ value: 5 });
});
