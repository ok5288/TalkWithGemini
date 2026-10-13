"use client";

import React, { useId, useState } from "react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/primitives";
import { CustomSelect } from "@/components/ui/controls";
import type {
  NativeDefinition,
  JsonObject,
  JsonValue,
} from "@/lib/intelligentUi/types";
import type { ExplorerDataset } from "@/lib/intelligentUi/explorer";
import { calculateUi } from "@/lib/intelligentUi/calculations";
import {
  deriveComparison,
  deriveChart,
  getFormErrors,
  hasValidUiInputs,
  normalizeNativeState,
} from "@/lib/intelligentUi/catalog";
import { FlashcardsUi, QuizUi } from "./LearningUi";
import ExplorerUi from "./ExplorerUi";

const ChartBlock = dynamic(
  () =>
    import("@/components/content/markdown/ChartBlock").then(
      (m) => m.ChartBlock,
    ),
  { ssr: false },
);
const control =
  "min-w-0 max-w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:border-border dark:bg-card dark:text-foreground";
const strings = (value: JsonValue | undefined): string[] =>
  Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string")
    : [];
const record = (value: JsonValue | undefined): JsonObject =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};

export interface NativeUiProps {
  definition: NativeDefinition;
  state: JsonObject;
  onChange: (state: JsonObject) => void;
  dataset?: ExplorerDataset;
  expectedDataset?: ExplorerDataset;
  onImportDataset?: (dataset: ExplorerDataset) => void;
  datasetProvenance?: "user" | "source" | "example";
  onPendingImportChange?: (pending: boolean) => void;
}

