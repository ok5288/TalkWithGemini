import { z } from "zod";
import { parseMarkdownChartEnvelope } from "@datafe-open/markdown-chart";
import type { ChartDefinition, JsonObject } from "../types";
import { base, id, items, provenance, text } from "./shared";
export const chartSchema = z.object({
  ...base,
  kind: z.literal("chart"),
  props: z.object({
    charts: items(
      z.object({
        id,
        label: text,
        source: text.refine((source) => {
          try {
            const envelope = parseMarkdownChartEnvelope(source);
            return (
              envelope.renderer === "echarts" && envelope.data?.kind !== "ref"
            );
          } catch {
            return false;
          }
        }),
      }),
    ),
    provenance,
  }),
});
export interface ChartState extends JsonObject {
  chartId: string;
  filter: string;
}
export function initialChart(definition: ChartDefinition): ChartState {
  return { chartId: definition.props.charts[0].id, filter: "" };
}
export function normalizeChart(
  definition: ChartDefinition,
  state: JsonObject,
): ChartState {
  return {
    chartId: definition.props.charts.some((chart) => chart.id === state.chartId)
      ? String(state.chartId)
      : definition.props.charts[0].id,
    filter: typeof state.filter === "string" ? state.filter : "",
  };
}
export interface ChartRow {
  raw: unknown;
  cells: Record<string, unknown>;
}

export type ChartExecutionMode =
  | { kind: "canonical" }
  | {
      kind: "static-only";
      reason:
        | "series-data"
        | "named-dataset"
        | "axis-data"
        | "spec-dataset"
        | "invalid-data"
        | "ambiguous-mapping";
    };

export interface ChartSourceAnalysis {
  mode: ChartExecutionMode;
  parsed: Record<string, unknown>;
}

export interface ChartStaticTable {
  id: string;
  columns: string[];
  rows: ChartRow[];
}

function hasAxisData(spec: unknown): boolean {
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) return false;
  for (const axisKey of ["xAxis", "yAxis"]) {
    const axis = (spec as Record<string, unknown>)[axisKey];
    const axes = Array.isArray(axis) ? axis : axis ? [axis] : [];
    if (
      axes.some(
        (entry) =>
          entry &&
          typeof entry === "object" &&
          !Array.isArray(entry) &&
          Object.hasOwn(entry, "data"),
      )
    )
      return true;
  }
  return false;
}

function hasSpecDataset(spec: unknown): boolean {
  return (
    !!spec &&
    typeof spec === "object" &&
    !Array.isArray(spec) &&
    Object.hasOwn(spec, "dataset")
  );
}

