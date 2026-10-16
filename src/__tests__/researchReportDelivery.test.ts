import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createResearchReportRun,
  createResearchTask,
  type ResearchPlanVersion,
  type ResearchTask,
} from "@/lib/research";
import type { ResearchExecutionContext } from "@/lib/research/runtime/executionContext";
import { ResearchWorkspaceUnavailableError } from "@/lib/research/runtime/dependencyErrors";

const mocks = vi.hoisted(() => ({
  stream: vi.fn(),
  publish: vi.fn(async () => ["Incomplete"]),
  chat: {
    sessions: [] as Array<{ id: string; config: { chatMode: string } }>,
    setSessionChatMode: vi.fn(),
  },
}));
vi.mock("@/store/core/chatStore", () => ({
  useChatStore: { getState: () => mocks.chat },
}));
vi.mock("@/lib/research/pendingTask", () => ({
  selectVisibleResearchTaskId: (
    { tasksById }: { tasksById: Record<string, ResearchTask> },
    sessionId: string,
  ) =>
    Object.values(tasksById).find(
      (task) =>
        task.sessionId === sessionId &&
        !["completed", "partial_completed", "cancelled", "failed"].includes(
          task.status,
        ),
    )?.id ?? null,
}));
vi.mock("@/services/api/chatService", () => ({
  streamChatResponse: mocks.stream,
}));
vi.mock("@/lib/research/runtime/reportPublication", () => ({
  publishResearchReportVersion: mocks.publish,
}));
vi.mock("@/lib/research/runtime/executionContext", () => ({
  persistRun: vi.fn(),
}));
vi.mock("@/lib/research/runtime/usage", () => ({
  aggregateExecutionUsage: () => ({
    toolCalls: 0,
    toolRounds: 0,
    totalTokens: 0,
    wallTimeMs: 0,
  }),
  aggregateTaskUsage: () => ({
    toolCalls: 0,
    toolRounds: 0,
    totalTokens: 0,
    wallTimeMs: 0,
  }),
  remainingBudget: () => ({ maxToolCalls: 4 }),
}));
import { runSynthesisStage } from "@/lib/research/runtime/stages/synthesis";
import { handleExecutionFailure } from "@/lib/research/runtime/stages/failure";

const plan: ResearchPlanVersion = {
  id: "plan",
  version: 1,
  title: "Research",
  summary: "Research",
  objective: "Research",
  scope: {
    audience: "Readers",
    includes: [],
    excludes: [],
    allowedSourceTypes: [],
  },
  assumptions: [],
  deliverable: {
    kind: "research_report",
    description: "Research",
    requiredSections: [],
  },
  strategy: {
    initialBreadth: 1,
    maxDepth: 1,
    maxQueries: 4,
    resultsPerQuery: 5,
  },
  recon: {
    status: "completed",
    sourceFeasibility: "verified",
    startedAt: 1,
    completedAt: 2,
    timeoutMs: 30000,
    queryLimit: 1,
    resultsPerQuery: 5,
    queries: [],
    usage: { queryCount: 0, resultCount: 0, wallTimeMs: 0 },
  },
  steps: [],
  completionCriteria: [],
  createdAt: 1,
};
function context(status: ResearchTask["status"] = "verifying") {
  let task: ResearchTask = {
    ...createResearchTask({
      id: "task",
      sessionId: "session",
      goal: "Explain a concept",
    }),
    status,
    planVersions: [plan],
    activePlanVersion: 1,
  };
  const run = createResearchReportRun({ taskId: task.id, plan });
  task = { ...task, reportRuns: [run], activeReportRunId: run.id };
  return {
    taskId: task.id,
    task,
    plan,
    run,
    evidence: [],
    controller: new AbortController(),
    researchModel: "model",
    chatConfig: {},
    effective: { systemInstruction: "" },
    sourceBodyLimit: 4,
    store: {
      get tasksById() {
        return { task };
      },
      updateTask: async (
        _id: string,
        update: (task: ResearchTask) => ResearchTask,
      ) => {
        task = update(task);
        return task;
      },
      setActiveTask: vi.fn(),
    },
    t: (key: string) => key,
    dependencyText: {
      sourceUnavailable: (source: string) => `Unavailable: ${source}`,
    },
    localizedRuntimeError: () => "Connection interrupted",
    onNotice: vi.fn(),
  } as unknown as ResearchExecutionContext;
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.chat.sessions = [{ id: "session", config: { chatMode: "research" } }];
});

