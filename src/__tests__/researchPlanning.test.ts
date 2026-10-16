import { ResearchPersistenceError } from "@/services/research/taskRepository/errors";
import { AgentRunLeaseConflictError } from "@/services/agent/runLease";
import { isStarterResearchPlan } from "@/lib/research/prompts/starterPlan";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createResearchTask,
  buildResearchReconSnapshot,
  resolveResearchStrategy,
  type ResearchTask,
  type ResearchSourceSnapshot,
} from "@/lib/research";
import type { ResearchPlanDraftV2 } from "@/lib/research/prompts/types";
import type { streamChatResponse } from "@/services/api/chatService";
import type { ResearchTranslate } from "@/lib/research/runtime/executionContext";
import { createKnowledgeCollectionAttachment } from "@/lib/utils/knowledgeAttachments";

const mocks = vi.hoisted(() => ({
  stream: vi.fn<typeof streamChatResponse>(),
  task: null as ResearchTask | null,
  snapshot: {} as ResearchSourceSnapshot,
  snapshotError: null as Error | null,
  saveError: null as Error | null,
  saves: vi.fn(),
  sourceContext: vi.fn(),
}));
vi.mock("@/services/api/chatService", () => ({
  streamChatResponse: mocks.stream,
}));
vi.mock("@/store/core/researchStore", () => ({
  useResearchStore: {
    setState: (
      update: (state: { tasksById: Record<string, ResearchTask> }) => {
        tasksById?: Record<string, ResearchTask>;
      },
    ) => {
      const next = update({ tasksById: { task: mocks.task! } });
      if (next.tasksById) mocks.task = next.tasksById.task;
    },
    getState: () => ({
      tasksById: { task: mocks.task },
      updateTask: async (
        _id: string,
        update: (task: ResearchTask) => ResearchTask,
        options?: { persistence: string },
      ) => {
        mocks.task = update(mocks.task!);
        mocks.saves(mocks.task, options);
        if (mocks.saveError && options?.persistence !== "best-effort")
          throw mocks.saveError;
        return mocks.task;
      },
    }),
  },
}));
vi.mock("@/services/research", () => ({
  getResearchTaskRepository: () => ({ getStatus: () => ({ durable: true }) }),
}));
vi.mock("@/services/research/templates", () => ({
  freezeResearchTaskTemplate: async () => ({ template: null }),
}));
vi.mock("@/lib/research/runtime/taskContext", () => ({
  resolveTaskContext: () => ({
    model: "provider:selected-model",
    chatConfig: {},
    effective: {
      systemInstruction: "User instruction",
      approvalMode: "auto",
      searchCompatibility: { enabled: true, mode: "external" },
    },
    settings: { search: { provider: "firecrawl" }, rag: { enabled: false } },
  }),
}));
vi.mock("@/lib/research/runtime/sourceSnapshot", () => ({
  createSourceSnapshot: async () => {
    if (mocks.snapshotError) throw mocks.snapshotError;
    return mocks.snapshot;
  },
  loadSessionMessages: async () => [],
  buildResearchExecutionSourceContext: mocks.sourceContext,
}));

import { prepareResearchPlan } from "@/lib/research/runtime/preparePlan";
import { parseResearchPlan } from "@/lib/research/prompts/parsePlan";
import { parseResearchPlanningResponse } from "@/lib/research/prompts/planningResponse";
import { reconSchema } from "@/services/research/taskRepository/schema/primitives";
import { ResearchModelUnavailableError } from "@/lib/research/runtime/dependencyErrors";

