import type { ResearchTask } from "@/lib/research";

export interface ResearchViewModelText {
  artifactUnavailable: string;
  fallbackReportTitle: (version: number) => string;
  taskCreatedTitle: string;
  taskCreatedDetail: string;
  planPreparedTitle: (version: number) => string;
  planAdjustedDetail: string;
  planApprovalDetail: string;
  reportPublishedTitle: (version: number) => string;
  toolRunningTitle: (tool: string) => string;
  toolCommittedTitle: (tool: string) => string;
  toolFailedTitle: (tool: string) => string;
  toolSkippedTitle: (tool: string) => string;
  duplicateSkippedDetail: string;
  toolEffectUnknownTitle: (tool: string) => string;
  toolInterruptedTitle: (tool: string) => string;
  toolSourceDetail: (source: string) => string;
  internalToolResultSource: string;
  toolSafeDetail: string;
  storageErrorDetails: Readonly<Record<string, string>>;
  searchFailedDetail: string;
  searchErrorDetails: Readonly<Record<string, string>>;
  degradedWaveTitle: (wave: number) => string;
  degradedWaveDetail: (count: number) => string;
  scopeExpansionTitle: string;
  scopeExpansionDetail: (scheduled: number) => string;
  scopeExpansionLimitedDetail: (count: number) => string;
  reportKind: Record<"initial" | "continue" | "update", string>;
  statusTitle: (status: ResearchTask["status"]) => string;
}

export const DEFAULT_TEXT: ResearchViewModelText = {
  artifactUnavailable: "The local report artifact is unavailable.",
  fallbackReportTitle: (version) => `Research report v${version}`,
  taskCreatedTitle: "Research task created",
  taskCreatedDetail:
    "Before approval, only bounded public search summaries may be used for planning reconnaissance; source bodies cannot become report evidence.",
  planPreparedTitle: (version) => `Plan v${version} prepared`,
  planAdjustedDetail: "Prepared from a natural-language adjustment.",
  planApprovalDetail: "Prepared for explicit approval.",
  reportPublishedTitle: (version) => `Report v${version} published`,
  toolRunningTitle: (tool) => `Using ${tool}`,
  toolCommittedTitle: (tool) => `Completed ${tool}`,
  toolFailedTitle: (tool) => `${tool} did not complete`,
  toolSkippedTitle: (tool) => `${tool}: duplicate query skipped`,
  duplicateSkippedDetail:
    "This query was already submitted. No additional search request was sent.",
  toolEffectUnknownTitle: (tool) => `${tool} result could not be confirmed`,
  toolInterruptedTitle: (tool) => `${tool} was interrupted`,
  toolSourceDetail: (source) => `Read-only source: ${source}`,
  internalToolResultSource: "Internal tool result",
  toolSafeDetail: "Read-only operation; raw arguments and results are hidden.",
  storageErrorDetails: {
    RESEARCH_STORAGE_checkpoint:
      "The research checkpoint could not be saved. Research has stopped; retry after storage is available.",
    RESEARCH_STORAGE_indexeddb_unavailable:
      "Browser storage is unavailable. Research cannot continue until storage access is restored.",
    RESEARCH_STORAGE_indexeddb_operation_failed:
      "Research progress could not be saved. Retry to reconnect to browser storage.",
    RESEARCH_STORAGE_quota: "Browser storage is full. Free space and retry.",
    RESEARCH_STORAGE_blocked:
      "Browser storage is blocked by another page. Close older tabs and retry.",
    RESEARCH_STORAGE_validation:
      "Research progress could not be validated for saving. The task has been stopped.",
    RESEARCH_STORAGE_conflict:
      "Another tab changed this research task. Local progress has been retained; reload the task before continuing.",
    RESEARCH_STORAGE_report_verification:
      "The saved report could not be verified. Research has not been marked complete.",
  },
  searchFailedDetail:
    "Search could not complete. Please check the search service and try again.",
  searchErrorDetails: {
    SEARCH_RATE_LIMITED:
      "The search service rate limit was reached. Wait before retrying.",
    RESEARCH_SEARCH_TIMEOUT:
      "The search request timed out. Please try again later.",
    RESPONSE_TIMEOUT: "The search request timed out. Please try again later.",
    RESEARCH_RECON_TIMEOUT:
      "The research search deadline was reached, including time spent waiting in the queue.",
    RESEARCH_QUERY_BUDGET_EXHAUSTED:
      "The approved query budget is exhausted. No additional search request was sent.",
    RESEARCH_QUERY_NOT_ALLOWED:
      "This query is outside the approved search scope. No search request was sent.",
    RESEARCH_SEARCH_SCOPE_CONFLICT:
      "The search filters conflict with the approved search scope. No search request was sent.",
    SEARCH_UPSTREAM_ERROR:
      "The search provider could not complete the request. Please try again later.",
    WEB_SEARCH_INVALID_QUERY:
      "The search query is invalid. No search request was sent.",
  },
  degradedWaveTitle: (wave) => `Round ${wave} archived with evidence gaps`,
  degradedWaveDetail: (count) =>
    `${count} research nodes produced no valid learning packet. Preserved evidence remains available and the report will continue with explicit gaps.`,
  scopeExpansionTitle: "Research scope expanded automatically",
  scopeExpansionDetail: (scheduled) =>
    `${scheduled} additional research directions will continue from committed evidence in this run.`,
  scopeExpansionLimitedDetail: (count) =>
    `${count} directions require sources that are unavailable in this conversation and will remain explicit report gaps.`,
  reportKind: {
    initial: "Initial report",
    continue: "Continued research",
    update: "Latest-source update",
  },
  statusTitle: (status) => `Research status: ${status}`,
};