describe("research report delivery", () => {
  it("publishes a zero-evidence model report with audit notices without a repair request", async () => {
    const ctx = context();
    const markdown =
      "# Research\n\n## Knowledge supplement (unverified)\n\nA useful conceptual explanation.";
    mocks.stream.mockResolvedValueOnce(markdown);
    await runSynthesisStage(ctx);
    expect(mocks.stream).toHaveBeenCalledTimes(1);
    expect(mocks.stream.mock.calls[0][3]).toContain("model knowledge");
    expect(mocks.stream.mock.calls[0][7]).toContain("never invent citations");
    expect(mocks.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        markdown,
        evidence: [],
        audit: expect.objectContaining({
          missingSectionCount: expect.any(Number),
        }),
      }),
    );
    expect(ctx.run.claims).toEqual([]);
    expect(ctx.evidence).toEqual([]);
  });

  it("preserves streamed text when the model connection fails", async () => {
    const ctx = context();
    mocks.stream.mockImplementationOnce(async (...args: unknown[]) => {
      (args[6] as (text: string) => void)(
        "# Partial report\n\nUseful retained text.",
      );
      throw new Error("Connection lost");
    });
    await runSynthesisStage(ctx);
    expect(mocks.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        markdown: "# Partial report\n\nUseful retained text.",
        extraGaps: [
          "runtime.gaps.executionInterrupted",
          "Connection interrupted",
        ],
      }),
    );
    expect(mocks.stream).toHaveBeenCalledTimes(1);
  });

  it("retains the last streamed body when the final model return is empty", async () => {
    mocks.stream.mockImplementationOnce(async (...args: unknown[]) => {
      (args[6] as (text: string) => void)("# Retained report\n\nUseful text.");
      return "";
    });
    await runSynthesisStage(context());
    expect(mocks.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        markdown: "# Retained report\n\nUseful text.",
      }),
    );
  });

  it("uses the same deterministic delivery when no model text is available", async () => {
    const ctx = context();
    mocks.stream.mockRejectedValueOnce(new Error("Connection lost"));
    await runSynthesisStage(ctx);
    expect(mocks.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        markdown: expect.stringContaining(
          "No evidence-supported finding was established",
        ),
        evidence: [],
      }),
    );
    mocks.publish.mockClear();
    await handleExecutionFailure(context(), new Error("Exploration failed"));
    expect(mocks.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        markdown: expect.stringContaining("## Questions still to verify"),
      }),
    );
  });

  it("never delivers a streamed draft after the user aborts", async () => {
    const ctx = context();
    mocks.stream.mockImplementationOnce(async (...args: unknown[]) => {
      (args[6] as (text: string) => void)("# Cancelled draft");
      ctx.controller.abort();
      ctx.controller.signal.throwIfAborted();
    });
    await expect(runSynthesisStage(ctx)).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(mocks.publish).not.toHaveBeenCalled();
  });

  it("pauses instead of failing when the user stops fallback publication", async () => {
    const ctx = context();
    mocks.publish.mockImplementationOnce(async () => {
      ctx.controller.abort();
      ctx.controller.signal.throwIfAborted();
      return [];
    });
    const onError = vi.fn();
    await handleExecutionFailure(ctx, new Error("Source failed"), onError);
    expect(ctx.store.tasksById.task.status).toBe("paused");
    expect(onError).not.toHaveBeenCalled();
  });

  it("pauses with a retryable dependency error when the workspace read fails", async () => {
    const ctx = context();
    const onError = vi.fn();

    await handleExecutionFailure(
      ctx,
      new ResearchWorkspaceUnavailableError("OPFS read failed"),
      onError,
    );

    expect(ctx.store.tasksById.task).toMatchObject({
      status: "paused",
      error: {
        code: "RESEARCH_WORKSPACE_UNAVAILABLE",
        message: "Unavailable: workspace",
        recoverable: true,
      },
      checkpoint: { resumeStatus: "researching" },
      reportRuns: [
        expect.objectContaining({
          phase: "paused",
          stopReason: expect.objectContaining({
            code: "dependency_unavailable",
          }),
        }),
      ],
    });
    expect(ctx.onNotice).toHaveBeenCalledWith("Unavailable: workspace");
    expect(onError).not.toHaveBeenCalled();
    expect(mocks.publish).not.toHaveBeenCalled();
  });

  it("retains the draft but does not retry publication after a core save failure", async () => {
    const ctx = context();
    const markdown = "# Original report\n\nKeep this body.";
    mocks.stream.mockResolvedValueOnce(markdown);
    mocks.publish.mockRejectedValueOnce(new Error("Persistence failed"));
    let failure: unknown;
    try {
      await runSynthesisStage(ctx);
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(Error);
    await handleExecutionFailure(ctx, failure);
    expect(mocks.publish).toHaveBeenCalledTimes(1);
    expect(ctx.reportDraft).toBe(markdown);
    expect(ctx.store.tasksById.task.status).toBe("failed");
  });
});

