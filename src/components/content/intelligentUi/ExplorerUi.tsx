"use client";

import React, { useEffect, useId, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useLocale, useTranslations } from "next-intl";
import { Button, Field } from "@/components/ui/primitives";
import { CustomSelect } from "@/components/ui/controls";
import type { JsonObject } from "@/lib/intelligentUi/types";
import { formatExplorerMetricExplanation } from "@/lib/intelligentUi/presentation";
import {
  deriveExplorer,
  parseExplorerImport,
  remapExplorerImport,
  type ExplorerColumn,
  type ExplorerDataset,
  type ExplorerDefinition,
} from "@/lib/intelligentUi/explorer";

const ChartBlock = dynamic(
  () =>
    import("@/components/content/markdown/ChartBlock").then(
      (module) => module.ChartBlock,
    ),
  { ssr: false },
);

const control =
  "min-w-0 max-w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:border-border dark:bg-card dark:text-foreground";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function explorerChartSource(
  type: "bar" | "line" | "scatter",
  x: string,
  y: string,
  rows: { values: Record<string, unknown> }[],
): string {
  const seriesType = type === "scatter" ? "scatter" : type;
  return JSON.stringify({
    version: 1,
    renderer: "echarts",
    data: {
      kind: "inline",
      dimensions: [x, y],
      source: rows.map((row) => [row.values[x] ?? null, row.values[y] ?? null]),
    },
    spec: {
      xAxis: { type: type === "scatter" ? "value" : "category" },
      yAxis: { type: "value" },
      series: [{ type: seriesType, encode: { x, y } }],
    },
  });
}

