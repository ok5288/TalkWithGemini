import { describe, expect, it } from "vitest";
import * as echarts from "echarts";
import { createEChartsRenderer } from "@datafe-open/markdown-chart-echarts";
import {
  analyzeChartSource,
  deriveChart,
} from "@/lib/intelligentUi/capabilities/chart";
import type {
  ChartDefinition,
  IntelligentUiBlock,
} from "@/lib/intelligentUi/types";
import { normalizeIntelligentUiBlock } from "@/lib/intelligentUi/schema";
import {
  cloneMessageTreeWithNewIds,
  normalizeSessionMessageTree,
} from "@/lib/chat/messageTree";
import { scrubAppExportValue } from "@/lib/data/appExport";
import { projectUiBlock } from "@/lib/intelligentUi/projection";

function source(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    version: 1,
    renderer: "echarts",
    data: {
      kind: "inline",
      dimensions: ["name", "value"],
      source: [
        { name: "Alpha", value: 10 },
        { name: "Beta", value: 20 },
      ],
    },
    spec: {
      xAxis: { type: "category" },
      yAxis: { type: "value" },
      series: [{ type: "bar", encode: { x: "name", y: "value" } }],
    },
    ...overrides,
  });
}

function definition(chartSource: string): ChartDefinition {
  return {
    version: 1,
    kind: "chart",
    title: "Values",
    summary: "Data",
    props: {
      provenance: "source",
      charts: [{ id: "one", label: "Values", source: chartSource }],
    },
  };
}

