import { describe, expect, it } from "vitest";

import {
  createAgentRun,
  failToolExecution,
  markToolExecutionRunning,
  prepareToolExecution,
} from "@/lib/agent";
import { normalizeToolResultEnvelope } from "@/lib/agent/toolResult";
import { createResearchTask } from "@/lib/research";
import { SearchRequestError, describeSearchFailure } from "@/lib/search/errors";
import { createResearchTaskViewModel } from "@/components/research/viewModel";
import {
  consumeResearchQueries,
  queryBudgetError,
} from "@/services/api/chat/builtinTools/researchQueryBudget";

async function activityFor(error: unknown, toolName = "web_search") {
  const envelope = normalizeToolResultEnvelope(
    { ok: false, error },
    {
      trust: "external_untrusted",
      provenance: { origin: "builtin", toolName },
    },
  );
  if (envelope.ok) throw new Error("Expected a tool failure");
  let run = createAgentRun({ id: "run", sessionId: "session", now: 100 });
  run = prepareToolExecution(run, {
    id: "execution",
    callId: "call",
    toolName,
    definitionFingerprint: "fingerprint",
    argumentsHash: "hash",
    targetSummary: "SECRET query",
    policy: {
      effects: ["network_read"],
      idempotency: "idempotent",
      sensitivity: "none",
      origin: "builtin",
    },
    at: 101,
  });
  run = markToolExecutionRunning(run, "execution", 102);
  run = failToolExecution(run, "execution", envelope.error, 103);
  const task = {
    ...createResearchTask({
      id: "task",
      sessionId: "session",
      goal: "Research",
      now: 100,
    }),
    executionRunIds: [run.id],
  };
  const view = await createResearchTaskViewModel(task, { [run.id]: run });
  return view.activities.find((item) => item.id === "execution")!;
}

describe("research search activity diagnostics", () => {
  it.each(["web_search", "search_web"])(
    "shows a safe rate-limit explanation for %s",
    async (tool) => {
      const activity = await activityFor(
        describeSearchFailure(
          new SearchRequestError(
            "SECRET provider payload",
            429,
            "SEARCH_RATE_LIMITED",
            "provider",
            60_000,
          ),
        ),
        tool,
      );
      expect(activity.status).toBe("failed");
      expect(activity.detail).toContain("rate limit");
      expect(JSON.stringify(activity)).not.toContain("SECRET");
    },
  );

  it.each([
    ["RESEARCH_SEARCH_TIMEOUT", "search request timed out"],
    ["RESEARCH_RECON_TIMEOUT", "research search deadline"],
    ["RESEARCH_QUERY_BUDGET_EXHAUSTED", "query budget"],
    ["RESEARCH_QUERY_NOT_ALLOWED", "approved search scope"],
    ["SEARCH_UPSTREAM_ERROR", "search provider"],
  ])("explains %s without exposing raw messages", async (code, detail) => {
    const activity = await activityFor({
      code,
      message: "SECRET raw result",
      recoverable: true,
    });
    expect(activity.status).toBe("failed");
    expect(activity.detail).toContain(detail);
    expect(JSON.stringify(activity)).not.toContain("SECRET");
  });

  it("projects a duplicate query as skipped without changing its budget", async () => {
    const budget = {
      remainingQueries: 2,
      maxResultsPerQuery: 5,
      seenQueries: new Set(["same question"]),
    };
    const result = consumeResearchQueries(budget, ["same question"]);
    expect(result).toBe("duplicate");
    expect(budget.remainingQueries).toBe(2);
    const activity = await activityFor(queryBudgetError("duplicate").error);
    expect(activity).toMatchObject({
      status: "info",
      title: "web_search: duplicate query skipped",
    });
    expect(activity.detail).toContain("No additional search request");
  });

  it("uses a safe fallback for unknown and legacy search errors", async () => {
    for (const error of [
      { code: "SECRET unknown", message: "SECRET raw payload" },
      "SECRET legacy error",
    ]) {
      const activity = await activityFor(error);
      expect(activity.status).toBe("failed");
      expect(activity.detail).toContain("Search could not complete");
      expect(JSON.stringify(activity)).not.toContain("SECRET");
    }
  });

  it("does not misclassify other tools with a search-like error code", async () => {
    const activity = await activityFor(
      queryBudgetError("duplicate").error,
      "fetch_url",
    );
    expect(activity).toMatchObject({
      status: "failed",
      title: "fetch_url did not complete",
    });
  });
});
