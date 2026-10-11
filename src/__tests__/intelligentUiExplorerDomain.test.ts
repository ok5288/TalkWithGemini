import { describe, it, expect } from "vitest";
import {
  explorerSchema,
  EXPLORER_TRAVEL_EXAMPLE,
  deriveExplorer,
  initialExplorer,
  parseExplorerImport,
  explorerDatasetSchema,
  parseExplorerRangeValue,
} from "@/lib/intelligentUi/explorer";
const definition = () => structuredClone(EXPLORER_TRAVEL_EXAMPLE);
describe("explorer domain", () => {
  it("derives the exact travel golden across selection and parameter revisions", () => {
    const d = definition();
    expect(explorerSchema.safeParse(d).success).toBe(true);
    const s = initialExplorer(d);
    s.parameters.budget = 1000;
    expect(deriveExplorer(d, s).rows.map((r) => r.values.total)).toEqual([
      500, 340, 700,
    ]);
    s.parameters.budget = 600;
    s.selected = ["b"];
    let result = deriveExplorer(d, s);
    expect(result.rows.map((r) => r.id)).toEqual(["a", "b"]);
    expect(result.selectedRows[0].values.perPerson).toBe(170);
    s.parameters.nights = 3;
    result = deriveExplorer(d, s);
    expect(result.rows.map((r) => r.id)).toEqual(["b"]);
    expect(result.metrics.selectedTotal).toBe(460);
    expect(result.selectedRows[0].values.perPerson).toBe(230);
    expect(d.props.dataset).toEqual(definition().props.dataset);
  });
  it("rejects cycles, backwards stages, missing arguments and dimension errors", () => {
    for (const modify of [
      (d: ReturnType<typeof definition>) => {
        d.props.nodes[0].inputs[0] = { node: "total" };
      },
      (d: ReturnType<typeof definition>) => {
        d.props.nodes[0].inputs = [];
      },
      (d: ReturnType<typeof definition>) => {
        d.props.nodes[0].inputs[1] = { field: "hotel" };
      },
      (d: ReturnType<typeof definition>) => {
        d.props.nodes[0].inputs[0] = { node: "selectedTotal" };
      },
    ]) {
      const d = definition();
      modify(d);
      expect(explorerSchema.safeParse(d).success).toBe(false);
    }
  });
  it("retains invalid restored inputs without stale computed results", () => {
    const d = definition(),
      s = initialExplorer(d);
    s.parameters.nights = 1.5;
    s.selected = ["missing", "b"];
    const r = deriveExplorer(d, s);
    expect(r.parameterErrors.nights).toBe("invalid_parameter");
    expect(r.state.parameters.nights).toBe(1.5);
    expect(r.state.selected).toEqual(["b"]);
    expect(r.rows).toHaveLength(0);
  });
  it("validates defaults and step relative to min", () => {
    const d = definition();
    d.props.parameters[0] = {
      id: "nights",
      label: "Nights",
      value: 1.5,
      min: 0.5,
      step: 1,
    };
    expect(explorerSchema.safeParse(d).success).toBe(true);
    d.props.parameters[0].value = 1;
    expect(explorerSchema.safeParse(d).success).toBe(false);
  });
  it("keeps empty selected aggregates null and counts zero", () => {
    const d = definition();
    d.props.nodes.push({
      id: "selectedCount",
      label: "Count",
      stage: "aggregate",
      operation: "count",
      inputs: [],
      collection: "selected",
    });
    const r = deriveExplorer(d, {});
    expect(r.metrics.selectedTotal).toBeNull();
    expect(r.metrics.selectedCount).toBe(0);
  });
  it("does not trust context aliases without host resolution", () => {
    const d = definition();
    d.props.dataset = { kind: "context", alias: "file", version: "v1" };
    expect(deriveExplorer(d, {}).errors).toContainEqual({
      code: "unresolved_dataset",
    });
  });
  it("preserves leading zeros, quoted CSV, nulls and import type errors", () => {
    const result = parseExplorerImport(
      'code,name,value\n001,"A, B",2\n002,C,',
      "csv",
    );
    expect(result.errors).toEqual([]);
    expect(result.dataset?.columns[0].type).toBe("text");
    expect(result.dataset?.rows[0].values).toEqual({
      c1: "001",
      c2: "A, B",
      c3: 2,
    });
    expect(result.dataset?.rows[1].values.c3).toBeNull();
    expect(
      parseExplorerImport("x\nno", "csv", { c1: "number" }).dataset,
    ).toBeNull();
    expect(
      parseExplorerImport('x\n"unfinished', "csv").errors.length,
    ).toBeGreaterThan(0);
  });
  it("rejects unsafe columns, duplicate rows, oversized and invalid values", () => {
    expect(parseExplorerImport('[{"__proto__":1}]', "json").dataset).toBeNull();
    expect(
      parseExplorerImport("x\n" + Array(1001).fill("1").join("\n"), "csv")
        .dataset,
    ).toBeNull();
    const d = definition();
    if (d.props.dataset.kind !== "inline") throw Error();
    d.props.dataset.data.rows[1].id = "a";
    expect(explorerDatasetSchema.safeParse(d.props.dataset.data).success).toBe(
      false,
    );
  });
  it("uses currency minor units and deterministic remainder allocation", () => {
    const d = definition();
    d.props.nodes.push({
      id: "parts",
      label: "Parts",
      stage: "scalar",
      operation: "split",
      inputs: [
        {
          constant: 100,
          unit: { kind: "currency", code: "CNY", precision: 2 },
        },
        { constant: 3 },
      ],
      unit: { kind: "currency", code: "CNY", precision: 2 },
    });
    expect(explorerSchema.safeParse(d).success).toBe(true);
    expect(deriveExplorer(d, {}).metrics.parts).toEqual([33.34, 33.33, 33.33]);
    const node = d.props.nodes.at(-1)!;
    node.operation = "add";
    node.inputs = [
      { constant: 0.1, unit: node.unit },
      { constant: 0.2, unit: node.unit },
    ];
    expect(deriveExplorer(d, {}).metrics.parts).toBe(0.3);
  });
  it("reports null participation and invalid weights without fabricated totals", () => {
    const d = definition();
    d.props.nodes.push({
      id: "ratingAverage",
      label: "Average",
      stage: "aggregate",
      operation: "average",
      inputs: [{ field: "rating" }],
      collection: "filtered",
    });
    if (d.props.dataset.kind !== "inline") throw Error();
    d.props.dataset.data.rows[0].values.rating = null;
    const r = deriveExplorer(d, {});
    expect(r.metrics.ratingAverage).toBe(7);
    expect(r.participation.ratingAverage).toEqual({ included: 1, missing: 1 });
    d.props.nodes.at(-1)!.operation = "weighted";
    d.props.nodes.at(-1)!.inputs = [{ field: "rating" }, { field: "rating" }];
    d.props.dataset.data.rows[1].values.rating = -1;
    expect(
      deriveExplorer(d, {}).errors.some((e) => e.code === "negative_weight"),
    ).toBe(true);
  });
  it("accepts an explicit trusted imported version and validates invalid ranges", () => {
    const d = definition();
    if (d.props.dataset.kind !== "inline") throw Error();
    const data = structuredClone(d.props.dataset.data);
    data.version = "new";
    data.rows[0].values.transport = 1;
    const result = deriveExplorer(d, {}, data);
    expect(result.datasetVersion).toBe("new");
    expect(result.rows[0].values.total).toBe(301);
    expect(
      deriveExplorer(d, { ranges: { total: { min: 5, max: 1 } } }).errors,
    ).toContainEqual({ code: "invalid_range", field: "total" });
  });

  it("parses persisted numeric strings and preserves invalid editing text", () => {
    expect(parseExplorerRangeValue("100", "number")).toEqual({
      kind: "valid",
      value: 100,
    });
    expect(parseExplorerRangeValue("1e2", "number")).toEqual({
      kind: "valid",
      value: 100,
    });
    expect(parseExplorerRangeValue("1e", "number")).toEqual({
      kind: "invalid",
    });
    expect(parseExplorerRangeValue("0x10", "number")).toEqual({
      kind: "invalid",
    });
    expect(parseExplorerRangeValue("9007199254740991.2", "number")).toEqual({
      kind: "invalid",
    });
    expect(parseExplorerRangeValue("  ", "number")).toEqual({
      kind: "empty",
    });
  });

  it("exposes checked metric formulas and participation counts", () => {
    const d = definition();
    d.props.nodes.push({
      id: "ratingAverage",
      label: "Average rating",
      stage: "aggregate",
      operation: "average",
      inputs: [{ field: "rating" }],
      collection: "filtered",
    });
    if (d.props.dataset.kind !== "inline") throw Error();
    d.props.dataset.data.rows[0].values.rating = null;
    const result = deriveExplorer(d, {});
    expect(result.metricExplanations.ratingAverage).toMatchObject({
      formula: "average(Rating)",
      included: 1,
      missing: 1,
      empty: false,
    });
  });
});