function displayCell(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

function unitText(unit: ExplorerColumn["unit"], kindLabel: string): string {
  if (!unit) return "";
  const code = unit.code ? ` ${unit.code}` : "";
  const precision = unit.precision === undefined ? "" : ` (p${unit.precision})`;
  return `${kindLabel}${code}${precision}`;
}

interface ExplorerChartPointEvent {
  componentType?: string;
  seriesType?: string;
  seriesIndex?: number;
  dataIndex?: number;
}

export interface ExplorerUiProps {
  definition: ExplorerDefinition;
  state: JsonObject;
  onChange: (state: JsonObject) => void;
  /** Host-resolved context data or an explicitly confirmed local import. */
  dataset?: ExplorerDataset;
  expectedDataset?: ExplorerDataset;
  onImportDataset?: (dataset: ExplorerDataset) => void;
  datasetProvenance?: "user" | "source" | "example";
}

export default function ExplorerUi({
  definition,
  state: inputState,
  onChange,
  dataset,
  expectedDataset,
  onImportDataset,
  datasetProvenance,
}: ExplorerUiProps) {
  const t = useTranslations("IntelligentUi");
  const locale = useLocale();
  const prefix = useId();
  const result = deriveExplorer(definition, inputState, dataset);
  const state = result.state;
  const [importText, setImportText] = useState("");
  const [importFormat, setImportFormat] = useState<"csv" | "json">("csv");
  const [importOpen, setImportOpen] = useState(false);
  const [typeOverrides, setTypeOverrides] = useState<
    Record<string, ExplorerColumn["type"]>
  >({});
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [importAttempted, setImportAttempted] = useState(false);
  const [page, setPage] = useState(0);
  const pageSize = 25;
  const rangeValues = record(state.ranges);
  const visibleColumns = result.columns.filter((column) =>
    state.visibleColumns.includes(column.id),
  );
  const selected = new Set(strings(state.selected));
  const importResult = useMemo(
    () =>
      importText.trim()
        ? parseExplorerImport(importText, importFormat, typeOverrides)
        : { dataset: null, preview: null, errors: [] },
    [importFormat, importText, typeOverrides],
  );
  const expectedColumns = useMemo(
    () =>
      (
        expectedDataset ??
        (definition.props.dataset.kind === "inline"
          ? definition.props.dataset.data
          : dataset)
      )?.columns ?? [],
    [dataset, definition.props.dataset, expectedDataset],
  );
  const remapResult = useMemo(() => {
    if (!importResult.preview || !importResult.dataset)
      return { dataset: null, errors: [], omittedColumns: [] };
    if (expectedColumns.length)
      return remapExplorerImport(
        importResult.dataset,
        expectedColumns,
        mapping,
      );
    return {
      dataset: null,
      errors: [{ code: "unresolved_dataset" }],
      omittedColumns: importResult.preview.columns.map((column) => column.id),
    };
  }, [expectedColumns, importResult.dataset, importResult.preview, mapping]);
  const pageCount = Math.max(1, Math.ceil(result.rows.length / pageSize));
  const currentPage = Math.min(page, pageCount - 1);
  const pageRows = result.rows.slice(
    currentPage * pageSize,
    (currentPage + 1) * pageSize,
  );
  // The chart always represents the current filtered dataset. Selection is
  // reserved for metrics, so clicking a point never hides other rows.
  const chartRows = result.chart?.rows ?? [];

  const patch = (next: JsonObject) => {
    setPage(0);
    onChange({ ...inputState, ...next });
  };
  const patchParameters = (next: Record<string, unknown>) =>
    patch({
      parameters: { ...record(inputState.parameters), ...next } as JsonObject,
    });
  const patchRanges = (columnId: string, edge: "min" | "max", value: string) =>
    patch({
      ranges: {
        ...rangeValues,
        [columnId]: {
          ...record(rangeValues[columnId]),
          [edge]: value,
        },
      } as JsonObject,
    });
  const toggleSelected = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    patch({ selected: Array.from(next) });
  };
  const toggleColumn = (id: string) => {
    const next = new Set(strings(state.visibleColumns));
    if (next.has(id)) next.delete(id);
    else next.add(id);
    patch({ visibleColumns: Array.from(next) });
  };

  const handleChartPointClick = (event: ExplorerChartPointEvent) => {
    if (event.componentType && event.componentType !== "series") return;
    if (
      event.seriesType &&
      !["bar", "line", "scatter"].includes(event.seriesType)
    )
      return;
    if (event.seriesIndex !== undefined && event.seriesIndex !== 0) return;
    if (
      event.dataIndex === undefined ||
      !Number.isInteger(event.dataIndex) ||
      event.dataIndex < 0 ||
      event.dataIndex >= chartRows.length
    )
      return;
    const row = chartRows[event.dataIndex];
    if (row) toggleSelected(row.id);
  };

  const importPreview = importResult.preview;
  const importErrors = [...importResult.errors, ...remapResult.errors];
  const confirmImport = () => {
    setImportAttempted(true);
    if (remapResult.dataset) {
      onImportDataset?.(remapResult.dataset);
      setImportText("");
      setTypeOverrides({});
      setMapping({});
      setImportAttempted(false);
      setImportOpen(false);
    }
  };

  useEffect(() => {
    setMapping({});
  }, [importFormat, importText]);

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        {t(`provenance.${datasetProvenance ?? definition.props.provenance}`)}
        {result.datasetVersion ? ` · ${result.datasetVersion}` : ""}
      </p>

      {definition.props.parameters.length > 0 && (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">
            {t("explorer.parameters")}
          </legend>
          <div className="grid gap-3 sm:grid-cols-2">
            {definition.props.parameters.map((parameter) => {
              const value = record(state.parameters)[parameter.id];
              const error = result.parameterErrors[parameter.id];
              const id = `${prefix}-${parameter.id}`;
              return (
                <Field
                  key={parameter.id}
                  label={parameter.label}
                  htmlFor={id}
                  error={error ? t(`explorer.errors.${error}`) : undefined}
                >
                  <input
                    id={id}
                    className={control}
                    type="number"
                    min={parameter.min}
                    max={parameter.max}
                    step={parameter.step ?? "any"}
                    value={
                      typeof value === "number" ? value : String(value ?? "")
                    }
                    onChange={(event) =>
                      patchParameters({
                        [parameter.id]:
                          event.target.value === ""
                            ? ""
                            : Number(event.target.value),
                      })
                    }
                    aria-invalid={error ? true : undefined}
                  />
                </Field>
              );
            })}
          </div>
        </fieldset>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("explorer.search")} htmlFor={`${prefix}-search`}>
          <input
            id={`${prefix}-search`}
            className={control}
            value={state.search}
            onChange={(event) => patch({ search: event.target.value })}
          />
        </Field>
        <Field label={t("sort")} htmlFor={`${prefix}-sort`}>
          <CustomSelect
            id={`${prefix}-sort`}
            ariaLabel={t("sort")}
            value={state.sortKey}
            onChange={(sortKey) => patch({ sortKey })}
            options={[
              { value: "", label: t("name") },
              ...result.columns.map((column) => ({
                value: column.id,
                label: column.label,
              })),
            ]}
          />
        </Field>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={state.descending}
            onChange={(event) => patch({ descending: event.target.checked })}
          />
          {t("descending")}
        </label>
        <span role="status">
          {t("explorer.rowCount", { count: result.rows.length })}
        </span>
        <span role="status">
          {t("explorer.selectedCount", { count: selected.size })}
        </span>
      </div>

      <details>
        <summary className="cursor-pointer text-sm font-medium">
          {t("explorer.visibleColumns")}
        </summary>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {result.columns.map((column) => (
            <label key={column.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={state.visibleColumns.includes(column.id)}
                onChange={() => toggleColumn(column.id)}
              />
              {column.label}
            </label>
          ))}
        </div>
      </details>

      {result.columns.some(
        (column) => column.type === "number" || column.type === "date",
      ) && (
        <details>
          <summary className="cursor-pointer text-sm font-medium">
            {t("explorer.ranges")}
          </summary>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            {result.columns
              .filter(
                (column) => column.type === "number" || column.type === "date",
              )
              .map((column) => {
                const range = record(rangeValues[column.id]);
                const rangeError = result.errors.some(
                  (error) =>
                    error.code === "invalid_range" && error.field === column.id,
                );
                const rangeErrorId = `${prefix}-${column.id}-range-error`;
                return (
                  <div key={column.id} className="grid grid-cols-2 gap-2">
                    <span className="col-span-2 text-sm">{column.label}</span>
                    <input
                      className={control}
                      aria-label={t("explorer.minimumFor", {
                        name: column.label,
                      })}
                      type={column.type === "date" ? "date" : "text"}
                      inputMode={column.type === "date" ? undefined : "decimal"}
                      value={
                        typeof range.min === "string" ||
                        typeof range.min === "number"
                          ? String(range.min)
                          : ""
                      }
                      aria-invalid={rangeError ? true : undefined}
                      aria-describedby={rangeError ? rangeErrorId : undefined}
                      onChange={(event) =>
                        patchRanges(column.id, "min", event.target.value)
                      }
                    />
                    <input
                      className={control}
                      aria-label={t("explorer.maximumFor", {
                        name: column.label,
                      })}
                      type={column.type === "date" ? "date" : "text"}
                      inputMode={column.type === "date" ? undefined : "decimal"}
                      value={
                        typeof range.max === "string" ||
                        typeof range.max === "number"
                          ? String(range.max)
                          : ""
                      }
                      aria-invalid={rangeError ? true : undefined}
                      aria-describedby={rangeError ? rangeErrorId : undefined}
                      onChange={(event) =>
                        patchRanges(column.id, "max", event.target.value)
                      }
                    />
                    {rangeError && (
                      <p
                        id={rangeErrorId}
                        role="alert"
                        className="col-span-2 text-xs text-red-600"
                      >
                        {t("explorer.errors.invalid_range")}
                      </p>
                    )}
                  </div>
                );
              })}
          </div>
        </details>
      )}

      {result.errors.length > 0 && (
        <div role="alert" className="space-y-1 text-sm text-red-600">
          {Array.from(new Set(result.errors.map((error) => error.code))).map(
            (code) => (
              <p key={code}>{t(`explorer.errors.${code}`)}</p>
            ),
          )}
        </div>
      )}

      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full min-w-[36rem] text-left text-sm">
          <thead>
            <tr>
              <th className="p-2">
                <span className="sr-only">{t("explorer.selectRow")}</span>
                <input
                  type="checkbox"
                  aria-label={t("explorer.selectVisible")}
                  checked={
                    pageRows.length > 0 &&
                    pageRows.every((row) => selected.has(row.id))
                  }
                  onChange={(event) => {
                    const next = new Set(selected);
                    pageRows.forEach((row) =>
                      event.target.checked
                        ? next.add(row.id)
                        : next.delete(row.id),
                    );
                    patch({ selected: Array.from(next) });
                  }}
                />
              </th>
              {visibleColumns.map((column) => (
                <th className="p-2" scope="col" key={column.id}>
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((row) => (
              <tr className="border-t border-border" key={row.id}>
                <td className="p-2">
                  <input
                    type="checkbox"
                    aria-label={t("explorer.selectRowNamed", { id: row.id })}
                    checked={selected.has(row.id)}
                    onChange={() => toggleSelected(row.id)}
                  />
                </td>
                {visibleColumns.map((column) => (
                  <td className="p-2" key={column.id}>
                    {displayCell(row.values[column.id])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {pageRows.length === 0 && (
          <p className="p-3 text-sm" role="status">
            {t("explorer.noRows")}
          </p>
        )}
      </div>

      {pageCount > 1 && (
        <nav
          className="flex items-center justify-between gap-2"
          aria-label={t("explorer.pagination")}
        >
          <Button
            size="sm"
            disabled={currentPage === 0}
            onClick={() => setPage((value) => Math.max(0, value - 1))}
          >
            {t("explorer.previous")}
          </Button>
          <span className="text-sm" role="status">
            {t("explorer.page", { page: currentPage + 1, total: pageCount })}
          </span>
          <Button
            size="sm"
            disabled={currentPage >= pageCount - 1}
            onClick={() =>
              setPage((value) => Math.min(pageCount - 1, value + 1))
            }
          >
            {t("explorer.next")}
          </Button>
        </nav>
      )}

      {result.metrics && Object.keys(result.metrics).length > 0 && (
        <section className="space-y-2" aria-label={t("explorer.metrics")}>
          <h4 className="text-sm font-medium">{t("explorer.metrics")}</h4>
          <dl className="grid gap-2 sm:grid-cols-2">
            {definition.props.nodes
              .filter((node) => {
                const requested = definition.props.metrics;
                return (
                  node.stage !== "row" &&
                  (!requested?.length || requested.includes(node.id)) &&
                  Object.hasOwn(result.metrics, node.id)
                );
              })
              .map((node) => (
                <div
                  className="rounded-md bg-muted/40 p-2 text-sm"
                  key={node.id}
                >
                  <dt>{node.label}</dt>
                  <dd className="font-medium tabular-nums">
                    {displayCell(result.metrics[node.id])}
                  </dd>
                  {result.metricExplanations[node.id] && (
                    <dd className="text-xs font-normal text-muted-foreground">
                      {formatExplorerMetricExplanation(
                        result.metricExplanations[node.id],
                        locale,
                      )}
                    </dd>
                  )}
                </div>
              ))}
          </dl>
        </section>
      )}

      {result.chart && result.chart.rows.length > 0 && (
        <section className="space-y-2" aria-label={t("explorer.chart")}>
          <h4 className="text-sm font-medium">{t("explorer.chart")}</h4>
          <ChartBlock
            source={explorerChartSource(
              result.chart.type,
              result.chart.x,
              result.chart.y,
              chartRows,
            )}
            incomplete={false}
            onDataPointClick={handleChartPointClick}
          />
        </section>
      )}

      {onImportDataset && (
        <section className="space-y-2 border-t border-border pt-3">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setImportOpen((value) => !value)}
          >
            {t("explorer.importData")}
          </Button>
          {importOpen && (
            <div className="space-y-3 rounded-md bg-muted/30 p-3">
              <div className="grid gap-3 sm:grid-cols-[auto_1fr]">
                <CustomSelect
                  ariaLabel={t("explorer.importFormat")}
                  value={importFormat}
                  onChange={(value) => setImportFormat(value as "csv" | "json")}
                  options={[
                    { value: "csv", label: t("explorer.csv") },
                    { value: "json", label: t("explorer.json") },
                  ]}
                />
                <textarea
                  className={`${control} min-h-28 font-mono`}
                  aria-label={t("explorer.pasteData")}
                  placeholder={t("explorer.importPlaceholder")}
                  value={importText}
                  onChange={(event) => {
                    setImportText(event.target.value);
                    setImportAttempted(false);
                  }}
                />
              </div>
              {importPreview && (
                <div className="space-y-2">
                  <p className="text-sm font-medium">
                    {t("explorer.importPreview")}
                  </p>
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-left text-xs">
                      <thead>
                        <tr>
                          {importPreview.columns.map((column) => (
                            <th className="p-1" key={column.id}>
                              <label className="flex flex-col gap-1">
                                {column.label}
                                <CustomSelect
                                  value={
                                    typeOverrides[column.id] ?? column.type
                                  }
                                  ariaLabel={t("explorer.columnType", {
                                    name: column.label,
                                  })}
                                  onChange={(value) =>
                                    setTypeOverrides((current) => ({
                                      ...current,
                                      [column.id]:
                                        value as ExplorerColumn["type"],
                                    }))
                                  }
                                  options={(
                                    [
                                      "text",
                                      "number",
                                      "boolean",
                                      "date",
                                    ] as const
                                  ).map((type) => ({
                                    value: type,
                                    label: t(`explorer.types.${type}`),
                                  }))}
                                />
                              </label>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {importPreview.rows.slice(0, 5).map((row) => (
                          <tr key={row.id}>
                            {importPreview.columns.map((column) => (
                              <td
                                className="border-t border-border p-1"
                                key={column.id}
                              >
                                {displayCell(row.values[column.id])}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {expectedColumns.length > 0 && (
                    <fieldset className="space-y-2">
                      <legend className="text-sm font-medium">
                        {t("explorer.mapColumns")}
                      </legend>
                      <p className="text-xs text-muted-foreground">
                        {t("explorer.mapColumnsHint")}
                      </p>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {expectedColumns.map((column) => (
                          <label
                            className="flex min-w-0 flex-col gap-1 text-sm"
                            key={column.id}
                          >
                            {[
                              column.label,
                              t(`explorer.types.${column.type}`),
                              column.unit
                                ? unitText(
                                    column.unit,
                                    t(`explorer.units.${column.unit.kind}`),
                                  )
                                : "",
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                            <CustomSelect
                              ariaLabel={t("explorer.mapColumn", {
                                name: column.label,
                              })}
                              value={mapping[column.id] ?? ""}
                              onChange={(sourceId) =>
                                setMapping((current) => ({
                                  ...current,
                                  [column.id]: sourceId,
                                }))
                              }
                              options={[
                                {
                                  value: "",
                                  label: t("explorer.chooseColumn"),
                                },
                                ...importPreview.columns.map((source) => ({
                                  value: source.id,
                                  label: [
                                    source.label,
                                    t(`explorer.types.${source.type}`),
                                    source.unit
                                      ? unitText(
                                          source.unit,
                                          t(
                                            `explorer.units.${source.unit.kind}`,
                                          ),
                                        )
                                      : "",
                                  ]
                                    .filter(Boolean)
                                    .join(" · "),
                                })),
                              ]}
                            />
                          </label>
                        ))}
                      </div>
                    </fieldset>
                  )}
                  {remapResult.omittedColumns.length > 0 && (
                    <p className="text-xs text-muted-foreground">
                      {t("explorer.omittedColumns", {
                        columns: remapResult.omittedColumns
                          .map(
                            (id) =>
                              importPreview.columns.find(
                                (column) => column.id === id,
                              )?.label ?? id,
                          )
                          .join(", "),
                      })}
                    </p>
                  )}
                </div>
              )}
              {importErrors.length > 0 && (
                <div role="alert" className="space-y-1 text-sm text-red-600">
                  {Array.from(
                    new Set(importErrors.map((error) => error.code)),
                  ).map((code) => (
                    <p key={code}>{t(`explorer.errors.${code}`)}</p>
                  ))}
                </div>
              )}
              {importAttempted &&
                !remapResult.dataset &&
                importErrors.length === 0 && (
                  <p role="alert" className="text-sm text-red-600">
                    {t("explorer.importInvalid")}
                  </p>
                )}
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  onClick={confirmImport}
                  disabled={!remapResult.dataset}
                >
                  {t("explorer.confirmImport")}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setImportText("");
                    setTypeOverrides({});
                    setMapping({});
                    setImportAttempted(false);
                  }}
                >
                  {t("explorer.resetImport")}
                </Button>
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