function containsSeriesData(spec: unknown): boolean {
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) return false;
  const series = (spec as Record<string, unknown>).series;
  const entries = Array.isArray(series) ? series : series ? [series] : [];
  return entries.some(
    (entry) =>
      entry &&
      typeof entry === "object" &&
      !Array.isArray(entry) &&
      Object.hasOwn(entry, "data"),
  );
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** Resolve only mappings that remain stable when rows are filtered. */
function canonicalSpec(
  spec: unknown,
  data: { dimensions?: readonly string[]; source: readonly unknown[] },
): { spec: Record<string, unknown>; dimensions: string[] } | undefined {
  if (
    !record(spec) ||
    ["baseOption", "options", "media"].some((key) => key in spec)
  )
    return;
  const dimensions = data.dimensions?.length
    ? [...data.dimensions]
    : record(data.source[0])
      ? Object.keys(data.source[0])
      : Array.isArray(data.source[0]) &&
          data.source[0].every((cell) => typeof cell !== "string")
        ? data.source[0].map((_, index) => String(index + 1))
        : [];
  if (!dimensions.length || new Set(dimensions).size !== dimensions.length)
    return;
  if (
    data.source.some((row) =>
      Array.isArray(row)
        ? row.length !== dimensions.length
        : !record(row) ||
          dimensions.some((dimension) => !Object.hasOwn(row, dimension)),
    )
  )
    return;
  const entries = Array.isArray(spec.series)
    ? spec.series
    : spec.series
      ? [spec.series]
      : [];
  if (!entries.length) return;
  const series: Record<string, unknown>[] = [];
  for (const entry of entries) {
    if (
      !record(entry) ||
      (entry.datasetIndex !== undefined && entry.datasetIndex !== 0) ||
      entry.datasetId !== undefined ||
      (entry.seriesLayoutBy !== undefined &&
        entry.seriesLayoutBy !== "column") ||
      entry.dimensions !== undefined ||
      entry.sourceHeader !== undefined ||
      !["bar", "line", "scatter", "pie"].includes(String(entry.type))
    )
      return;
    if (entry.type !== "pie") {
      for (const key of ["xAxis", "yAxis"]) {
        const axes = Array.isArray(spec[key]) ? spec[key] : [spec[key]];
        const index = entry[`${key}Index`] ?? 0;
        if (
          typeof index !== "number" ||
          !Number.isInteger(index) ||
          index < 0 ||
          !record(axes[index])
        )
          return;
        if (entry[`${key}Id`] !== undefined) return;
      }
    }
    let encode = entry.encode;
    if (encode === undefined) {
      // Preserve the unambiguous legacy two-column default; freeze its mapping
      // so filtering cannot change ECharts' type/header inference.
      if (entries.length !== 1 || dimensions.length !== 2) return;
      if (entry.type === "pie") {
        // Pie's automatic value dimension is type-based. Only freeze the
        // established name/value shape; other orders need explicit encode.
        if (
          !data.source.length ||
          data.source.some((row) => {
            const cells = Array.isArray(row)
              ? row
              : dimensions.map((key) => (row as Record<string, unknown>)[key]);
            return typeof cells[0] !== "string" || typeof cells[1] !== "number";
          })
        )
          return;
        encode = { itemName: dimensions[0], value: dimensions[1] };
      } else {
        const x = Array.isArray(spec.xAxis)
          ? spec.xAxis[(entry.xAxisIndex as number | undefined) ?? 0]
          : spec.xAxis;
        const y = Array.isArray(spec.yAxis)
          ? spec.yAxis[(entry.yAxisIndex as number | undefined) ?? 0]
          : spec.yAxis;
        if (!record(x) || !record(y)) return;
        if (y.type === "category" && x.type !== "category")
          encode = { x: dimensions[1], y: dimensions[0] };
        else if (
          (x.type === "category" && y.type !== "category") ||
          (entry.type === "scatter" &&
            [x.type, y.type].every(
              (type) => type === undefined || type === "value",
            ))
        )
          encode = { x: dimensions[0], y: dimensions[1] };
        else return;
      }
    }
    if (!record(encode) || !Object.keys(encode).length) return;
    const validDimension = (value: unknown) =>
      typeof value === "string"
        ? dimensions.includes(value)
        : typeof value === "number" &&
          Number.isInteger(value) &&
          value >= 0 &&
          value < dimensions.length;
    if (
      Object.values(encode).some((value) =>
        Array.isArray(value)
          ? !value.length || !value.every(validDimension)
          : !validDimension(value),
      )
    )
      return;
    if (
      entry.type === "pie"
        ? !("value" in encode)
        : !("x" in encode && "y" in encode)
    )
      return;
    if (
      entry.coordinateSystem !== undefined &&
      entry.coordinateSystem !== "cartesian2d"
    )
      return;
    series.push({ ...entry, encode });
  }
  return { spec: { ...spec, series }, dimensions };
}

/**
 * Determine whether one top-level inline dataset can drive every renderer.
 * Historical definitions remain readable even when they have another data
 * source; those definitions are rendered as static-only by the native UI.
 */
