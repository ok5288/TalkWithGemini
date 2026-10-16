import { describe, expect, it } from "vitest";
import type { ToolCall } from "@/types";
import { getResearchQueriesFromToolCalls } from "@/lib/research/toolCallInsights";
import {
  isCommittedCheckpointToolCall,
  sanitizeCheckpointToolCall,
} from "@/lib/research/checkpointCodec";
import { normalizeToolCall } from "@/store/storage/migrations";

function call(
  id: string,
  queries: string[],
  refundedQueries: string[],
  failed = false,
): ToolCall {
  return {
    id,
    name: queries.length === 1 ? "web_search" : "search_web",
    args: queries.length === 1 ? { query: queries[0] } : { queries },
    status: failed ? "error" : "success",
    isError: failed,
    result: {
      ok: !failed,
      trust: "external_untrusted",
      provenance: { origin: "builtin", toolName: "web_search" },
      ...(failed
        ? {
            error: {
              code: "SEARCH_HTTP_ERROR",
              message: "HTTP failure",
              recoverable: true,
            },
          }
        : { data: { sources: [] } }),
      refundedQueries,
    },
  };
}
function roundTrip(calls: ToolCall[]) {
  // Production checkpoint save/read both filter and sanitize, then persisted
  // message restoration retains the same result JSON without re-normalizing it.
  return JSON.parse(
    JSON.stringify(
      calls
        .filter(isCommittedCheckpointToolCall)
        .map(sanitizeCheckpointToolCall),
    ),
  )
    .filter(isCommittedCheckpointToolCall)
    .map(sanitizeCheckpointToolCall)
    .map(normalizeToolCall);
}

describe("search refund checkpoint receipts", () => {
  it("retains a single 429 refund, while keeping a 400 charge and empty success", () => {
    const restored = roundTrip([
      call("429", ["solar physics"], ["solar physics"], true),
      call("400", ["ocean currents"], [], true),
      call("empty", ["forest ecology"], []),
    ]);
    expect(restored).toHaveLength(3);
    expect(getResearchQueriesFromToolCalls(restored)).toEqual([
      "ocean currents",
      "forest ecology",
    ]);
  });
  it("refunds each partial batch before deduplication so a later success still counts", () => {
    const restored = roundTrip([
      call("batch", ["solar physics", "ocean currents"], ["ocean currents"]),
      call("retry", ["ocean currents"], []),
    ]);
    expect(getResearchQueriesFromToolCalls(restored)).toEqual([
      "solar physics",
      "ocean currents",
    ]);
  });
  it("preserves receipts when oversized checkpoint bodies are omitted", () => {
    const value = call(
      "batch",
      ["solar physics", "ocean currents"],
      ["ocean currents"],
    );
    Object.assign(value.result as object, { oversized: "x".repeat(60_000) });
    expect(getResearchQueriesFromToolCalls(roundTrip([value]))).toEqual([
      "solar physics",
    ]);
  });
  it("does not retain failed writes or unreceipted search failures", () => {
    const write = {
      ...call("write", ["solar physics"], [], true),
      name: "write_workspace_file",
    };
    const unknown = call("unknown", ["solar physics"], [], true);
    delete (unknown.result as Record<string, unknown>).refundedQueries;
    expect(roundTrip([write, unknown])).toEqual([]);
  });
});

it("preserves schema-valid escaped search arguments and charges after roundtrip", () => {
  const query = "\\".repeat(4_000);
  const single = call("escaped", [query], []);
  const batch = call(
    "escaped-batch",
    Array.from({ length: 4 }, (_, i) => String(i) + "\\".repeat(999)),
    [],
  );
  for (const original of [single, batch]) {
    const restored = roundTrip([original]);
    expect(restored[0].args).toEqual(original.args);
    expect(getResearchQueriesFromToolCalls(restored)).toEqual(
      getResearchQueriesFromToolCalls([original]),
    );
  }
});

it("keeps unknown or oversized search arguments bounded", () => {
  for (const value of [
    {
      ...call("unknown", ["query"], []),
      args: { query: "query", extra: "x".repeat(10_000) },
    },
    {
      ...call("oversized", ["query"], []),
      args: { query: "x".repeat(10_000) },
    },
    {
      ...call("unknown-tool", ["query"], []),
      name: "other",
      args: { query: "x".repeat(10_000) },
    },
  ])
    expect(sanitizeCheckpointToolCall(value).args).toMatchObject({
      omitted: true,
    });
});