describe("Intelligent UI chart source compatibility", () => {
  it("only marks a single top-level inline dataset as executable", () => {
    expect(analyzeChartSource(source()).mode).toEqual({ kind: "canonical" });
    expect(
      analyzeChartSource(
        source({ spec: { series: { type: "bar", data: [10, 20] } } }),
      ).mode,
    ).toEqual({ kind: "static-only", reason: "series-data" });
    expect(
      analyzeChartSource(
        source({ spec: { xAxis: { data: ["Alpha", "Beta"] } } }),
      ).mode,
    ).toEqual({ kind: "static-only", reason: "axis-data" });
    expect(
      analyzeChartSource(source({ spec: { dataset: { id: "other" } } })).mode,
    ).toEqual({ kind: "static-only", reason: "spec-dataset" });
  });

  it("keeps named datasets in independent readable tables", () => {
    const chartSource = source({
      datasets: {
        secondary: {
          kind: "inline",
          dimensions: ["other", "amount"],
          source: [{ other: "Gamma", amount: 30 }],
        },
      },
      spec: { series: [{ type: "bar", datasetId: "secondary" }] },
    });
    const result = deriveChart(definition(chartSource), {
      chartId: "one",
      filter: "Alpha",
    });
    expect(result.mode).toEqual({
      kind: "static-only",
      reason: "named-dataset",
    });
    expect(result.source).toBe(chartSource);
    expect(result.filtered).toHaveLength(2);
    expect(result.staticTables.map((table) => table.id)).toEqual([
      "data",
      "secondary",
    ]);
    expect(result.staticTables[1]?.rows[0]?.cells).toEqual({
      other: "Gamma",
      amount: 30,
    });
  });

  it("keeps an ECharts spec dataset as its own readable table", () => {
    const chartSource = source({
      spec: {
        dataset: {
          dimensions: ["other", "amount"],
          source: [{ other: "Gamma", amount: 30 }],
        },
        series: [{ type: "bar", datasetIndex: 0 }],
      },
    });
    const result = deriveChart(definition(chartSource), {
      chartId: "one",
      filter: "Beta",
    });
    expect(result.mode).toEqual({
      kind: "static-only",
      reason: "spec-dataset",
    });
    expect(result.filtered).toHaveLength(2);
    expect(result.staticTables.at(-1)?.id).toBe("spec-dataset-1");
    expect(result.staticTables.at(-1)?.rows[0]?.cells).toEqual({
      other: "Gamma",
      amount: 30,
    });
  });

  it.each(["static-original", "static-current"] as const)(
    "preserves every legacy dataset in %s output without claiming filtering",
    (purpose) => {
      const d = definition(
        source({
          datasets: {
            secondary: {
              kind: "inline",
              dimensions: ["other", "amount"],
              source: [{ other: "Gamma", amount: 30 }],
            },
          },
        }),
      );
      const block: IntelligentUiBlock = {
        id: "chart",
        type: "intelligent_ui",
        schemaVersion: 1,
        renderer: "native",
        definition: d,
        definitionRevision: 1,
        stateRevision: 1,
        status: "ready",
        state: { chartId: "one", filter: "Alpha" },
        staticSnapshot: "",
        fallbackMarkdown: d.summary,
        sourceRefs: [],
      };
      const output = projectUiBlock(block, { purpose, locale: "en" });
      expect(output).toContain("Alpha");
      expect(output).toContain("Beta");
      expect(output).toContain("Gamma");
      expect(output).toContain("secondary");
      expect(output).toContain("interactive filters are unavailable");
      expect(output).not.toContain('"renderer"');
    },
  );

  it.each([
    { datasetIndex: 1 },
    { datasetId: "missing" },
    { encode: { x: "name", y: "missing" } },
    { encode: { x: 0, y: 9 } },
    { seriesLayoutBy: "row" },
    { xAxisIndex: 1 },
    { xAxisId: "missing" },
    { encode: {} },
  ])("preserves uncertain series mapping as static-only: %j", (mapping) => {
    const original = source({
      spec: {
        xAxis: { type: "category" },
        yAxis: { type: "value" },
        series: [
          { type: "bar", encode: { x: "name", y: "value" }, ...mapping },
        ],
      },
    });
    const result = deriveChart(definition(original), { filter: "Alpha" });
    expect(result.mode.kind).toBe("static-only");
    expect(result.source).toBe(original);
    expect(result.filtered).toHaveLength(2);
  });

  it.each([
    [false, "Alpha"],
    [true, "Alpha"],
    [true, "missing"],
  ] as const)(
    "passes filtered text rows without auto header loss (arrays=%s, filter=%s)",
    async (arrays, filter) => {
      const chartSource = source({
        data: {
          kind: "inline",
          dimensions: ["name", "value"],
          source: arrays
            ? [
                ["Alpha", "10"],
                ["Beta", "20"],
              ]
            : [
                { name: "Alpha", value: "10" },
                { name: "Beta", value: "20" },
              ],
        },
      });
      const result = deriveChart(definition(chartSource), { filter });
      expect(result.mode.kind).toBe("canonical");
      const payload = JSON.parse(result.source);
      const instance = echarts.init(null, null, {
        renderer: "svg",
        ssr: true,
        width: 320,
        height: 200,
      });
      const renderer = createEChartsRenderer({
        defaultStyle: false,
        resizeObserver: false,
        loadECharts: async () => ({
          init: () => ({
            setOption: (option) => instance.setOption(option as never),
            resize: () => instance.resize(),
            dispose: () => instance.dispose(),
          }),
        }),
      });
      const parsed = await renderer.parse(payload.spec, {
        language: "markdown-chart",
        rendererId: "echarts",
        data: payload.data,
      });
      const handle = await renderer.mount(null as never, parsed, {
        signal: new AbortController().signal,
        theme: null,
      });
      // The model is the actual ECharts data consumer, not merely setOption input.
      const model = (
        instance as unknown as {
          getModel(): {
            getSeries(): {
              getData(): {
                count(): number;
                getRawDataItem(index: number): unknown;
              };
            }[];
          };
        }
      ).getModel();
      expect(model.getSeries()[0].getData().count()).toBe(
        result.filtered.length,
      );
      if (result.filtered.length)
        expect(model.getSeries()[0].getData().getRawDataItem(0)).toEqual(
          result.filtered[0].cells,
        );
      handle?.dispose();
    },
  );

  it("judges mixed charts independently and preserves legacy contents through backup and clone", () => {
    const d = definition(source());
    const legacy = source({
      spec: { series: [{ type: "bar", datasetIndex: 1 }] },
    });
    d.props.charts.push({ id: "legacy", label: "Legacy", source: legacy });
    const block: IntelligentUiBlock = {
      id: "chart",
      type: "intelligent_ui",
      renderer: "native",
      schemaVersion: 1,
      definition: d,
      definitionRevision: 7,
      stateRevision: 9,
      state: { chartId: "legacy", filter: "Alpha" },
      status: "ready",
      staticSnapshot: "historical snapshot",
      fallbackMarkdown: "Fallback",
      sourceRefs: [],
    };
    const restored = normalizeIntelligentUiBlock(
      JSON.parse(JSON.stringify(scrubAppExportValue(block))),
    )!;
    expect(restored).toMatchObject(block);
    const tree = normalizeSessionMessageTree([
      {
        id: "m",
        role: "model",
        content: "",
        timestamp: 1,
        outputBlocks: [restored],
      },
    ]);
    const cloned = cloneMessageTreeWithNewIds(tree, () => "copy");
    const copied = cloned.nodesById.copy.message
      .outputBlocks![0] as IntelligentUiBlock;
    expect(copied.definition).toEqual(d);
    expect(copied.state).toEqual(block.state);
    expect(copied.definitionRevision).toBe(7);
    expect(copied.stateRevision).toBe(9);
    expect(deriveChart(d, copied.state).source).toBe(legacy);
    expect(deriveChart(d, { chartId: "one", filter: "Alpha" }).mode.kind).toBe(
      "canonical",
    );
    expect(d.props.charts[1].source).toBe(legacy);
  });

  it("freezes determinable legacy default dimensions and encode without changing the saved source", () => {
    const chartSource = source({
      data: {
        kind: "inline",
        source: [
          { name: "Alpha", value: 10 },
          { name: "Beta", value: 20 },
        ],
      },
      spec: {
        xAxis: { type: "category" },
        yAxis: { type: "value" },
        series: [{ type: "bar", datasetIndex: 0 }],
      },
    });
    const d = definition(chartSource);
    const result = deriveChart(d, { filter: "Beta" });
    expect(result.mode.kind).toBe("canonical");
    const runtime = JSON.parse(result.source);
    expect(runtime.data.dimensions).toEqual(["name", "value"]);
    expect(runtime.spec.series[0].encode).toEqual({ x: "name", y: "value" });
    expect(runtime.data.source).toEqual(
      result.filtered.map((row) => row.cells),
    );
    expect(d.props.charts[0].source).toBe(chartSource);
  });

  it("passes the same filtered rows to the table and the ECharts SSR renderer", async () => {
    const result = deriveChart(definition(source()), {
      chartId: "one",
      filter: "Alpha",
    });
    const payload = JSON.parse(result.source) as {
      data: { kind: "inline"; source: unknown[] };
      spec: Record<string, unknown>;
    };
    const tableRows = result.filtered.map((row) => row.raw);
    expect(payload.data.source).toEqual(tableRows);

    let renderedOption: Record<string, unknown> | undefined;
    let instance: ReturnType<typeof echarts.init> | undefined;
    const renderer = createEChartsRenderer({
      defaultStyle: false,
      resizeObserver: false,
      loadECharts: async () => ({
        init: () => {
          instance = echarts.init(null, null, {
            renderer: "svg",
            ssr: true,
            width: 320,
            height: 200,
          });
          return {
            setOption: (option: Record<string, never>) => {
              renderedOption = option;
              instance?.setOption(option as never);
            },
            resize: () => instance?.resize(),
            dispose: () => instance?.dispose(),
          };
        },
      }),
    });
    const parsed = await renderer.parse(payload.spec as never, {
      language: "markdown-chart",
      rendererId: "echarts",
      data: payload.data as never,
    });
    const handle = await renderer.mount(null as never, parsed, {
      signal: new AbortController().signal,
      theme: null,
    });

    expect((renderedOption?.dataset as { source?: unknown[] }).source).toEqual(
      tableRows,
    );
    expect(instance?.renderToSVGString()).toContain("<svg");
    handle?.dispose();
  });
});
