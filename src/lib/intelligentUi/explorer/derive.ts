import type { JsonObject } from "../types";
import { record, strings } from "../capabilities/shared";
import {
  explorerDatasetSchema,
  validExplorerDate,
  validParameter,
  validateGraph,
} from "./schema";
import type {
  ExplorerDataset,
  ExplorerDefinition,
  ExplorerState,
  ExplorerError,
  ExplorerCell,
  ExplorerNode,
} from "./types";

export type ExplorerRangeValue =
  { kind: "empty" } | { kind: "valid"; value: number } | { kind: "invalid" };

const DECIMAL_NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

/** Parse the persisted number or the raw text kept while a range is edited. */
export function parseExplorerRangeValue(
  value: unknown,
  type: ExplorerColumnLike["type"],
): ExplorerRangeValue {
  if (value === undefined) return { kind: "empty" };
  if (typeof value === "string" && value.trim() === "")
    return { kind: "empty" };
  if (type === "date") {
    if (typeof value !== "string" || !validExplorerDate(value))
      return { kind: "invalid" };
    const parsed = Date.parse(value);
    return Number.isFinite(parsed)
      ? { kind: "valid", value: parsed }
      : { kind: "invalid" };
  }
  if (
    typeof value !== "number" &&
    !(typeof value === "string" && DECIMAL_NUMBER.test(value.trim()))
  )
    return { kind: "invalid" };
  const raw = typeof value === "string" ? value.trim() : undefined;
  const parsed = typeof value === "number" ? value : Number(raw);
  if (raw && Number.isInteger(parsed)) {
    const match = raw.match(/^([+-]?)(\d+)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/);
    if (match) {
      const fraction = match[3] ?? "";
      const exponent = Number(match[4] ?? 0);
      if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 1000)
        return { kind: "invalid" };
      const decimalPlaces = fraction.length - exponent;
      const digits = `${match[2]}${fraction}`.replace(/^0+(?=\d)/, "");
      const fractionalDigits =
        decimalPlaces > 0
          ? digits.slice(-decimalPlaces).padStart(decimalPlaces, "0")
          : "";
      if (/[^0]/.test(fractionalDigits)) return { kind: "invalid" };
    }
  }
  return Number.isFinite(parsed) &&
    Math.abs(parsed) <= Number.MAX_SAFE_INTEGER &&
    (!Number.isInteger(parsed) || Number.isSafeInteger(parsed))
    ? { kind: "valid", value: parsed }
    : { kind: "invalid" };
}

type ExplorerColumnLike = { type: "text" | "number" | "boolean" | "date" };

