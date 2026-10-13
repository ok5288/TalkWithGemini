import type { IntelligentUiBlock, JsonObject } from "./types";
import type { ExplorerDataset, ExplorerMetricExplanation } from "./explorer";
import { deriveExplorer, deriveExplorerDisplay } from "./explorer";
import { calculateUi } from "./calculations";
import {
  getNativeInitialState,
  normalizeNativeState,
  deriveComparison,
  deriveChart,
  deriveQuiz,
  deriveFlashcards,
} from "./catalog";
import { initialExplorer } from "./explorer";
import { uiLabels } from "./localization";

type PresentationBlock = IntelligentUiBlock & {
  /** Explicitly confirmed local data; never inferred from model state. */
  dataSnapshot?: ExplorerDataset;
};

function escape(value: unknown): string {
  return String(value ?? "")
    .replace(/[\\`*_{}\[\]<>()#!|]/g, "\\$&")
    .replace(/\r?\n/g, " ");
}

function escapeCell(value: unknown): string {
  return value === null || value === undefined || value === ""
    ? "—"
    : escape(value);
}

/** Existing host references are rendered as inert text, never upgraded to links. */
export function renderUiSourceRefs(
  sourceRefs: readonly string[],
  locale = "en",
): string {
  if (!sourceRefs.length) return "";
  return `${uiLabels(locale).sources}: ${sourceRefs.map(escape).join(", ")}`;
}

/** Rendering only: native capability modules own all state and result semantics. */
export function renderUiMarkdown(
  block: IntelligentUiBlock,
  includeState: boolean,
  locale = "en",
  resolvedDataset?: ExplorerDataset,
): string {
  const labels = uiLabels(locale);
  const presentationBlock = block as PresentationBlock;
  const definition = presentationBlock.definition;
  if (!definition) {
    const fallback =
      !block.fallbackMarkdown ||
      block.fallbackMarkdown === "Interactive content unavailable."
        ? labels.unavailable
        : block.fallbackMarkdown;
    return [escape(fallback), renderUiSourceRefs(block.sourceRefs, locale)]
      .filter(Boolean)
      .join("\n\n");
  }
  const lines = [`**${escape(definition.title)}**`, escape(definition.summary)];
  if (!("kind" in definition)) {
    if (includeState) {
      lines.push(escape(labels.htmlSnapshotLabel));
      lines.push(escape(block.staticSnapshot || labels.htmlSnapshotMissing));
    }
  } else {
    const dataset =
      definition.kind === "explorer"
        ? includeState
          ? (presentationBlock.dataSnapshot ?? resolvedDataset)
          : resolvedDataset
        : undefined;
    const state = includeState
      ? definition.kind === "explorer"
        ? block.state
        : normalizeNativeState(definition, block.state)
      : definition.kind === "explorer"
        ? initialExplorer(definition, dataset)
        : getNativeInitialState(definition);
    switch (definition.kind) {
      case "checklist": {
        const checked = Array.isArray(state.checked) ? state.checked : [];
        lines.push(
          ...definition.props.items.map(
            (item) =>
              `- [${checked.includes(item.id) ? "x" : " "}] ${escape(item.label)}`,
          ),
        );
        break;
      }
      case "comparison": {
        lines.push(labels.provenance[definition.props.provenance]);
        const result = deriveComparison(definition, state);
        lines.push(
          ...result.items.map(
            (item) =>
              `- ${escape(item.label)}: ${definition.props.columns.map((column) => `${escape(column.label)}: ${escape(item.values[column.key])}`).join("; ")}`,
          ),
        );
        if (includeState && result.state.selected.length)
          lines.push(
            `${labels.selected}: ${definition.props.items
              .filter((item) => result.state.selected.includes(item.id))
              .map((item) => escape(item.label))
              .join(", ")}`,
          );
        break;
      }
      case "form": {
        const values = state.values as JsonObject;
        lines.push(
          ...definition.props.fields.map((field) => {
            const value = values[field.id];
            let display: unknown = value;
            if (field.options) {
              display = field.options
                .filter((option) =>
                  Array.isArray(value)
                    ? value.includes(option.value)
                    : value === option.value,
                )
                .map((option) => option.label)
                .join(", ");
            } else if (typeof value === "boolean") {
              display = value ? labels.yes : labels.no;
            }
            return `- ${escape(field.label)}${includeState ? `: ${escape(display)}` : ""}`;
          }),
        );
        break;
      }
      case "chart": {
        lines.push(labels.provenance[definition.props.provenance]);
        const charts = includeState
          ? [deriveChart(definition, state)]
          : definition.props.charts.map((chart) =>
              deriveChart(definition, { ...state, chartId: chart.id }),
            );
        for (const chart of charts) {
          lines.push(`**${escape(chart.selected.label)}**`);
          const staticOnly = chart.mode.kind === "static-only";
          if (chart.mode.kind === "static-only")
            lines.push(
              labels.static,
              labels.chartStaticReason[chart.mode.reason],
            );
          const tables = staticOnly
            ? chart.staticTables
            : [{ id: "data", columns: chart.columns, rows: chart.filtered }];
          if (staticOnly && !tables.length) lines.push(labels.chartNoData);
          for (const table of tables) {
            if (staticOnly) lines.push(`**${escape(table.id)}**`);
            if (table.columns.length)
              lines.push(
                `| ${table.columns.map(escape).join(" | ")} |`,
                `| ${table.columns.map(() => "---").join(" | ")} |`,
                ...table.rows.map(
                  (row) =>
                    `| ${table.columns.map((column) => escapeCell(row.cells[column])).join(" | ")} |`,
                ),
              );
          }
        }
        break;
      }
      case "quiz": {
        const result = deriveQuiz(definition, state);
        for (const question of definition.props.questions) {
          const answers = includeState
            ? (result.state.answers[question.id] ??
              result.state.latestAnswers[question.id] ??
              [])
            : [];
          lines.push(
            `- ${escape(question.prompt)}${
              answers.length
                ? `: ${question.options
                    .filter((option) => answers.includes(option.id))
                    .map((option) => escape(option.label))
                    .join(", ")}`
                : ""
            }`,
          );
          if (
            includeState &&
            result.state.submitted &&
            result.state.questionIds.includes(question.id)
          )
            lines.push(escape(question.explanation));
        }
        if (includeState && Object.keys(result.state.latestAnswers).length)
          lines.push(
            labels.latestScore
              .replace("{count}", String(result.latestScore))
              .replace("{total}", String(definition.props.questions.length)),
          );
        if (includeState && result.state.submitted)
          lines.push(
            `${labels.roundScore}: ${result.score} / ${result.questions.length}`,
          );
        break;
      }
      case "calculator": {
        const result = calculateUi(definition, state);
        lines.push(
          ...definition.props.inputs.map(
            (input) =>
              `- ${escape(input.label)}: ${escape((state.values as JsonObject)[input.id])}`,
          ),
        );
        lines.push(
          result.error
            ? ((labels.calculations as Record<string, string>)[result.error] ??
                labels.calculations.resultFinite)
            : `${labels.result}: ${escape(result.values?.join(", ") ?? result.value)}`,
        );
        break;
      }
      case "flashcards": {
        const result = deriveFlashcards(definition, state);
        for (const card of definition.props.cards) {
          const rating = result.state.ratings[card.id];
          lines.push(
            `- ${escape(card.front)} — ${escape(card.back)}${includeState && rating ? ` (${rating === "known" ? labels.known : labels.again})` : ""}`,
          );
        }
        if (includeState)
          lines.push(
            `${labels.mastered}: ${result.knownCount} / ${definition.props.cards.length}`,
          );
        break;
      }
      case "explorer": {
        const result = requireExplorerResult(definition, state, dataset);
        const provenance =
          includeState && presentationBlock.dataSnapshot
            ? "user"
            : definition.props.provenance;
        lines.push(labels.provenance[provenance]);
        if (result.datasetVersion)
          lines.push(
            `${labels.explorer.datasetVersion}: ${escape(result.datasetVersion)}`,
          );
        if (result.errors.length) {
          for (const error of Array.from(
            new Set(result.errors.map((item) => item.code)),
          ))
            lines.push(localizedExplorerError(labels, error));
        }
        if (definition.version === 2) {
          const display = deriveExplorerDisplay(definition, result, {
            selectedOnly: includeState,
            visibleOnly: includeState,
          });
          const renderRows = (
            rows: typeof result.rows,
            columnIds: string[],
          ) => {
            const columns = result.columns.filter((column) =>
              columnIds.includes(column.id),
            );
            if (!rows.length || !columns.length) return;
            lines.push(
              `| ${columns.map((column) => escape(column.label)).join(" | ")} |`,
              `| ${columns.map(() => "---").join(" | ")} |`,
              ...rows.map(
                (row) =>
                  `| ${columns.map((column) => escapeCell(row.values[column.id])).join(" | ")} |`,
              ),
            );
          };
          for (const section of display.sections) {
            if (section.kind === "parameters") {
              lines.push(
                ...definition.props.parameters.map(
                  (parameter) =>
                    `${escape(parameter.label)}: ${escape(result.state.parameters[parameter.id])}`,
                ),
              );
            } else if (section.kind === "table") {
              const rows = includeState ? result.selectedRows : result.rows;
              if (includeState && !rows.length)
                lines.push(labels.explorer.noSelection);
              renderRows(rows, result.state.visibleColumns);
            } else if (section.kind === "metrics") {
              for (const node of display.metrics) {
                lines.push(
                  `${escape(node.label)}: ${escapeCell(result.metrics[node.id])}`,
                );
                const explanation = result.metricExplanations[node.id];
                if (explanation)
                  lines.push(
                    escape(
                      formatExplorerMetricExplanation(explanation, locale),
                    ),
                  );
              }
            } else if (section.kind === "chart") {
              const chart = display.charts.find(
                (item) => item.id === section.id,
              )!;
              if (chart.allowed) {
                lines.push(
                  `**${escape(chart.title)}**`,
                  `${escape(chart.xLabel)} · ${escape(chart.yLabel)}`,
                );
                renderRows(chart.rows, [chart.x, chart.y]);
              }
            } else {
              for (const notice of display.notices)
                lines.push(
                  `${escape(notice.label)}: ${escape(formatExplorerMetricExplanation(notice.explanation, locale))}`,
                );
            }
          }
          break;
        }
        if (includeState && definition.props.parameters.length) {
          lines.push(
            ...definition.props.parameters.map(
              (parameter) =>
                `${escape(parameter.label)}: ${escape(result.state.parameters[parameter.id])}`,
            ),
          );
        }
        const rows = includeState ? result.selectedRows : result.rows;
        if (includeState && !rows.length) {
          lines.push(labels.explorer.noSelection);
        } else if (rows.length) {
          const columns = result.columns.filter((column) =>
            result.state.visibleColumns.includes(column.id),
          );
          lines.push(
            `| ${columns.map((column) => escape(column.label)).join(" | ")} |`,
            `| ${columns.map(() => "---").join(" | ")} |`,
            ...rows.map(
              (row) =>
                `| ${columns.map((column) => escapeCell(row.values[column.id])).join(" | ")} |`,
            ),
          );
        }
        for (const node of definition.props.nodes.filter(
          (item) =>
            item.stage !== "row" &&
            (!definition.props.metrics?.length ||
              definition.props.metrics.includes(item.id)) &&
            Object.hasOwn(result.metrics, item.id),
        )) {
          const metric = result.metrics[node.id];
          lines.push(`${escape(node.label)}: ${escapeCell(metric)}`);
          const explanation = result.metricExplanations[node.id];
          if (explanation) {
            lines.push(
              escape(formatExplorerMetricExplanation(explanation, locale)),
            );
          }
        }
        break;
      }
    }
  }
  const references = renderUiSourceRefs(block.sourceRefs, locale);
  if (references) lines.push(references);
  return lines.join("\n\n");
}

/** Shared plain-text explanation for the live view and public projection. */
export function formatExplorerMetricExplanation(
  explanation: ExplorerMetricExplanation,
  locale = "en",
): string {
  const labels = uiLabels(locale).explorer.metricExplanation;
  const parts = [
    labels.formula.replace("{formula}", () => explanation.formula),
  ];
  if (explanation.collection) {
    parts.push(labels.collection[explanation.collection]);
    if (explanation.included !== undefined && explanation.missing !== undefined)
      parts.push(
        labels.participation
          .replace("{included}", String(explanation.included))
          .replace("{missing}", String(explanation.missing)),
      );
  }
  parts.push(
    explanation.collection ? labels.skipMissing : labels.propagateMissing,
  );
  if (explanation.status !== "value")
    parts.push(labels.status[explanation.status]);
  if (explanation.rounding) {
    parts.push(
      (explanation.rounding.currency === false
        ? labels.splitRounding
        : labels.rounding
      ).replace("{precision}", String(explanation.rounding.precision)),
    );
    if (explanation.rounding.split) parts.push(labels.splitRemainder);
  }
  return parts.join("; ");
}

function requireExplorerResult(
  definition: Extract<
    NonNullable<IntelligentUiBlock["definition"]>,
    { kind: "explorer" }
  >,
  state: JsonObject,
  dataset?: ExplorerDataset,
) {
  // Kept in a small adapter so the presentation module shares exactly the
  // same row, filter, metric, and error semantics as the live renderer.
  return deriveExplorer(definition, state, dataset);
}

function localizedExplorerError(
  labels: ReturnType<typeof uiLabels>,
  code: string,
): string {
  return (
    labels.explorer.errors[code as keyof typeof labels.explorer.errors] ??
    labels.explorer.errors.invalid
  );
}