it.each(["sum", "average", "weighted"] as const)(
  "rejects unsafe intermediate %s before cancellation hides precision loss",
  (operation) => {
    const unit = { kind: "currency" as const, code: "CNY", precision: 0 };
    const d = explorerSchema.parse({
      version: 1,
      kind: "explorer",
      title: "Bounded",
      summary: "Example",
      props: {
        provenance: "example",
        parameters: [],
        dataset: {
          kind: "inline",
          data: {
            id: "data",
            version: "1",
            columns: [
              { id: "amount", label: "Amount", type: "number", unit },
              { id: "weight", label: "Weight", type: "number" },
            ],
            rows: [Number.MAX_SAFE_INTEGER, 2, -Number.MAX_SAFE_INTEGER].map(
              (amount, index) => ({
                id: `r${index}`,
                values: { amount, weight: 1 },
              }),
            ),
          },
        },
        nodes: [
          {
            id: "total",
            label: "Total",
            stage: "aggregate",
            operation,
            inputs:
              operation === "weighted"
                ? [{ field: "amount" }, { field: "weight" }]
                : [{ field: "amount" }],
            unit,
            collection: "filtered",
          },
        ],
      },
    });
    const result = deriveExplorer(d, {});
    expect(result.metrics.total).toBeNull();
    expect(result.errors).toContainEqual(
      expect.objectContaining({ code: "overflow", field: "total" }),
    );
  },
);
