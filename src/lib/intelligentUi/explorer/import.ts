import { explorerDatasetSchema, validExplorerDate } from "./schema";
import type {
  ExplorerCell,
  ExplorerColumn,
  ExplorerDataset,
  ExplorerError,
} from "./types";
function csvRows(text: string): string[][] {
  const rows: string[][] = [],
    row: string[] = [];
  let value = "",
    quoted = false,
    closed = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          value += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else value += c;
    } else if (c === '"') {
      if (value || closed) throw Error("invalid_csv");
      quoted = true;
    } else if (c === "," || c === "\n" || c === "\r") {
      row.push(value);
      value = "";
      closed = false;
      if (c !== ",") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        rows.push([...row]);
        row.length = 0;
      }
    } else {
      if (closed) throw Error("invalid_csv");
      value += c;
    }
  }
  if (quoted) throw Error("invalid_csv");
  if (value || row.length || closed) {
    row.push(value);
    rows.push(row);
  }
  return rows;
}
export function parseExplorerImport(
  text: string,
  format: "csv" | "json",
  overrides: Record<string, ExplorerColumn["type"]> = {},
) {
  const errors: ExplorerError[] = [];
  let preview: ExplorerDataset | null = null;
  try {
    if (new TextEncoder().encode(text).length > 1048576)
      throw Error("dataset_too_large");
    let names: string[], raw: unknown[][];
    if (format === "csv") {
      const parsed = csvRows(text.replace(/^\uFEFF/, ""));
      names = parsed.shift() ?? [];
      raw = parsed;
    } else {
      const value: unknown = JSON.parse(text);
      if (
        !Array.isArray(value) ||
        value.some((v) => !v || typeof v !== "object" || Array.isArray(v))
      )
        throw Error("invalid_json_rows");
      names = [...new Set(value.flatMap((v) => Object.keys(v)))];
      raw = value.map((v) =>
        names.map((n) => (Object.hasOwn(v, n) ? v[n] : null)),
      );
    }
    if (!names.length || names.length > 20 || raw.length > 1000)
      throw Error("dataset_too_large");
    if (
      new Set(names).size !== names.length ||
      names.some(
        (n) => !n || ["__proto__", "prototype", "constructor"].includes(n),
      )
    )
      throw Error("invalid_columns");
    const infer = (values: unknown[]): ExplorerColumn["type"] => {
      const present = values.filter((v) => v !== null && v !== "");
      if (!present.length) return "text";
      if (
        present.every(
          (v) => typeof v === "boolean" || v === "true" || v === "false",
        )
      )
        return "boolean";
      if (
        present.every(
          (v) =>
            typeof v === "number" ||
            (typeof v === "string" &&
              /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(v) &&
              Number.isFinite(Number(v))),
        )
      )
        return "number";
      if (present.every((v) => typeof v === "string" && validExplorerDate(v)))
        return "date";
      return "text";
    };
    const columns = names.map((label, i) => ({
      id: `c${i + 1}`,
      label,
      type: overrides[`c${i + 1}`] ?? infer(raw.map((r) => r[i])),
    }));
    const rows = raw.map((row, index) => {
      const id = `r${index + 1}`;
      if (row.length !== columns.length)
        errors.push({ code: "invalid_row_width", row: id });
      const values: Record<string, ExplorerCell> = {};
      columns.forEach((c, i) => {
        const value = row[i];
        let cell: ExplorerCell = null;
        if (value !== null && value !== undefined && value !== "") {
          if (typeof value === "object") {
            errors.push({ code: "invalid_cell", row: id, field: c.id });
          } else if (c.type === "number") {
            const number =
              typeof value === "number"
                ? value
                : typeof value === "string" && value.trim() !== ""
                  ? Number(value)
                  : NaN;
            if (Number.isFinite(number)) cell = number;
            else errors.push({ code: "invalid_number", row: id, field: c.id });
          } else if (c.type === "boolean") {
            if (value === true || value === "true") cell = true;
            else if (value === false || value === "false") cell = false;
            else errors.push({ code: "invalid_boolean", row: id, field: c.id });
          } else if (c.type === "date") {
            if (typeof value === "string" && validExplorerDate(value))
              cell = value;
            else errors.push({ code: "invalid_date", row: id, field: c.id });
          } else cell = String(value);
        }
        values[c.id] = cell;
      });
      return { id, values };
    });
    // This label identifies local content only; source authority belongs to the host.
    let hash = 2166136261;
    for (const c of JSON.stringify({ columns, rows })) {
      hash ^= c.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    }
    preview = {
      id: "import",
      version: `local-${(hash >>> 0).toString(16)}`,
      columns,
      rows,
    };
    if (!explorerDatasetSchema.safeParse(preview).success)
      errors.push({ code: "invalid_dataset" });
  } catch (error) {
    errors.push({
      code: error instanceof Error ? error.message : "invalid_import",
    });
  }
  return { dataset: errors.length ? null : preview, preview, errors };
}