export function analyzeChartSource(source: string): ChartSourceAnalysis {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(source) as Record<string, unknown>;
    const envelope = parseMarkdownChartEnvelope(source);
    if (envelope.renderer !== "echarts" || envelope.data?.kind !== "inline")
      return { mode: { kind: "static-only", reason: "invalid-data" }, parsed };
    if (envelope.datasets && Object.keys(envelope.datasets).length)
      return { mode: { kind: "static-only", reason: "named-dataset" }, parsed };
    if (containsSeriesData(envelope.spec))
      return { mode: { kind: "static-only", reason: "series-data" }, parsed };
    if (hasAxisData(envelope.spec))
      return { mode: { kind: "static-only", reason: "axis-data" }, parsed };
    if (hasSpecDataset(envelope.spec))
      return { mode: { kind: "static-only", reason: "spec-dataset" }, parsed };
    const rawData = parsed.data;
    // An explicit header or row layout cannot be preserved by this adapter.
    if (
      !record(rawData) ||
      (rawData.sourceHeader !== undefined && rawData.sourceHeader !== false) ||
      (rawData.seriesLayoutBy !== undefined &&
        rawData.seriesLayoutBy !== "column")
    )
      return {
        mode: { kind: "static-only", reason: "ambiguous-mapping" },
        parsed,
      };
    const canonical = canonicalSpec(envelope.spec, envelope.data);
    if (!canonical)
      return {
        mode: { kind: "static-only", reason: "ambiguous-mapping" },
        parsed,
      };
    return {
      mode: { kind: "canonical" },
      parsed: {
        ...parsed,
        spec: canonical.spec,
        data: { ...rawData, dimensions: canonical.dimensions },
      },
    };
  } catch {
    return {
      mode: { kind: "static-only", reason: "invalid-data" },
      parsed: {},
    };
  }
}