export default function NativeUi({
  definition,
  state: inputState,
  onChange,
  dataset,
  expectedDataset,
  onImportDataset,
  datasetProvenance,
  onPendingImportChange,
}: NativeUiProps) {
  const state = normalizeNativeState(definition, inputState);
  const t = useTranslations("IntelligentUi");
  const prefix = useId();
  const [formValidated, setFormValidated] = useState(false);
  const patch = (next: JsonObject) => onChange({ ...state, ...next });
  const toggle = (values: string[], id: string) =>
    values.includes(id)
      ? values.filter((value) => value !== id)
      : [...values, id];
  if (definition.kind === "explorer") {
    return (
      <ExplorerUi
        definition={definition}
        state={inputState}
        onChange={onChange}
        dataset={dataset}
        expectedDataset={expectedDataset}
        onImportDataset={onImportDataset}
        datasetProvenance={datasetProvenance}
        onPendingImportChange={onPendingImportChange}
      />
    );
  }
  if (definition.kind === "checklist") {
    const checked = strings(state.checked);
    return (
      <div className="space-y-3">
        <p role="status" className="text-sm text-muted-foreground">
          {t("completed", {
            count: definition.props.items.filter((item) =>
              checked.includes(item.id),
            ).length,
            total: definition.props.items.length,
          })}
        </p>
        <ul className="space-y-2">
          {definition.props.items.map((item) => (
            <li key={item.id}>
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={checked.includes(item.id)}
                  onChange={() => patch({ checked: toggle(checked, item.id) })}
                  className="mt-1 accent-red-600"
                />
                <span
                  className={
                    checked.includes(item.id)
                      ? "line-through text-muted-foreground"
                      : ""
                  }
                >
                  {item.label}
                </span>
              </label>
            </li>
          ))}
        </ul>
      </div>
    );
  }
  if (definition.kind === "comparison") {
    const { columns, provenance } = definition.props;
    const {
      state: comparison,
      items: filtered,
      numericColumns,
    } = deriveComparison(definition, state);
    const { filter, sortKey, selected, numericFilterKey } = comparison;
    const minimum = comparison.min,
      maximum = comparison.max;
    return (
      <div className="space-y-3">
        <p className="text-xs text-muted-foreground">
          {t(`provenance.${provenance}`)}
        </p>
        <div className="flex flex-wrap gap-2">
          <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
            {t("filter")}
            <input
              className={control}
              value={filter}
              onChange={(e) => patch({ filter: e.target.value })}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            {t("sort")}
            <CustomSelect
              ariaLabel={t("sort")}
              value={sortKey}
              onChange={(sortKey) => patch({ sortKey })}
              options={[
                { value: "", label: t("name") },
                ...columns.map((column) => ({
                  value: column.key,
                  label: column.label,
                })),
              ]}
            />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={state.descending === true}
              onChange={(e) => patch({ descending: e.target.checked })}
            />
            {t("descending")}
          </label>
        </div>
        {numericColumns.length > 0 && (
          <div className="grid gap-2 sm:grid-cols-3">
            <label className="flex min-w-0 flex-col gap-1 text-sm">
              {t("numericFilter")}
              <CustomSelect
                ariaLabel={t("numericFilter")}
                value={numericFilterKey}
                onChange={(numericFilterKey) => patch({ numericFilterKey })}
                options={[
                  { value: "", label: t("allValues") },
                  ...numericColumns.map((column) => ({
                    value: column.key,
                    label: column.label,
                  })),
                ]}
              />
            </label>
            <label className="flex min-w-0 flex-col gap-1 text-sm">
              {t("minimum")}
              <input
                className={control}
                type="number"
                step="any"
                disabled={!numericFilterKey}
                value={minimum ?? ""}
                onChange={(event) =>
                  patch({
                    min:
                      event.target.value === ""
                        ? ""
                        : Number(event.target.value),
                  })
                }
              />
            </label>
            <label className="flex min-w-0 flex-col gap-1 text-sm">
              {t("maximum")}
              <input
                className={control}
                type="number"
                step="any"
                disabled={!numericFilterKey}
                value={maximum ?? ""}
                onChange={(event) =>
                  patch({
                    max:
                      event.target.value === ""
                        ? ""
                        : Number(event.target.value),
                  })
                }
              />
            </label>
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr>
                <th className="p-2">{t("select")}</th>
                <th className="p-2">{t("name")}</th>
                {columns.map((column) => (
                  <th className="p-2" key={column.key}>
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((item) => (
                <tr className="border-t border-border" key={item.id}>
                  <td className="p-2">
                    <input
                      aria-label={t("selectItem", { name: item.label })}
                      type="checkbox"
                      checked={selected.includes(item.id)}
                      onChange={() =>
                        patch({ selected: toggle(selected, item.id) })
                      }
                    />
                  </td>
                  <th scope="row" className="p-2 font-medium">
                    {item.label}
                  </th>
                  {columns.map((column) => (
                    <td key={column.key} className="p-2">
                      {String(item.values[column.key] ?? "—")}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && <p role="status">{t("noResults")}</p>}
        </div>
      </div>
    );
  }
  if (definition.kind === "form") {
    const values = record(state.values);
    const errors = getFormErrors(definition, state);
    return (
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          setFormValidated(true);
        }}
      >
        <div className="grid gap-3">
          {definition.props.fields.map((field) => {
            const id = `${prefix}-${field.id}`;
            const value =
              values[field.id] ??
              field.defaultValue ??
              (field.type === "checkbox" ? false : "");
            const update = (next: JsonValue) => {
              setFormValidated(false);
              patch({ values: { ...values, [field.id]: next } });
            };
            const error = formValidated ? errors[field.id] : undefined;
            const common = {
              id,
              required: field.required,
              className: control,
              "aria-describedby": error
                ? `${id}-error`
                : field.required
                  ? `${id}-hint`
                  : undefined,
              "aria-invalid": error ? true : undefined,
            };
            return (
              <div key={field.id} className="flex min-w-0 flex-col gap-1">
                <label htmlFor={id} className="text-sm font-medium">
                  {field.label}
                  {field.required ? " *" : ""}
                </label>
                {field.type === "select" ? (
                  <CustomSelect
                    id={id}
                    ariaLabel={field.label}
                    required={field.required}
                    aria-describedby={common["aria-describedby"]}
                    aria-invalid={error ? true : undefined}
                    value={String(value)}
                    onChange={update}
                    options={[
                      { value: "", label: t("choose") },
                      ...(field.options ?? []),
                    ]}
                  />
                ) : field.type === "multiselect" ? (
                  <div
                    role="group"
                    aria-label={field.label}
                    aria-describedby={common["aria-describedby"]}
                    className="space-y-2"
                  >
                    {field.options?.map((option) => (
                      <label
                        key={option.value}
                        className="flex items-center gap-2 text-sm"
                      >
                        <input
                          type="checkbox"
                          aria-invalid={error ? true : undefined}
                          aria-describedby={common["aria-describedby"]}
                          checked={strings(value).includes(option.value)}
                          onChange={() =>
                            update(toggle(strings(value), option.value))
                          }
                        />
                        {option.label}
                      </label>
                    ))}
                  </div>
                ) : field.type === "checkbox" ? (
                  <input
                    {...common}
                    type="checkbox"
                    checked={value === true}
                    onChange={(e) => update(e.target.checked)}
                    className="size-4 accent-red-600"
                  />
                ) : (
                  <input
                    {...common}
                    type={field.type}
                    min={field.min}
                    max={field.max}
                    step={field.step ?? "any"}
                    value={
                      typeof value === "number" || typeof value === "string"
                        ? value
                        : ""
                    }
                    onChange={(e) =>
                      update(
                        field.type === "number" || field.type === "range"
                          ? e.target.value === ""
                            ? ""
                            : Number(e.target.value)
                          : e.target.value,
                      )
                    }
                  />
                )}
                {error && (
                  <span
                    id={`${id}-error`}
                    role="alert"
                    className="text-xs text-red-600"
                  >
                    {t(error)}
                  </span>
                )}
                {field.type === "range" && (
                  <output htmlFor={id}>{String(value)}</output>
                )}
                {field.required && (
                  <span
                    id={`${id}-hint`}
                    className="text-xs text-muted-foreground"
                  >
                    {t("required")}
                  </span>
                )}
              </div>
            );
          })}
        </div>
        <Button type="submit" size="sm">
          {t("validate")}
        </Button>
        {formValidated && (
          <p role="status" className="text-sm">
            {t(hasValidUiInputs(definition, state) ? "validated" : "required")}
          </p>
        )}
      </form>
    );
  }
  if (definition.kind === "chart") {
    return (
      <ChartUi definition={definition} state={state} onChange={onChange} />
    );
  }
  if (definition.kind === "quiz")
    return <QuizUi definition={definition} state={state} onChange={onChange} />;
  if (definition.kind === "flashcards")
    return (
      <FlashcardsUi definition={definition} state={state} onChange={onChange} />
    );
  const values = record(state.values);
  const result = calculateUi(definition, state);
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        {definition.props.inputs.map((input) => (
          <label className="flex min-w-0 flex-col gap-1 text-sm" key={input.id}>
            {input.label}
            <input
              className={control}
              type="number"
              min={input.min}
              max={input.max}
              step={input.step ?? "any"}
              value={
                typeof values[input.id] === "number" ||
                typeof values[input.id] === "string"
                  ? (values[input.id] as number | string)
                  : input.value
              }
              onChange={(e) =>
                patch({
                  values: {
                    ...values,
                    [input.id]:
                      e.target.value === "" ? "" : Number(e.target.value),
                  },
                })
              }
            />
          </label>
        ))}
      </div>
      {result.error ? (
        <p role="alert" className="text-sm text-red-600">
          {t(`calculations.${result.error}`)}
        </p>
      ) : (
        <output
          aria-live="polite"
          className="block rounded-md bg-muted/40 p-3 text-lg font-medium tabular-nums"
        >
          {t("result")}:{" "}
          {result.values ? result.values.join(" + ") : result.value}
        </output>
      )}
    </div>
  );
}

function ChartUi({
  definition,
  state,
  onChange,
}: NativeUiProps & {
  definition: Extract<NativeDefinition, { kind: "chart" }>;
}) {
  const t = useTranslations("IntelligentUi");
  const {
    selected,
    state: chartState,
    rows,
    columns,
    filtered,
    source,
    mode,
    staticTables,
  } = deriveChart(definition, state);
  const filter = chartState.filter;
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        {t(`provenance.${definition.props.provenance}`)}
      </p>
      {mode.kind === "static-only" && (
        <div role="status" className="space-y-1 text-xs text-muted-foreground">
          <p>{t("static")}</p>
          <p>{t(`chartStaticReason.${mode.reason}`)}</p>
        </div>
      )}
      <label className="flex flex-col gap-1 text-sm">
        {t("metric")}
        <CustomSelect
          ariaLabel={t("metric")}
          value={selected.id}
          onChange={(chartId) => onChange({ ...state, chartId })}
          options={definition.props.charts.map((chart) => ({
            value: chart.id,
            label: chart.label,
          }))}
        />
      </label>
      {rows.length > 0 && mode.kind === "canonical" && (
        <label className="flex flex-col gap-1 text-sm">
          {t("filter")}
          <input
            className={control}
            value={filter}
            onChange={(e) => onChange({ ...state, filter: e.target.value })}
          />
        </label>
      )}
      {mode.kind === "canonical" && (
        <ChartBlock source={source} incomplete={false} />
      )}
      {mode.kind === "canonical" && rows.length > 0 && (
        <details>
          <summary className="cursor-pointer text-sm">{t("dataTable")}</summary>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr>
                  {columns.map((column) => (
                    <th className="p-2" key={column}>
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((row, index) => (
                  <tr key={index}>
                    {columns.map((column) => (
                      <td className="border-t border-border p-2" key={column}>
                        {String(row.cells[column] ?? "")}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
      {mode.kind === "static-only" && (
        <div className="space-y-3" aria-label={t("chartData") as string}>
          {staticTables.length === 0 && (
            <p role="status" className="text-sm">
              {t("chartNoData")}
            </p>
          )}
          {staticTables.map((table) => (
            <details key={table.id} open>
              <summary className="cursor-pointer text-sm">{table.id}</summary>
              {table.rows.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr>
                        {table.columns.map((column) => (
                          <th className="p-2" key={column}>
                            {column}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {table.rows.map((row, index) => (
                        <tr className="border-t border-border" key={index}>
                          {table.columns.map((column) => (
                            <td className="p-2" key={column}>
                              {row.cells[column] === null ||
                              row.cells[column] === undefined ||
                              row.cells[column] === ""
                                ? "—"
                                : String(row.cells[column])}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p role="status" className="text-sm">
                  {t("chartNoData")}
                </p>
              )}
            </details>
          ))}
        </div>
      )}
    </div>
  );
}
