import type { deriveExplorer } from "./derive";
import type { ExplorerDefinition, ExplorerSection } from "./types";

export type ExplorerResult = ReturnType<typeof deriveExplorer>;
/** One derived graph, with chart-specific point maps and shared notices. */
export function deriveExplorerDisplay(
  definition: ExplorerDefinition,
  result: ExplorerResult,
  options: { selectedOnly?: boolean; visibleOnly?: boolean } = {},
) {
  const sections: ExplorerSection[] =
    definition.version === 2
      ? definition.props.sections
      : [
          { kind: "parameters" },
          { kind: "table" },
          {
            kind: "metrics",
            nodes: definition.props.metrics?.length
              ? definition.props.metrics
              : definition.props.nodes
                  .filter((n) => n.stage !== "row")
                  .map((n) => n.id),
          },
          ...(definition.props.chart
            ? [
                {
                  kind: "chart" as const,
                  id: "chart",
                  title: "",
                  ...definition.props.chart,
                },
              ]
            : []),
        ];
  const rows = options.selectedOnly ? result.selectedRows : result.rows;
  const charts = sections
    .filter((s) => s.kind === "chart")
    .map((chart) => {
      const allowed =
        !options.visibleOnly ||
        [chart.x, chart.y].every((key) =>
          result.state.visibleColumns.includes(key),
        );
      const chartRows = !allowed
        ? []
        : definition.version === 1
          ? rows
          : rows.filter(
              (row) =>
                typeof row.values[chart.y] === "number" &&
                (chart.type === "scatter"
                  ? typeof row.values[chart.x] === "number"
                  : row.values[chart.x] !== null &&
                    row.values[chart.x] !== undefined),
            );
      return {
        ...chart,
        rows: chartRows,
        allowed,
        xLabel: result.columns.find((c) => c.id === chart.x)?.label ?? chart.x,
        yLabel: result.columns.find((c) => c.id === chart.y)?.label ?? chart.y,
      };
    });
  const metricIds = sections.flatMap((s) =>
    s.kind === "metrics" ? s.nodes : [],
  );
  const requestedNodes =
    definition.version === 1
      ? definition.props.nodes.filter((n) => metricIds.includes(n.id))
      : metricIds.flatMap((id) =>
          definition.props.nodes.filter((n) => n.id === id),
        );
  const metrics = requestedNodes.filter((n) =>
    Object.hasOwn(result.metrics, n.id),
  );
  const notices = Object.entries(result.metricExplanations)
    .filter(([, explanation]) => explanation.status !== "value")
    .map(([id, explanation]) => ({
      id,
      label: definition.props.nodes.find((n) => n.id === id)?.label ?? id,
      explanation,
    }));
  return { sections, charts, metrics, notices };
}
