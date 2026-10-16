import type { ResearchReportVersion } from "./types";

export const RESEARCH_REPORT_CONTEXT_MAX_CHARS = 24_000;

/** A bounded report projection for ordinary follow-up chat, preserving citations. */
export function projectResearchReportContext(
  markdown: string,
  report: Pick<
    ResearchReportVersion,
    "version" | "summary" | "keyFindings" | "gaps"
  >,
): string {
  const body = markdown.trim();
  if (body && body.length <= RESEARCH_REPORT_CONTEXT_MAX_CHARS) return body;
  // Allocate each part separately so unusually long findings cannot erase gaps.
  return [
    `Research report version ${report.version}. The full report is unavailable or exceeds the context limit. Use this summary and only cite URLs explicitly included here; do not invent source links.`,
    `## Summary\n${report.summary.slice(0, 7_000)}`,
    `## Key findings\n${report.keyFindings.join("\n").slice(0, 12_000)}`,
    `## Evidence gaps\n${report.gaps.join("\n").slice(0, 4_000)}`,
  ].join("\n\n");
}