const plan: ResearchPlanDraftV2 = {
  title: "Study the topic",
  summary: "A bounded research plan",
  objective: "Understand the topic",
  scope: {
    audience: "Readers",
    includes: ["Concepts"],
    excludes: [],
    allowedSourceTypes: ["web", "knowledge"],
  },
  assumptions: [],
  deliverable: {
    kind: "research_report",
    description: "An analysis",
    requiredSections: ["Findings"],
  },
  strategy: resolveResearchStrategy("standard"),
  steps: [1, 2, 3].map((id) => ({
    id: `step-${id}`,
    title: `Step ${id}`,
    objective: `Investigate question ${id}`,
    questions: [`Question ${id}`],
    queryTopics: [`Topic ${id}`],
    sourcePriorities: [{ sourceType: "web", priority: "high" }],
    evidenceCriteria: ["A relevant source"],
    priority: "high",
  })),
  completionCriteria: ["Explain the topic"],
};
const planOutput = JSON.stringify({ kind: "plan", plan });
const request = {
  kind: "needs_context",
  reason: "The named concept is unfamiliar",
  queries: ["user-named concept"],
};
const requestOutput = JSON.stringify(request);
const execute = (controller = new AbortController()) =>
  prepareResearchPlan({
    taskId: "task",
    controller,
    t: ((key: string) => key) as ResearchTranslate,
    localizedRuntimeError: (_error, key) => key,
    requestModel: "provider:selected-model",
  });

beforeEach(() => {
  mocks.stream.mockReset();
  mocks.snapshotError = null;
  mocks.saveError = null;
  mocks.saves.mockClear();
  mocks.sourceContext.mockReset();
  mocks.sourceContext.mockReturnValue({
    approvedKnowledgeAttachments: [
      createKnowledgeCollectionAttachment({
        collectionId: "selected-kb",
        collectionName: "Selected",
      }),
    ],
    collections: [{ id: "selected-kb" }],
  });
  mocks.task = createResearchTask({
    id: "task",
    sessionId: "session",
    goal: "Study user-named concept",
  });
  mocks.snapshot = {
    model: "provider:selected-model",
    searchEnabled: true,
    toolIds: ["web_search", "search_knowledge"],
    knowledgeCollectionIds: ["selected-kb"],
    attachmentIds: [],
    workspaceFileIds: [],
    pluginIds: [],
  } as unknown as ResearchSourceSnapshot;
});
afterEach(() => {
  vi.useRealTimers();
});

