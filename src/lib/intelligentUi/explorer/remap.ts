import { explorerDatasetSchema, unitKey } from "./schema";
import type { ExplorerColumn, ExplorerDataset, ExplorerError } from "./types";

/** Explicit user-confirmed projection. Column names never establish identity. */
export function remapExplorerImport(
  imported: ExplorerDataset,
  expectedColumns: ExplorerColumn[],
  mapping: Record<string, string>,
): {
  dataset: ExplorerDataset | null;
  errors: ExplorerError[];
  omittedColumns: string[];
} {
  const errors: ExplorerError[] = [];
  const omittedColumns = imported.columns
    .filter((column) => !Object.values(mapping).includes(column.id))
    .map((column) => column.id);
  if (!explorerDatasetSchema.safeParse(imported).success) {
    return {
      dataset: null,
      errors: [{ code: "invalid_dataset" }],
      omittedColumns,
    };
  }
  const targets = new Set(expectedColumns.map((column) => column.id));
  if (targets.size !== expectedColumns.length) {
    errors.push({ code: "duplicate_id" });
  }
  for (const target of Object.keys(mapping)) {
    if (!targets.has(target))
      errors.push({ code: "unknown_mapping", field: target });
  }
  const mapped = new Set<string>();
  for (const target of expectedColumns) {
    const sourceId = Object.hasOwn(mapping, target.id)
      ? mapping[target.id]
      : undefined;
    const source = imported.columns.find((column) => column.id === sourceId);
    if (!source) {
      errors.push({ code: "missing_mapping", field: target.id });
      continue;
    }
    if (mapped.has(source.id))
      errors.push({ code: "duplicate_mapping", field: target.id });
    mapped.add(source.id);
    if (source.type !== target.type)
      errors.push({ code: "mapping_type_mismatch", field: target.id });
    // Imported unannotated numerics acquire only the unit explicitly shown by
    // the mapping confirmation. Existing unit declarations cannot be overridden.
    if (source.unit && unitKey(source.unit) !== unitKey(target.unit)) {
      errors.push({ code: "mapping_unit_mismatch", field: target.id });
    }
    if (target.unit?.kind === "currency") {
      const precision = target.unit.precision;
      if (
        precision === undefined ||
        !Number.isInteger(precision) ||
        precision < 0 ||
        precision > 8 ||
        !target.unit.code
      ) {
        errors.push({ code: "mapping_unit_mismatch", field: target.id });
        continue;
      }
      const factor = 10 ** precision;
      for (const row of imported.rows) {
        const value = row.values[source.id];
        if (value === null) continue;
        if (
          typeof value !== "number" ||
          !Number.isFinite(value) ||
          !Number.isSafeInteger(Math.round(value * factor)) ||
          Math.abs(value * factor - Math.round(value * factor)) > 1e-7
        ) {
          errors.push({
            code: "invalid_currency",
            field: target.id,
            row: row.id,
          });
        }
      }
    }
  }
  if (errors.length) return { dataset: null, errors, omittedColumns };
  const columns = expectedColumns.map((column) => ({
    ...column,
    ...(column.unit ? { unit: { ...column.unit } } : {}),
  }));
  const rows = imported.rows.map((row) => ({
    id: row.id,
    values: Object.fromEntries(
      columns.map((column) => [column.id, row.values[mapping[column.id]]]),
    ),
  }));
  const content = JSON.stringify({ columns, rows });
  let hash = 2166136261;
  for (const character of content) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  const dataset: ExplorerDataset = {
    id: imported.id,
    version: `mapped-${(hash >>> 0).toString(16)}`,
    columns,
    rows,
  };
  if (!explorerDatasetSchema.safeParse(dataset).success) {
    return {
      dataset: null,
      errors: [{ code: "invalid_dataset" }],
      omittedColumns,
    };
  }
  return { dataset, errors, omittedColumns };
}
