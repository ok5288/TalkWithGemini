import { z } from "zod";
import {
  base,
  bounds,
  finite,
  id,
  provenance,
  text,
  validBounds,
} from "../capabilities/shared";
import type { ExplorerDefinition, ExplorerUnit } from "./types";
export function validExplorerDate(value: string): boolean {
  if (
    !/^\d{4}-\d\d-\d\d(?:T\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d))?$/.test(
      value,
    ) ||
    !Number.isFinite(Date.parse(value))
  )
    return false;
  const day = value.slice(0, 10);
  return new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) === day;
}
const unit = z
  .object({
    kind: z.enum(["scalar", "currency", "percent", "quantity"]),
    code: text.optional(),
    precision: z.number().int().min(0).max(8).optional(),
  })
  .refine(
    (u) => u.kind !== "currency" || (!!u.code && u.precision !== undefined),
  );
const column = z
  .object({
    id,
    label: text,
    type: z.enum(["text", "number", "boolean", "date"]),
    unit: unit.optional(),
  })
  .refine((c) => !c.unit || c.type === "number");
export const explorerDatasetSchema = z
  .object({
    id,
    version: text,
    columns: z.array(column).min(1).max(20),
    rows: z
      .array(
        z.object({
          id,
          values: z.record(
            id,
            z.union([z.string(), finite, z.boolean(), z.null()]),
          ),
        }),
      )
      .max(1000),
  })
  .superRefine((d, ctx) => {
    const fail = () =>
      ctx.addIssue({ code: "custom", message: "Invalid bounded dataset" });
    if (new TextEncoder().encode(JSON.stringify(d)).length > 1048576) fail();
    if (
      new Set(d.columns.map((c) => c.id)).size !== d.columns.length ||
      new Set(d.rows.map((r) => r.id)).size !== d.rows.length
    )
      fail();
    for (const r of d.rows) {
      if (Object.keys(r.values).some((k) => !d.columns.some((c) => c.id === k)))
        fail();
      for (const c of d.columns) {
        const v = r.values[c.id];
        if (v === null) continue;
        if (
          v === undefined ||
          (c.type === "date"
            ? typeof v !== "string" || !validExplorerDate(v)
            : typeof v !== (c.type === "text" ? "string" : c.type))
        )
          fail();
        if (
          c.unit?.kind === "currency" &&
          typeof v === "number" &&
          !Number.isSafeInteger(Math.round(v * 10 ** c.unit.precision!))
        )
          fail();
      }
    }
  });
const input = z.union([
  z.object({ field: id }).strict(),
  z.object({ parameter: id }).strict(),
  z.object({ node: id }).strict(),
  z.object({ constant: finite, unit: unit.optional() }).strict(),
]);
const parameter = z
  .object({ id, label: text, value: finite, ...bounds, unit: unit.optional() })
  .refine((p) => validBounds(p) && validParameter(p.value, p));
export function validParameter(
  v: unknown,
  p: { min?: number; max?: number; step?: number },
) {
  return (
    typeof v === "number" &&
    Number.isFinite(v) &&
    (p.min === undefined || v >= p.min) &&
    (p.max === undefined || v <= p.max) &&
    (p.step === undefined ||
      Math.abs(
        (v - (p.min ?? 0)) / p.step - Math.round((v - (p.min ?? 0)) / p.step),
      ) < 1e-8)
  );
}
const node = z.object({
  id,
  label: text,
  stage: z.enum(["row", "aggregate", "scalar"]),
  operation: z.enum([
    "add",
    "subtract",
    "multiply",
    "divide",
    "scale",
    "split",
    "count",
    "sum",
    "min",
    "max",
    "average",
    "weighted",
  ]),
  inputs: z.array(input).max(16),
  collection: z.enum(["filtered", "selected"]).optional(),
  unit: unit.optional(),
});
export const explorerV1Schema = z
  .object({
    ...base,
    kind: z.literal("explorer"),
    props: z.object({
      dataset: z.discriminatedUnion("kind", [
        z.object({ kind: z.literal("inline"), data: explorerDatasetSchema }),
        z.object({ kind: z.literal("context"), alias: id, version: text }),
      ]),
      provenance,
      parameters: z.array(parameter).max(20),
      nodes: z.array(node).max(16),
      filters: z
        .array(
          z.object({
            field: id,
            operator: z.enum(["lte", "gte"]),
            parameter: id,
          }),
        )
        .max(20)
        .optional(),
      chart: z
        .object({ type: z.enum(["bar", "line", "scatter"]), x: id, y: id })
        .optional(),
      metrics: z.array(id).max(16).optional(),
    }),
  })
  .superRefine((definition, ctx) => {
    for (const error of validateGraph(definition as ExplorerDefinition))
      ctx.addIssue({ code: "custom", message: error });
  });