describe("adaptive planning through the runtime", () => {
  it("pauses when an interrupted legacy task has no reliable request model", async () => {
    mocks.snapshotError = new ResearchModelUnavailableError();

    await execute();

    expect(mocks.stream).not.toHaveBeenCalled();
    expect(mocks.task).toMatchObject({
      status: "paused",
      error: {
        code: "RESEARCH_MODEL_UNAVAILABLE",
        message: "runtime.dependency.modelUnavailable",
        recoverable: true,
      },
    });
  });

  it("bounds stalled web model work to the same 90s stage deadline and still delivers a plan", async () => {
    vi.useFakeTimers();
    mocks.snapshot.knowledgeCollectionIds = [];
    mocks.stream
      .mockResolvedValueOnce(requestOutput)
      .mockImplementationOnce(async (...args) => {
        const signal = args[12]!;
        expect(args[17]!.researchQueryBudget!.deadlineAt! - Date.now()).toBe(
          90_000,
        );
        return new Promise<string>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          });
        });
      })
      .mockResolvedValueOnce(planOutput);
    const pending = execute();
    await vi.advanceTimersByTimeAsync(89_999);
    expect(mocks.stream).toHaveBeenCalledTimes(2);
    expect(mocks.task!.planVersions).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(mocks.task!.status).toBe("plan_ready");
    const recon = mocks.task!.planVersions[0].recon;
    expect(recon).toMatchObject({ timeoutMs: 90_000, status: "partial" });
    expect(reconSchema.safeParse(recon).success).toBe(true);
    expect(reconSchema.safeParse({ ...recon, timeoutMs: 30_000 }).success).toBe(
      true,
    );
    expect(reconSchema.safeParse({ ...recon, timeoutMs: 90_001 }).success).toBe(
      false,
    );
  });

  it("keeps knowledge lookup at 30s independently of the later web deadline", async () => {
    vi.useFakeTimers();
    mocks.stream
      .mockResolvedValueOnce(requestOutput)
      .mockImplementationOnce(async (...args) => {
        expect(args[17]!.researchQueryBudget!.deadlineAt! - Date.now()).toBe(
          30_000,
        );
        const signal = args[12]!;
        return new Promise<string>((_resolve, reject) =>
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          }),
        );
      })
      .mockImplementationOnce(async (...args) => {
        expect(args[17]!.researchQueryBudget!.deadlineAt! - Date.now()).toBe(
          90_000,
        );
        return planOutput;
      });
    const pending = execute();
    await vi.advanceTimersByTimeAsync(30_000);
    await pending;
    expect(mocks.task!.status).toBe("plan_ready");
  });
  it("drafts familiar topics in one closed-book call without opening any source", async () => {
    mocks.stream.mockResolvedValue(planOutput);
    await execute();
    expect(mocks.stream).toHaveBeenCalledTimes(1);
    expect(mocks.stream.mock.calls[0][17]).toMatchObject({
      disableTools: true,
      allowedToolIds: [],
      enforceAllowedToolIds: true,
    });
    expect(mocks.stream.mock.calls[0][1]).toBe("provider:selected-model");
    expect(mocks.sourceContext).not.toHaveBeenCalled();
    expect(mocks.task).toMatchObject({
      status: "plan_ready",
      evidence: [],
      executionRunIds: [],
    });
    expect(mocks.task!.planVersions[0].recon).toMatchObject({
      status: "skipped",
      sourceFeasibility: "unverified",
      usage: { queryCount: 0 },
    });
  });

  it("uses only selected knowledge when that resolves the missing concept", async () => {
    mocks.stream
      .mockResolvedValueOnce(requestOutput)
      .mockImplementationOnce(async (...args) => {
        args[17]?.researchQueryBudget?.onQueriesExecuted?.(request.queries);
        args[9]?.([
          {
            id: "lookup",
            name: "search_knowledge",
            args: { query: request.queries[0] },
            status: "success",
            result: {
              sources: [{ title: "Selected note", content: "Private context" }],
            },
          },
        ]);
        return planOutput;
      });
    await execute();
    expect(mocks.stream).toHaveBeenCalledTimes(2);
    expect(mocks.stream.mock.calls[1][17]).toMatchObject({
      allowedToolIds: ["search_knowledge"],
      allowedToolEffects: ["local_read"],
      knowledgeScope: { collections: [{ id: "selected-kb" }] },
    });
    const recon = mocks.task!.planVersions[0].recon;
    expect(recon.usage.queryCount).toBe(0);
    expect(recon.knowledgeQueries).toEqual([
      { query: request.queries[0], status: "completed", resultCount: 1 },
    ]);
    expect(reconSchema.safeParse(recon).success).toBe(true);
    expect(JSON.stringify(recon)).not.toContain("Private context");
    expect(mocks.task!.evidence).toEqual([]);
  });

  it("opens web only after unresolved knowledge and freezes the original public queries", async () => {
    mocks.stream
      .mockResolvedValueOnce(requestOutput)
      .mockResolvedValueOnce(
        JSON.stringify({ ...request, queries: ["PRIVATE extracted term"] }),
      )
      .mockResolvedValueOnce(planOutput);
    await execute();
    expect(
      mocks.stream.mock.calls.map((call) => call[17]?.allowedToolIds),
    ).toEqual([[], ["search_knowledge"], ["web_search"]]);
    const web = mocks.stream.mock.calls[2][17]!;
    expect([...web.researchQueryBudget!.allowedQueries!]).toEqual(
      request.queries,
    );
    expect(web.knowledgeScope).toBeUndefined();
    expect(mocks.stream.mock.calls[2][3]).not.toContain(
      "PRIVATE extracted term",
    );
  });

  it("skips absent knowledge and never enables other source tools", async () => {
    mocks.snapshot.knowledgeCollectionIds = [];
    mocks.stream
      .mockResolvedValueOnce(requestOutput)
      .mockResolvedValueOnce(planOutput);
    await execute();
    expect(
      mocks.stream.mock.calls.map((call) => call[17]?.allowedToolIds),
    ).toEqual([[], ["web_search"]]);
    expect(mocks.sourceContext).not.toHaveBeenCalled();
  });

  it("treats unavailable selected knowledge as an optional lookup failure", async () => {
    mocks.sourceContext.mockImplementation(() => {
      throw new Error("Storage unavailable");
    });
    mocks.stream
      .mockResolvedValueOnce(requestOutput)
      .mockResolvedValueOnce(planOutput);
    await execute();
    expect(
      mocks.stream.mock.calls.map((call) => call[17]?.allowedToolIds),
    ).toEqual([[], ["web_search"]]);
    expect(mocks.task!.status).toBe("plan_ready");
    expect(mocks.task!.planVersions[0].recon.status).toBe("partial");
  });

  it("finishes closed-book after optional lookups fail", async () => {
    mocks.stream
      .mockResolvedValueOnce(requestOutput)
      .mockRejectedValueOnce(new Error("Knowledge unavailable"))
      .mockRejectedValueOnce(new Error("Search timed out"))
      .mockResolvedValueOnce(planOutput);
    await execute();
    expect(mocks.task!.status).toBe("plan_ready");
    expect(mocks.stream.mock.calls.at(-1)![17]?.disableTools).toBe(true);
    expect(mocks.stream).toHaveBeenCalledTimes(4);
    expect(mocks.task!.planVersions[0].recon.status).toBe("partial");
  });

  it("keeps source access closed for malformed context requests and repairs the plan", async () => {
    mocks.stream
      .mockResolvedValueOnce(JSON.stringify({ ...request, queries: [] }))
      .mockResolvedValueOnce(JSON.stringify(plan));
    await execute();
    expect(mocks.task!.status).toBe("plan_ready");
    expect(
      mocks.stream.mock.calls.every((call) => call[17]?.disableTools),
    ).toBe(true);
  });

  it("uses an assumption-only final round when no lookup is enabled", async () => {
    mocks.snapshot.searchEnabled = false;
    mocks.snapshot.knowledgeCollectionIds = [];
    mocks.stream
      .mockResolvedValueOnce(requestOutput)
      .mockResolvedValueOnce(planOutput);
    await execute();
    expect(
      mocks.stream.mock.calls.every((call) => call[17]?.disableTools),
    ).toBe(true);
    expect(mocks.task!.planVersions[0].recon.status).toBe("unavailable");
  });

  it("records a timeout before query dispatch as a failed precheck rather than a skipped lookup", async () => {
    mocks.snapshot.knowledgeCollectionIds = [];
    mocks.stream
      .mockResolvedValueOnce(requestOutput)
      .mockImplementationOnce(async (...args) => {
        args[9]?.([
          {
            id: "timeout",
            name: "web_search",
            args: { query: request.queries[0] },
            status: "error",
            result: {
              ok: false,
              error: {
                code: "RESEARCH_RECON_TIMEOUT",
                message: "Lookup deadline elapsed",
              },
            },
          },
        ]);
        return planOutput;
      });
    await execute();
    expect(mocks.task!.status).toBe("plan_ready");
    expect(mocks.task!.planVersions[0].recon).toMatchObject({
      status: "partial",
      sourceFeasibility: "unverified",
      usage: { queryCount: 0 },
    });
  });

  it("does not save a plan after user cancellation during a lookup", async () => {
    const controller = new AbortController();
    mocks.stream
      .mockResolvedValueOnce(requestOutput)
      .mockImplementationOnce(async () => {
        mocks.task!.status = "cancelled";
        controller.abort();
        return planOutput;
      });
    await execute(controller);
    expect(mocks.task!.status).toBe("cancelled");
    expect(mocks.task!.planVersions).toEqual([]);
    expect(mocks.stream).toHaveBeenCalledTimes(2);
  });
});

