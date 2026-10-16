import type { MessageOutputBlock, ToolCall } from "@/types";
import {
  normalizeResearchQuery,
  RESEARCH_STRATEGY_LIMITS,
} from "./orchestration/strategy";
import type { ResearchImageSource } from "./types";
import { redactSensitiveToolArgs } from "@/lib/plugin/confirmation";
import { RESEARCH_TOOL_RESULT_LIMITS } from "./toolResultContent";

export interface SavedResearchCheckpoint {
  version: 1;
  taskId: string;
  savedAt: number;
  researchRunId?: string;
  agentRunId?: string;
  waveId?: string;
  streamCompleted?: boolean;
  /** Host net reservations, including requests without a terminal receipt. */
  executedQueries?: string[];
  prompt: string;
  partialContent: string;
  toolCalls: ToolCall[];
  outputBlocks: MessageOutputBlock[];
  imageSources?: ResearchImageSource[];
}

export function isCheckpointQueryLedger(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= RESEARCH_STRATEGY_LIMITS.maxQueries.max &&
    value.every(
      (query) =>
        typeof query === "string" &&
        query.trim().length > 0 &&
        query.length <= 4_000,
    ) &&
    new Set(value.map(normalizeResearchQuery)).size === value.length
  );
}

function compactCheckpointValue(
  value: unknown,
  maxChars: number = RESEARCH_TOOL_RESULT_LIMITS.inlineChars,
): unknown {
  try {
    return JSON.stringify(value).length <= maxChars
      ? value
      : { omitted: true, reason: "Value exceeded the checkpoint size limit." };
  } catch {
    return { omitted: true, reason: "Value could not be serialized safely." };
  }
}

function compactCheckpointResult(value: unknown): unknown {
  // New Research results are inline or reference envelopes already bounded by
  // the history writer. Preserve their exact value for tool_cache replay hashes.
  const compacted = compactCheckpointValue(
    value,
    RESEARCH_TOOL_RESULT_LIMITS.checkpointResultChars,
  );
  // Budget receipts survive even the legacy oversized-result fallback.
  if (
    compacted !== value &&
    value &&
    typeof value === "object" &&
    "refundedQueries" in value &&
    Array.isArray(value.refundedQueries)
  ) {
    return { ...(compacted as object), refundedQueries: value.refundedQueries };
  }
  return compacted;
}

// Search schemas bound decoded strings; JSON escaping can multiply their size.
// Preserve the exact replay arguments only for known, bounded search fields.
function boundedSearchArguments(name: string, value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const args = value as Record<string, unknown>;
  const string = (v: unknown, max: number) =>
    typeof v === "string" && v.length <= max;
  const strings = (v: unknown, count: number, max: number) =>
    Array.isArray(v) &&
    v.length <= count &&
    v.every((item) => string(item, max));
  if (name === "web_search") {
    return (
      string(args.query, 4_000) &&
      Object.entries(args).every(
        ([key, v]) =>
          key === "query" ||
          (key === "max_results" &&
            typeof v === "number" &&
            Number.isFinite(v)),
      )
    );
  }
  if (name !== "search_web" || !strings(args.queries, 4, 1_000)) return false;
  return Object.entries(args).every(([key, v]) => {
    if (key === "queries") return true;
    if (key === "domains") return strings(v, 8, 253);
    if (["date_from", "date_to"].includes(key)) return string(v, 10);
    if (["mode", "language", "time_range"].includes(key)) return string(v, 20);
    return (
      key === "max_results_per_query" &&
      typeof v === "number" &&
      Number.isFinite(v)
    );
  });
}

export function sanitizeCheckpointToolCall(toolCall: ToolCall): ToolCall {
  const { auth: _auth, resultImages: _resultImages, ...safe } = toolCall;
  void _auth;
  void _resultImages;
  const redactedArgs = redactSensitiveToolArgs(toolCall.args);
  const redactedResult = redactSensitiveToolArgs(toolCall.result);
  const boundedArgs = boundedSearchArguments(toolCall.name, redactedArgs)
    ? redactedArgs
    : compactCheckpointValue(redactedArgs);
  const boundedResult = compactCheckpointResult(redactedResult);
  return {
    ...safe,
    args: boundedArgs,
    ...(toolCall.result !== undefined ? { result: boundedResult } : {}),
  };
}

export function isCommittedCheckpointToolCall(toolCall: ToolCall): boolean {
  if (toolCall.status === "success" && toolCall.isError !== true) return true;
  // Finished research searches also retain host budget receipts. Failed writes
  // and unfinished calls remain excluded from recoverable history.
  return (
    toolCall.status === "error" &&
    ["web_search", "search_web"].includes(toolCall.name) &&
    Boolean(
      toolCall.result &&
      typeof toolCall.result === "object" &&
      "refundedQueries" in toolCall.result &&
      Array.isArray(toolCall.result.refundedQueries),
    )
  );
}

export function redactCheckpointText(value: string): string {
  return value
    .replace(/(bearer\s+)[^\s,;]+/gi, "$1[REDACTED]")
    .replace(
      /((?:api[_-]?key|access[_-]?token|password|secret)["']?\s*[:=]\s*["']?)[^"',\s;}]+/gi,
      "$1[REDACTED]",
    )
    .slice(0, 200_000);
}