const section = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("parameters") }).strict(),
  z
    .object({
      kind: z.literal("metrics"),
      nodes: z
        .array(id)
        .min(1)
        .max(16)
        .refine((ids) => new Set(ids).size === ids.length),
    })
    .strict(),
  z.object({ kind: z.literal("table") }).strict(),
  z
    .object({
      kind: z.literal("chart"),
      id,
      title: text,
      type: z.enum(["bar", "line", "scatter"]),
      x: id,
      y: id,
    })
    .strict(),
  z.object({ kind: z.literal("notices") }).strict(),
]);
const strictUnit = unit.strict();
const strictDataset = explorerDatasetSchema.strict().safeExtend({
  columns: z
    .array(column.strict().safeExtend({ unit: strictUnit.optional() }))
    .min(1)
    .max(20),
  rows: z
    .array(
      z
        .object({
          id,
          values: z.record(
            id,
            z.union([z.string(), finite, z.boolean(), z.null()]),
          ),
        })
        .strict(),
    )
    .max(1000),
});
const strictInput = z.union([
  z.object({ field: id }).strict(),
  z.object({ parameter: id }).strict(),
  z.object({ node: id }).strict(),
  z.object({ constant: finite, unit: strictUnit.optional() }).strict(),
]);
export const explorerV2Schema = z
  .object({
    ...base,
    version: z.literal(2),
    kind: z.literal("explorer"),
    props: explorerV1Schema.shape.props
      .omit({ chart: true, metrics: true })
      .extend({
        dataset: z.discriminatedUnion("kind", [
          z.object({ kind: z.literal("inline"), data: strictDataset }).strict(),
          z
            .object({ kind: z.literal("context"), alias: id, version: text })
            .strict(),
        ]),
        parameters: z
          .array(parameter.strict().safeExtend({ unit: strictUnit.optional() }))
          .max(20),
        nodes: z
          .array(
            node.strict().extend({
              unit: strictUnit.optional(),
              inputs: z.array(strictInput).max(16),
            }),
          )
          .max(16),
        filters: z
          .array(
            z
              .object({
                field: id,
                operator: z.enum(["lte", "gte"]),
                parameter: id,
              })
              .strict(),
          )
          .max(20)
          .optional(),
        sections: z.array(section).min(1).max(8),
      })
      .strict(),
  })
  .strict()
  .superRefine((definition, ctx) => {
    const sections = definition.props.sections;
    const fail = (message: string) => ctx.addIssue({ code: "custom", message });
    if (sections.filter((s) => s.kind === "table").length !== 1)
      fail("required_table");
    for (const kind of ["parameters", "metrics", "notices"])
      if (sections.filter((s) => s.kind === kind).length > 1)
        fail("duplicate_section");
    if (
      definition.props.parameters.length &&
      !sections.some((s) => s.kind === "parameters")
    )
      fail("required_parameters");
    const charts = sections.filter((s) => s.kind === "chart");
    if (
      charts.length > 4 ||
      new Set(charts.map((s) => s.id)).size !== charts.length
    )
      fail("invalid_charts");
    for (const error of validateGraph(definition)) fail(error);
  });
export const explorerSchema = z.discriminatedUnion("version", [
  explorerV1Schema,
  explorerV2Schema,
]);