it("accepts legacy raw plans but rejects ambiguous or invalid context requests", () => {
  expect(parseResearchPlanningResponse('{"kind":"plan"}')).toBeNull();
  expect(parseResearchPlanningResponse(JSON.stringify(plan))?.kind).toBe(
    "plan",
  );
  expect(
    parseResearchPlanningResponse(JSON.stringify({ ...request, plan })),
  ).toBeNull();
  expect(
    parseResearchPlanningResponse(
      JSON.stringify({ ...request, queries: [""] }),
    ),
  ).toBeNull();
});

describe("plan repair regressions", () => {
  const oversized = {
    ...plan,
    steps: Array.from({ length: 9 }, (_, index) => ({
      ...plan.steps[0],
      id: `step-${index + 1}`,
      queryTopics: [`Topic ${index + 1}`],
    })),
  };

  it.each(["bare", "envelope"])(
    "repairs an oversized envelope with a %s plan",
    async (shape) => {
      mocks.stream
        .mockResolvedValueOnce(
          JSON.stringify({ kind: "plan", plan: oversized }),
        )
        .mockResolvedValue(
          shape === "bare" ? JSON.stringify(plan) : planOutput,
        );
      await execute();
      expect(mocks.task!.status).toBe("plan_ready");
      expect(mocks.stream).toHaveBeenCalledTimes(2);
      const repair = mocks.stream.mock.calls[1];
      expect(repair[3]).toContain(
        "steps: Too big: expected array to have <=8 items",
      );
      expect(repair[3]).not.toContain("received undefined");
      expect(repair[3]).toContain("3-8");
      expect(repair[3]).toContain("Preserve all research questions");
      expect(repair[17]).toMatchObject({ disableTools: true });
    },
  );

  it("accepts eight steps without spending a repair round", async () => {
    mocks.stream.mockResolvedValue(
      JSON.stringify({
        kind: "plan",
        plan: { ...oversized, steps: oversized.steps.slice(0, 8) },
      }),
    );
    await execute();
    expect(mocks.task!.status).toBe("plan_ready");
    expect(mocks.task!.planVersions[0].steps).toHaveLength(8);
    expect(mocks.stream).toHaveBeenCalledTimes(1);
  });

  it.each([1, 9])(
    "replaces exhausted %i-step failures with a three-step starter plan",
    async (count) => {
      mocks.stream.mockResolvedValue(
        JSON.stringify({
          kind: "plan",
          plan: { ...oversized, steps: oversized.steps.slice(0, count) },
        }),
      );
      await execute();
      expect(mocks.stream).toHaveBeenCalledTimes(3);
      expect(mocks.task!.status).toBe("plan_ready");
      expect(mocks.task!.planVersions).toHaveLength(1);
      expect(mocks.task!.planVersions[0].steps).toHaveLength(3);
      expect(isStarterResearchPlan(mocks.task!.planVersions[0])).toBe(true);
      expect(
        isStarterResearchPlan({
          ...mocks.task!.planVersions[0],
          adjustment: "Edited plan",
        }),
      ).toBe(false);
      expect(mocks.task!.planVersions[0].scope.allowedSourceTypes).toEqual([
        "web",
        "knowledge",
      ]);
    },
  );
});