export function deriveChart(definition: ChartDefinition, input: JsonObject) {
  const state = normalizeChart(definition, input);
  const selected =
    definition.props.charts.find((chart) => chart.id === state.chartId) ??
    definition.props.charts[0];
  let parsed: Record<string, unknown> = {};
  let rows: ChartRow[] = [],
    columns: string[] = [];
  let source = selected.source;
  const staticTables: ChartStaticTable[] = [];
  const analysis = analyzeChartSource(selected.source);
  try {
    parsed = analysis.parsed;
    const envelope = parseMarkdownChartEnvelope(selected.source);
    const toTable = (
      id: string,
      data: {
        kind: "inline";
        dimensions?: readonly string[];
        source: readonly unknown[];
      },
    ): ChartStaticTable => {
      const tableColumns = data.dimensions?.length
        ? [...data.dimensions]
        : [
            ...new Set(
              data.source.flatMap((row) =>
                Array.isArray(row)
                  ? row.map((_, index) => String(index + 1))
                  : row && typeof row === "object"
                    ? Object.keys(row)
                    : ["value"],
              ),
            ),
          ];
      const tableRows = data.source.map((row) => ({
        raw: row as ChartRow["raw"],
        cells: Array.isArray(row)
          ? Object.fromEntries(
              tableColumns.map((column, index) => [column, row[index]]),
            )
          : row && typeof row === "object"
            ? (row as Record<string, unknown>)
            : { value: row },
      }));
      return { id, columns: tableColumns, rows: tableRows };
    };
    const appendInline = (id: string, data: unknown) => {
      if (
        !data ||
        typeof data !== "object" ||
        Array.isArray(data) ||
        (data as { kind?: unknown }).kind !== "inline" ||
        !Array.isArray((data as { source?: unknown }).source)
      )
        return;
      let tableId = id;
      let suffix = 2;
      while (staticTables.some((table) => table.id === tableId)) {
        tableId = `${id}-${suffix}`;
        suffix += 1;
      }
      staticTables.push(
        toTable(
          tableId,
          data as {
            kind: "inline";
            dimensions?: readonly string[];
            source: readonly unknown[];
          },
        ),
      );
    };
    appendInline("data", envelope.data);
    if (envelope.datasets)
      for (const [id, data] of Object.entries(envelope.datasets))
        appendInline(id, data);
    const primary = staticTables[0];
    if (primary) {
      ({ columns, rows } = primary);
    }
    if (analysis.mode.kind === "static-only") {
      const spec = envelope.spec;
      const series =
        spec && typeof spec === "object" && !Array.isArray(spec)
          ? (spec as Record<string, unknown>).series
          : undefined;
      const seriesEntries = Array.isArray(series)
        ? series
        : series
          ? [series]
          : [];
      seriesEntries.forEach((entry, index) => {
        if (
          !entry ||
          typeof entry !== "object" ||
          Array.isArray(entry) ||
          !Array.isArray((entry as Record<string, unknown>).data)
        )
          return;
        appendInline(`series-${index + 1}`, {
          kind: "inline",
          source: (entry as Record<string, unknown>).data,
        });
      });
      if (spec && typeof spec === "object" && !Array.isArray(spec)) {
        const specDataset = (spec as Record<string, unknown>).dataset;
        const specDatasets = Array.isArray(specDataset)
          ? specDataset
          : specDataset
            ? [specDataset]
            : [];
        specDatasets.forEach((entry, index) => {
          if (
            !entry ||
            typeof entry !== "object" ||
            Array.isArray(entry) ||
            !Array.isArray((entry as Record<string, unknown>).source)
          )
            return;
          const dimensions = (entry as Record<string, unknown>).dimensions;
          const validDimensions =
            Array.isArray(dimensions) &&
            dimensions.every((dimension) => typeof dimension === "string");
          appendInline(`spec-dataset-${index + 1}`, {
            kind: "inline",
            ...(validDimensions ? { dimensions } : {}),
            source: (entry as Record<string, unknown>).source,
          });
        });
        for (const axisKey of ["xAxis", "yAxis"]) {
          const axis = (spec as Record<string, unknown>)[axisKey];
          const axes = Array.isArray(axis) ? axis : axis ? [axis] : [];
          axes.forEach((entry, index) => {
            if (
              !entry ||
              typeof entry !== "object" ||
              Array.isArray(entry) ||
              !Array.isArray((entry as Record<string, unknown>).data)
            )
              return;
            appendInline(`${axisKey}-${index + 1}`, {
              kind: "inline",
              source: (entry as Record<string, unknown>).data,
            });
          });
        }
      }
    }
  } catch {
    /* Invalid historical chart retains its source and readable summary. */
  }
  const filtered = rows.filter(
    (row) =>
      analysis.mode.kind === "static-only" ||
      Object.values(row.cells)
        .join(" ")
        .toLowerCase()
        .includes(state.filter.toLowerCase()),
  );
  if (analysis.mode.kind === "canonical")
    source = JSON.stringify({
      ...parsed,
      data: {
        ...(parsed.data as Record<string, unknown>),
        // Object rows prevent ECharts from treating filtered text as a header.
        source: filtered.map((row) => row.cells),
      },
    });
  return {
    state,
    selected,
    source,
    columns,
    rows,
    filtered,
    mode: analysis.mode,
    staticTables,
  };
}
export const chartCapability = {
  schema: chartSchema,
  initial: initialChart,
  normalize: normalizeChart,
  derive: deriveChart,
  prompt:
    'chart: props {charts:[{id,label,source:string}],provenance:"user"|"source"|"example"}; source is a validated self-contained ECharts chart JSON envelope. For interactive charts use bar, line, scatter or pie with one top-level inline data source, explicit dimensions and column-oriented rows without a header row. Map every series explicitly with encode (x/y for Cartesian charts, value/itemName for pie), and define xAxis/yAxis for Cartesian charts. Use only datasetIndex 0 or omit it. Do not add series.data, axis.data, spec.dataset, named datasets, datasetId, row layout or nested baseOption/options/media; uncertain mappings remain static.',
};