describe("report delivery chat mode", () => {
  it("switches only the delivered session after publication succeeds", async () => {
    const { deliverResearchReport } =
      await import("@/lib/research/runtime/reportDelivery");
    const ctx = context("completed");
    mocks.publish.mockImplementationOnce(async () => {
      expect(mocks.chat.setSessionChatMode).not.toHaveBeenCalled();
      await ctx.store.updateTask(ctx.taskId, (task) => ({
        ...task,
        status: "completed",
      }));
      return [];
    });
    await deliverResearchReport(ctx, { markdown: "# Report" });
    expect(mocks.chat.setSessionChatMode).toHaveBeenCalledExactlyOnceWith(
      "session",
      "auto",
    );
  });
  it("retains mode when publication fails or user changes mode during publication", async () => {
    const { deliverResearchReport } =
      await import("@/lib/research/runtime/reportDelivery");
    mocks.publish.mockRejectedValueOnce(new Error("save failed"));
    await expect(
      deliverResearchReport(context("completed"), { markdown: "# Report" }),
    ).rejects.toThrow("save failed");
    expect(mocks.chat.setSessionChatMode).not.toHaveBeenCalled();
    mocks.publish.mockImplementationOnce(async () => {
      mocks.chat.sessions[0].config.chatMode = "agent";
      return [];
    });
    await deliverResearchReport(context("completed"), { markdown: "# Report" });
    expect(mocks.chat.setSessionChatMode).not.toHaveBeenCalled();
  });
  it("does not switch when another visible task is awaiting approval", async () => {
    const { deliverResearchReport } =
      await import("@/lib/research/runtime/reportDelivery");
    const ctx = context("completed");
    Object.defineProperty(ctx.store, "tasksById", {
      get: () => ({
        task: ctx.task,
        other: { ...ctx.task, id: "other", status: "plan_ready" },
      }),
    });
    await deliverResearchReport(ctx, { markdown: "# Report" });
    expect(mocks.chat.setSessionChatMode).not.toHaveBeenCalled();
  });
  it("does not change temporary sessions or a task continued during publication", async () => {
    const { deliverResearchReport } =
      await import("@/lib/research/runtime/reportDelivery");
    const ctx = context("completed");
    Object.assign(mocks.chat.sessions[0], { retention: "temporary" });
    await deliverResearchReport(ctx, { markdown: "# Report" });
    expect(mocks.chat.setSessionChatMode).not.toHaveBeenCalled();
    Object.assign(mocks.chat.sessions[0], { retention: undefined });
    mocks.publish.mockImplementationOnce(async () => {
      await ctx.store.updateTask(ctx.taskId, (task) => ({
        ...task,
        status: "researching",
      }));
      return [];
    });
    await deliverResearchReport(ctx, { markdown: "# Report" });
    expect(mocks.chat.setSessionChatMode).not.toHaveBeenCalled();
  });

  it("rethrows an exhausted connection failure without publishing a fallback", async () => {
    vi.useFakeTimers();
    try {
      mocks.stream.mockRejectedValue(new TypeError("Failed to fetch"));
      const promise = runSynthesisStage(context());
      const assertion = expect(promise).rejects.toThrow("Failed to fetch");
      await vi.runAllTimersAsync();
      await assertion;
      expect(mocks.publish).not.toHaveBeenCalled();
    } finally {
      mocks.stream.mockReset();
      vi.useRealTimers();
    }
  });
  it("delivers visible text after a connection failure without retry", async () => {
    mocks.stream.mockImplementationOnce(async (...args: unknown[]) => {
      (args[6] as (text: string) => void)("# Partial report");
      throw new TypeError("Failed to fetch");
    });
    await runSynthesisStage(context());
    expect(mocks.stream).toHaveBeenCalledTimes(1);
    expect(mocks.publish).toHaveBeenCalledWith(
      expect.objectContaining({ markdown: "# Partial report" }),
    );
  });
});