it("does not accept a context request or unknown response kind as a repaired plan", () => {
  for (const kind of ["needs_context", "unexpected"]) {
    expect(parseResearchPlan(JSON.stringify({ ...plan, kind })).valid).toBe(
      false,
    );
    expect(parseResearchPlan(JSON.stringify({ kind, plan })).valid).toBe(false);
  }
});

it("records a recoverable planning failure even when its failure-state save cannot persist", async () => {
  const onError = vi.fn();
  mocks.saveError = new Error("storage failed");
  await expect(
    prepareResearchPlan({
      taskId: "task",
      controller: new AbortController(),
      t: ((key: string) => key) as ResearchTranslate,
      localizedRuntimeError: () => "Storage unavailable",
      onError,
    }),
  ).resolves.toBeUndefined();
  expect(mocks.task).toMatchObject({
    status: "failed",
    error: { message: "Storage unavailable", recoverable: true },
  });
  expect(onError).toHaveBeenCalledOnce();
  expect(mocks.stream).not.toHaveBeenCalled();
});

describe("planning rollback", () => {
  const existing = () => ({
    ...mocks.task!,
    status: "plan_ready" as const,
    activePlanVersion: 1,
    planVersions: [
      {
        ...plan,
        id: "existing-plan",
        version: 1,
        createdAt: 1,
        recon: buildResearchReconSnapshot({
          enabled: false,
          startedAt: 1,
          completedAt: 1,
          executedQueries: [],
          toolCalls: [],
        }),
      },
    ],
  });

  it("rejects exhausted edits and retains the approved plan without using a starter", async () => {
    const previous = existing();
    mocks.task = previous;
    mocks.stream.mockResolvedValue("invalid JSON");
    await expect(execute()).rejects.toThrow("runtime.error.adjustFailed");
    expect(mocks.stream).toHaveBeenCalledTimes(3);
    expect(mocks.task!.status).toBe("plan_ready");
    expect(mocks.task!.planVersions).toEqual(previous.planVersions);
    expect(mocks.task!.error?.code).toBe("RESEARCH_PLAN_ADJUST_FAILED");
    expect(mocks.task!.agentRunIds.length).toBeGreaterThan(0);
  });

  it.each([
    new ResearchModelUnavailableError(),
    new AgentRunLeaseConflictError({
      version: 1,
      sessionId: "session",
      runId: "other-run",
      runIds: ["other-run"],
      ownerId: "other-tab",
      acquiredAt: 1,
      checkpointAt: 1,
      expiresAt: 1000,
    }),
    new Error("invalid API key"),
    new DOMException("Interrupted", "AbortError"),
  ])("retains a plan when planning fails with %s", async (error) => {
    const previous = existing();
    mocks.task = previous;
    mocks.snapshotError = error;
    await expect(execute()).rejects.toThrow("runtime.error.adjustFailed");
    expect(mocks.task!.status).toBe("plan_ready");
    expect(mocks.task!.planVersions).toEqual(previous.planVersions);
    expect(mocks.stream).not.toHaveBeenCalled();
  });

  it("restores the completed snapshot and evidence after a failed refresh", async () => {
    const previous = {
      ...existing(),
      status: "completed" as const,
      endedAt: 123,
    };
    mocks.task = {
      ...previous,
      status: "clarifying",
      pendingReportKind: "update",
    };
    mocks.stream.mockRejectedValue(new Error("invalid API key"));
    await expect(
      prepareResearchPlan({
        taskId: "task",
        previousTask: previous,
        controller: new AbortController(),
        t: ((key: string) => key) as ResearchTranslate,
        localizedRuntimeError: () => "Failure",
      }),
    ).rejects.toThrow("runtime.error.adjustFailed");
    expect(mocks.task).toMatchObject({
      status: "completed",
      endedAt: 123,
      pendingReportKind: "initial",
      evidence: previous.evidence,
    });
  });

  it("does not undo a cancellation during editing", async () => {
    mocks.task = existing();
    mocks.stream.mockImplementation(async () => {
      mocks.task = { ...mocks.task!, status: "cancelled" };
      throw new DOMException("Cancelled", "AbortError");
    });
    await expect(execute()).rejects.toThrow("runtime.error.adjustFailed");
    expect(mocks.task!.status).toBe("cancelled");
  });
});

