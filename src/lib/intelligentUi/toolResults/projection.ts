import type { ToolCall } from "@/types";
import type { JsonObject } from "../types";
import { uiLabels } from "../localization";
import { deriveExplorer } from "../explorer/derive";
import { resolveToolResultView } from "./adapters";

export function toolResultCell(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/([\\|`*_[\]{}])/g, "\\$1")
    .replace(/[\r\n]+/g, " ");
}

/** Public initial output never reads current filters, selections or hidden fields. */
export async function renderToolResultSnapshot(
  call: ToolCall,
  options: {
    purpose: "static-original" | "static-current" | "compose-result";
    state?: JsonObject;
    locale?: string;
  },
): Promise<string | null> {
  const view = await resolveToolResultView(call);
  if (!view) return null;
  const labels = uiLabels(options.locale);
  const initial = options.purpose === "static-original";
  const result = deriveExplorer(
    {
      version: 1,
      kind: "explorer",
      title: call.name,
      summary: call.name,
      props: {
        dataset: { kind: "inline", data: view.dataset },
        provenance: "source",
        parameters: [],
        nodes: [],
      },
    },
    initial ? {} : (options.state ?? call.intelligentUiState ?? {}),
  );
  const columns = initial
    ? view.dataset.columns
    : result.columns.filter((column) =>
        result.state.visibleColumns.includes(column.id),
      );
  const rows = initial
    ? view.dataset.rows
    : result.rows.filter((row) => result.state.selected.includes(row.id));
  const caption = (id: string, label: string) =>
    view.descriptor.adapter !== "search-v1"
      ? label
      : id === "title"
        ? labels.toolResult.titleColumn
        : id === "snippet"
          ? labels.toolResult.summaryColumn
          : "URL";
  return [
    `### ${toolResultCell(call.name)}`,
    labels.provenance.source,
    `${labels.toolResult.capturedAt}: ${new Date(view.descriptor.retrievedAt).toISOString()}`,
    `${labels.toolResult.version}: ${view.descriptor.resultHash}`,
    ...(view.descriptor.partial ? [labels.toolResult.partial] : []),
    ...(columns.length && rows.length
      ? [
          [
            `| ${columns.map((column) => toolResultCell(caption(column.id, column.label))).join(" | ")} |`,
            `| ${columns.map(() => "---").join(" | ")} |`,
            ...rows.map(
              (row) =>
                `| ${columns.map((column) => toolResultCell(row.values[column.id])).join(" | ")} |`,
            ),
          ].join("\n"),
        ]
      : [labels.toolResult.noSelection]),
  ].join("\n\n");
}