export interface ExplorerMetricExplanation {
  formula: string;
  collection?: "filtered" | "selected";
  included?: number;
  missing?: number;
  empty: boolean;
  status:
    | "value"
    | "no-selection"
    | "no-rows"
    | "all-missing"
    | "missing-inputs"
    | "invalid";
  rounding?: { precision: number; split: boolean; currency?: boolean };
}
export function initialExplorer(
  d: ExplorerDefinition,
  data?: ExplorerDataset,
): ExplorerState {
  return {
    parameters: Object.fromEntries(
      d.props.parameters.map((p) => [p.id, p.value]),
    ),
    selected: [],
    visibleColumns: [
      ...((
        data ??
        (d.props.dataset.kind === "inline" ? d.props.dataset.data : undefined)
      )?.columns.map((c) => c.id) ?? []),
      ...d.props.nodes.filter((n) => n.stage === "row").map((n) => n.id),
    ],
    search: "",
    sortKey: "",
    descending: false,
    ranges: {},
  };
}
export function normalizeExplorer(
  d: ExplorerDefinition,
  input: JsonObject,
  data?: ExplorerDataset,
): ExplorerState {
  const initial = initialExplorer(d, data),
    rows =
      data ??
      (d.props.dataset.kind === "inline" ? d.props.dataset.data : undefined),
    params = record(input.parameters);
  return {
    ...initial,
    parameters: Object.fromEntries(
      d.props.parameters.map((p) => [
        p.id,
        Object.hasOwn(params, p.id) ? params[p.id] : p.value,
      ]),
    ),
    selected: strings(input.selected).filter((id) =>
      rows?.rows.some((r) => r.id === id),
    ),
    visibleColumns: Array.isArray(input.visibleColumns)
      ? strings(input.visibleColumns).filter((id) =>
          initial.visibleColumns.includes(id),
        )
      : initial.visibleColumns,
    search: typeof input.search === "string" ? input.search : "",
    sortKey:
      typeof input.sortKey === "string" &&
      initial.visibleColumns.includes(input.sortKey)
        ? input.sortKey
        : "",
    descending: input.descending === true,
    ranges: Object.fromEntries(
      Object.entries(record(input.ranges)).filter(([id]) =>
        initial.visibleColumns.includes(id),
      ),
    ),
  };
}
export function deriveExplorer(
  d: ExplorerDefinition,
  input: JsonObject,
  resolvedDataset?: ExplorerDataset,
) {
  const data =
      resolvedDataset ??
      (d.props.dataset.kind === "inline" ? d.props.dataset.data : undefined),
    state = normalizeExplorer(d, input, data),
    errors: ExplorerError[] = [],
    parameterErrors: Record<string, string> = {},
    metrics: Record<string, number | number[] | null> = {},
    participation: Record<string, { included: number; missing: number }> = {};
  const labels = new Map<string, string>([
    ...(data?.columns ?? []).map(
      (column) => [column.id, column.label] as const,
    ),
    ...d.props.parameters.map(
      (parameter) => [parameter.id, parameter.label] as const,
    ),
    ...d.props.nodes.map((node) => [node.id, node.label] as const),
  ]);
  const metricExplanations: Record<string, ExplorerMetricExplanation> = {};
  const referenceLabel = (ref: ExplorerNode["inputs"][number]): string => {
    if ("field" in ref) return labels.get(ref.field) ?? ref.field;
    if ("parameter" in ref) return labels.get(ref.parameter) ?? ref.parameter;
    if ("node" in ref) return labels.get(ref.node) ?? ref.node;
    return String(ref.constant);
  };
  const columns = [
    ...(data?.columns ?? []),
    ...d.props.nodes
      .filter((n) => n.stage === "row")
      .map((n) => ({
        id: n.id,
        label: n.label,
        type: "number" as const,
        unit: n.unit,
      })),
  ];
  for (const p of d.props.parameters)
    if (!validParameter(state.parameters[p.id], p)) {
      parameterErrors[p.id] = "invalid_parameter";
      errors.push({ code: "invalid_parameter", field: p.id });
    }
  if (!data) errors.push({ code: "unresolved_dataset" });
  else if (!explorerDatasetSchema.safeParse(data).success)
    errors.push({ code: "invalid_dataset" });
  else
    for (const code of validateGraph({
      ...d,
      props: { ...d.props, dataset: { kind: "inline", data } },
    }))
      errors.push({ code });
  for (const [field, raw] of Object.entries(state.ranges)) {
    const range = record(raw),
      column = columns.find((c) => c.id === field);
    const parse = (v: unknown) =>
      column
        ? parseExplorerRangeValue(v, column.type)
        : { kind: "invalid" as const };
    const min = parse(range.min),
      max = parse(range.max),
      hasMin = min.kind !== "empty",
      hasMax = max.kind !== "empty";
    if (
      (hasMin && min.kind !== "valid") ||
      (hasMax && max.kind !== "valid") ||
      (min.kind === "valid" && max.kind === "valid" && min.value > max.value)
    )
      errors.push({ code: "invalid_range", field });
  }
  const fatal = errors.some((e) => e.code !== "invalid_parameter");
  const read = (
    ref: ExplorerNode["inputs"][number],
    values: Record<string, ExplorerCell>,
    aggregates = metrics,
  ): number | null => {
    if ("parameter" in ref && parameterErrors[ref.parameter]) return null;
    const value =
      "field" in ref
        ? values[ref.field]
        : "parameter" in ref
          ? state.parameters[ref.parameter]
          : "node" in ref
            ? Object.hasOwn(values, ref.node)
              ? values[ref.node]
              : aggregates[ref.node]
            : ref.constant;
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  };
  const calculate = (
    n: ExplorerNode,
    v: (number | null)[],
  ): number | number[] | null => {
    if (v.some((x) => x === null)) return null;
    const factor = n.unit?.kind === "currency" ? 10 ** n.unit.precision! : 1;
    const minor = (value: number) => {
      const result = Math.round((value + Number.EPSILON) * factor);
      if (!Number.isSafeInteger(result)) throw Error("overflow");
      return result;
    };
    const a = n.unit?.kind === "currency" ? minor(v[0]!) : v[0]!,
      b =
        n.unit?.kind === "currency" && ["add", "subtract"].includes(n.operation)
          ? minor(v[1]!)
          : v[1]!,
      c = v[2]!;
    let result: number | number[];
    switch (n.operation) {
      case "add":
        result = a + b;
        break;
      case "subtract":
        result = a - b;
        break;
      case "multiply":
        result = a * b;
        break;
      case "divide":
        if (!b) throw Error("division_by_zero");
        result = a / b;
        break;
      case "scale":
        if (!b) throw Error("division_by_zero");
        result = a / b;
        if (
          !Number.isFinite(result) ||
          Math.abs(result) > Number.MAX_SAFE_INTEGER
        )
          throw Error("overflow");
        result *= c;
        break;
      case "split": {
        if (!Number.isInteger(b) || b < 1 || b > 1000)
          throw Error("invalid_split");
        const total = Math.round(a);
        if (!Number.isSafeInteger(total)) throw Error("overflow");
        const base = Math.trunc(total / b),
          remaining = total - base * b;
        result = Array.from(
          { length: b },
          (_, i) =>
            (base + (i < Math.abs(remaining) ? Math.sign(remaining) : 0)) /
            factor,
        );
        break;
      }
      default:
        throw Error("invalid_operation");
    }
    if (n.operation !== "split") result = (result as number) / factor;
    const results = Array.isArray(result) ? result : [result];
    if (
      results.some(
        (x) => !Number.isFinite(x) || Math.abs(x) > Number.MAX_SAFE_INTEGER,
      )
    )
      throw Error("overflow");
    if (n.unit?.kind === "currency") {
      const factor = 10 ** n.unit.precision!;
      const rounded = results.map((x) => {
        const minor = Math.round((x + Number.EPSILON) * factor);
        if (!Number.isSafeInteger(minor)) throw Error("overflow");
        return minor / factor;
      });
      return Array.isArray(result) ? rounded : rounded[0];
    }
    return result;
  };
  const run = (
    n: ExplorerNode,
    fn: () => number | number[] | null,
    row?: string,
  ) => {
    try {
      return fn();
    } catch (e) {
      errors.push({
        code: e instanceof Error ? e.message : "invalid_calculation",
        field: n.id,
        row,
      });
      return null;
    }
  };
  let rows = fatal
    ? []
    : data!.rows.map((row) => {
        const values = { ...row.values };
        for (const n of d.props.nodes.filter((n) => n.stage === "row")) {
          const result = run(
            n,
            () =>
              calculate(
                n,
                n.inputs.map((i) => read(i, values)),
              ),
            row.id,
          );
          values[n.id] = Array.isArray(result) ? null : result;
        }
        return { id: row.id, values };
      });
  rows = rows.filter((row) => {
    if (
      state.search &&
      !columns
        .filter((c) => state.visibleColumns.includes(c.id))
        .some((c) =>
          String(row.values[c.id] ?? "")
            .toLowerCase()
            .includes(state.search.toLowerCase()),
        )
    )
      return false;
    for (const f of d.props.filters ?? []) {
      const value = row.values[f.field],
        p = state.parameters[f.parameter];
      if (
        parameterErrors[f.parameter] ||
        typeof value !== "number" ||
        typeof p !== "number" ||
        (f.operator === "lte" ? value > p : value < p)
      )
        return false;
    }
    for (const [id, r] of Object.entries(state.ranges)) {
      const range = record(r),
        column = columns.find((c) => c.id === id),
        value = row.values[id];
      const valueResult = column
        ? parseExplorerRangeValue(value, column.type)
        : { kind: "invalid" as const };
      for (const edge of ["min", "max"]) {
        const bound = range[edge];
        const limit = column
          ? parseExplorerRangeValue(bound, column.type)
          : { kind: "invalid" as const };
        if (limit.kind === "empty") continue;
        if (
          valueResult.kind !== "valid" ||
          limit.kind !== "valid" ||
          (edge === "min"
            ? valueResult.value < limit.value
            : valueResult.value > limit.value)
        )
          return false;
      }
    }
    return true;
  });
  if (state.sortKey)
    rows.sort((a, b) => {
      const left = a.values[state.sortKey],
        right = b.values[state.sortKey];
      if (left === null) return right === null ? 0 : 1;
      if (right === null) return -1;
      const cmp =
        typeof left === "number" && typeof right === "number"
          ? left - right
          : String(left).localeCompare(String(right));
      return (state.descending ? -1 : 1) * cmp;
    });
  const selectedRows = rows.filter((row) => state.selected.includes(row.id));
  for (const n of d.props.nodes.filter((n) => n.stage !== "row")) {
    const source = n.collection === "selected" ? selectedRows : rows;
    const explanation: ExplorerMetricExplanation = {
      formula: `${n.operation}(${n.inputs.map(referenceLabel).join(", ")})`,
      ...(n.stage === "aggregate"
        ? { collection: n.collection ?? "filtered" }
        : {}),
      empty: false,
      status: "value",
      ...(n.unit?.kind === "currency" || n.operation === "split"
        ? {
            rounding: {
              precision: n.unit?.precision ?? 0,
              currency: n.unit?.kind === "currency",
              split: n.operation === "split",
            },
          }
        : {}),
    };
    metricExplanations[n.id] = explanation;
    metrics[n.id] = run(n, () => {
      if (fatal) return null;
      if (n.stage === "scalar")
        return calculate(
          n,
          n.inputs.map((i) => read(i, {})),
        );
      if (n.operation === "count") {
        participation[n.id] = { included: source.length, missing: 0 };
        explanation.included = source.length;
        explanation.missing = 0;
        return source.length;
      }
      const pairs = source
        .map((r) => n.inputs.map((i) => read(i, r.values)))
        .filter((v) => v.every((x) => x !== null)) as number[][];
      participation[n.id] = {
        included: pairs.length,
        missing: source.length - pairs.length,
      };
      explanation.included = pairs.length;
      explanation.missing = source.length - pairs.length;
      if (!pairs.length) return null;
      const moneyFactor =
        n.unit?.kind === "currency" ? 10 ** n.unit.precision! : 1;
      const values = pairs.map((v) =>
        n.unit?.kind !== "currency"
          ? v[0]
          : Math.round((v[0] + Number.EPSILON) * moneyFactor),
      );
      // Reject an unsafe intermediate before cancellation can disguise lost precision.
      const bounded = (value: number) => {
        if (
          !Number.isFinite(value) ||
          Math.abs(value) > Number.MAX_SAFE_INTEGER
        )
          throw Error("overflow");
        return value;
      };
      const sum = (items: number[]) =>
        items.reduce((total, item) => bounded(total + bounded(item)), 0);
      let value: number;
      switch (n.operation) {
        case "sum":
          value = sum(values);
          break;
        case "average":
          value = sum(values) / values.length;
          break;
        case "min":
          value = Math.min(...values);
          break;
        case "max":
          value = Math.max(...values);
          break;
        case "weighted": {
          if (pairs.some((v) => v[1] < 0)) throw Error("negative_weight");
          const weight = sum(pairs.map((v) => v[1]));
          if (!weight) throw Error("zero_weight");
          value = sum(pairs.map((v, i) => bounded(values[i] * v[1]))) / weight;
          break;
        }
        default:
          throw Error("invalid_operation");
      }
      if (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER)
        throw Error("overflow");
      value /= moneyFactor;
      return n.unit?.kind === "currency"
        ? Math.round((value + Number.EPSILON) * 10 ** n.unit.precision!) /
            10 ** n.unit.precision!
        : value;
    });
    explanation.empty = metrics[n.id] === null;
    const invalid =
      fatal ||
      errors.some((error) => error.field === n.id) ||
      n.inputs.some(
        (ref) => "parameter" in ref && !!parameterErrors[ref.parameter],
      );
    explanation.status = invalid
      ? "invalid"
      : n.stage === "aggregate" && source.length === 0
        ? n.collection === "selected"
          ? "no-selection"
          : "no-rows"
        : explanation.empty
          ? n.stage === "aggregate"
            ? "all-missing"
            : "missing-inputs"
          : "value";
  }
  return {
    state,
    columns,
    rows,
    selectedRows,
    metrics,
    participation,
    metricExplanations,
    errors,
    parameterErrors,
    datasetVersion: data?.version ?? "",
    chart: d.props.chart ? { ...d.props.chart, rows } : null,
  };
}