describe("safe planning model retry", () => {
  it("retries closed-book connection loss before any output", async () => {
    vi.useFakeTimers();
    mocks.stream
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValue(planOutput);
    const pending = execute();
    await vi.runAllTimersAsync();
    await pending;
    expect(mocks.stream).toHaveBeenCalledTimes(2);
    expect(mocks.task!.status).toBe("plan_ready");
  });

  it("does not replay a closed-book round after output", async () => {
    mocks.stream.mockImplementation(async (...args) => {
      args[6]("partial plan");
      throw new TypeError("Failed to fetch");
    });
    await execute();
    expect(mocks.stream).toHaveBeenCalledTimes(1);
    expect(mocks.task!.status).toBe("failed");
    expect(mocks.task!.planVersions).toHaveLength(0);
  });
});

it.each(["quota", "conflict"] as const)(
  "preserves typed %s failures and the old plan without a rollback storage write",
  async (reason) => {
    mocks.stream.mockResolvedValue(planOutput);
    await execute();
    const previous = mocks.task!;
    mocks.saves.mockClear();
    const failure = new ResearchPersistenceError(reason);
    mocks.stream.mockImplementation(async () => {
      // Fail the final save, after the replacement plan has been validated.
      mocks.saveError = failure;
      return planOutput;
    });
    await expect(execute()).rejects.toBe(failure);
    expect(mocks.saves).toHaveBeenCalledTimes(2);
    expect(mocks.task).toMatchObject({
      status: "plan_ready",
      activePlanVersion: previous.activePlanVersion,
      error: {
        code: `RESEARCH_STORAGE_${reason}`,
        message: "runtime.error.persistence",
        recoverable: true,
      },
    });
    expect(mocks.task!.planVersions).toEqual(previous.planVersions);
  },
);