export function unitKey(u?: ExplorerUnit) {
  return !u || u.kind === "scalar"
    ? "scalar"
    : `${u.kind}:${u.code ?? ""}:${u.precision ?? ""}`;
}
export function validateGraph(d: ExplorerDefinition): string[] {
  const p = d.props,
    errors: string[] = [],
    seen = new Map<
      string,
      { stage: string; unit?: ExplorerUnit; vector: boolean }
    >();
  const columns = p.dataset.kind === "inline" ? p.dataset.data.columns : [];
  const ids = [
    ...columns.map((c) => c.id),
    ...p.parameters.map((p) => p.id),
    ...p.nodes.map((n) => n.id),
  ];
  if (new Set(ids).size !== ids.length) errors.push("duplicate_id");
  for (const n of p.nodes) {
    const aggregate = [
      "count",
      "sum",
      "min",
      "max",
      "average",
      "weighted",
    ].includes(n.operation);
    if (
      aggregate !== (n.stage === "aggregate") ||
      (n.stage === "aggregate" && !n.collection) ||
      (n.stage !== "aggregate" && n.collection)
    )
      errors.push("invalid_stage");
    const arity =
      n.operation === "count"
        ? 0
        : n.operation === "scale"
          ? 3
          : ["sum", "min", "max", "average"].includes(n.operation)
            ? 1
            : 2;
    if (n.inputs.length !== arity) errors.push("input_arity");
    const units = n.inputs.map((i) => {
      if ("constant" in i) {
        if (n.stage === "aggregate") errors.push("invalid_scalar_input");
        return i.unit;
      }
      if ("parameter" in i) {
        const v = p.parameters.find((x) => x.id === i.parameter);
        if (!v || n.stage === "aggregate")
          errors.push("invalid_parameter_reference");
        return v?.unit;
      }
      if ("field" in i) {
        const c = columns.find((x) => x.id === i.field);
        if (
          (p.dataset.kind === "inline" && (!c || c.type !== "number")) ||
          n.stage === "scalar"
        )
          errors.push("invalid_field_reference");
        return c?.unit;
      }
      const ref = seen.get(i.node);
      if (
        !ref ||
        ref.vector ||
        (n.stage !== "scalar" && ref.stage !== "row") ||
        (n.stage === "scalar" && ref.stage === "row")
      )
        errors.push("invalid_node_reference");
      return ref?.unit;
    });
    const keys = units.map((u, index) =>
        p.dataset.kind === "context" && "field" in n.inputs[index]
          ? "unresolved"
          : unitKey(u),
      ),
      out = unitKey(n.unit);
    if (
      ["add", "subtract", "sum", "min", "max", "average"].includes(
        n.operation,
      ) &&
      keys.some((k) => k !== "unresolved" && k !== out)
    )
      errors.push("unit_mismatch");
    if (
      ["multiply", "divide", "scale", "split", "weighted"].includes(
        n.operation,
      ) &&
      ((keys[0] !== "unresolved" && keys[0] !== out) ||
        keys.slice(1).some((k) => k !== "unresolved" && k !== "scalar"))
    )
      errors.push("unit_mismatch");
    if (n.operation === "count" && out !== "scalar")
      errors.push("unit_mismatch");
    if (n.operation === "split" && n.stage !== "scalar")
      errors.push("split_stage");
    seen.set(n.id, {
      stage: n.stage,
      unit: n.unit,
      vector: n.operation === "split",
    });
  }
  for (const f of p.filters ?? []) {
    const field =
        columns.find((c) => c.id === f.field) ||
        p.nodes.find((n) => n.id === f.field && n.stage === "row"),
      param = p.parameters.find((x) => x.id === f.parameter);
    if (
      !param ||
      (!field && p.dataset.kind === "inline") ||
      (!!field && unitKey(field.unit) !== unitKey(param?.unit))
    )
      errors.push("invalid_filter");
  }
  const metricIds =
    d.version === 2
      ? d.props.sections.flatMap((s) => (s.kind === "metrics" ? s.nodes : []))
      : (p.metrics ?? []);
  for (const key of metricIds)
    if (!seen.has(key) || seen.get(key)?.stage === "row")
      errors.push("invalid_metric");
  const charts =
    d.version === 2
      ? d.props.sections.filter((s) => s.kind === "chart")
      : p.chart
        ? [p.chart]
        : [];
  for (const chart of charts) {
    if (p.dataset.kind !== "inline") continue;
    for (const key of [
      chart.y,
      ...(chart.type === "scatter" ? [chart.x] : []),
    ]) {
      const column = columns.find((c) => c.id === key);
      if (column && column.type !== "number") errors.push("invalid_chart_type");
    }
    for (const key of [chart.x, chart.y])
      if (
        p.dataset.kind === "inline" &&
        !columns.some((c) => c.id === key) &&
        !p.nodes.some((n) => n.id === key && n.stage === "row")
      )
        errors.push("invalid_chart");
  }
  return errors;
}
