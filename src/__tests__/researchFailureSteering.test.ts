import { expect, it, vi } from "vitest";
import type { ResearchExecutionContext } from "@/lib/research/runtime/executionContext";

const publish = vi.hoisted(() => vi.fn(async () => ["Interrupted"]));
vi.mock("@/lib/research/runtime/reportPublication", () => ({
  publishResearchReportVersion: publish,
}));
vi.mock("@/lib/research", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  buildDeterministicSalvageReport: () => "# Preserved findings",
  auditResearchReport: () => ({
    blocking: [],
    advisory: [],
    unknownCitationCount: 0,
    unsupportedFindingCount: 0,
    missingSectionCount: 0,
  }),
}));
import { handleExecutionFailure } from "@/lib/research/runtime/stages/failure";

it("keeps accepted unanswered questions in a salvage report's gaps", async () => {
  const ctx = {
    taskId: "task",
    store: {
      tasksById: { task: { status: "researching" } },
      setActiveTask: vi.fn(),
    },
    controller: new AbortController(),
    run: {
      nodes: [
        { id: "original", status: "completed", claimIds: ["verified"] },
        { id: "added", status: "pending", claimIds: [] },
      ],
    },
    evidence: [],
    steeringRecord: {
      commands: [
        {
          status: "applied",
          intent: {
            kind: "add",
            nodeId: "added",
            question: "What happens if storage fails?",
          },
        },
      ],
    },
    t: (key: string) => key,
    localizedRuntimeError: () => "Source unavailable",
  } as unknown as ResearchExecutionContext;
  await handleExecutionFailure(ctx, new Error("Source unavailable"));
  expect(publish).toHaveBeenCalledWith(
    expect.objectContaining({
      extraGaps: [
        "runtime.gaps.executionInterrupted",
        "Source unavailable",
        "What happens if storage fails?",
      ],
    }),
  );
});

it("treats a checkpoint-triggered stream abort as a storage failure without salvage or a user pause", async () => {
  const { createResearchTask } = await import("@/lib/research/task");
  const { ResearchPersistenceError } =
    await import("@/services/research/taskRepository/errors");
  let task = {
    ...createResearchTask({
      id: "task",
      sessionId: "session",
      goal: "Research",
      now: 100,
    }),
    status: "researching" as const,
  } as import("@/lib/research").ResearchTask;
  const updateTask = vi.fn(
    async (_id: string, update: (current: typeof task) => typeof task) => {
      task = update(task);
      return task;
    },
  );
  const setActiveTask = vi.fn();
  const onError = vi.fn();
  const publishedBefore = publish.mock.calls.length;
  const ctx = {
    taskId: "task",
    controller: new AbortController(),
    run: { id: "run" },
    store: { tasksById: { task }, updateTask, setActiveTask },
    localizedRuntimeError: () => "Storage full",
    t: (key: string) => key,
  } as unknown as ResearchExecutionContext;
  await handleExecutionFailure(
    ctx,
    new ResearchPersistenceError("quota"),
    onError,
  );
  expect(task).toMatchObject({
    status: "failed",
    error: { message: "Storage full", recoverable: true },
  });
  expect(updateTask).toHaveBeenCalledWith("task", expect.any(Function), {
    persistence: "best-effort",
  });
  expect(setActiveTask).toHaveBeenCalledWith(null);
  expect(onError).toHaveBeenCalledOnce();
  expect(publish).toHaveBeenCalledTimes(publishedBefore);
});

it.each(["failed", "completed", "interrupted"])(
  "pauses connection loss and keeps stream history for validation on recovery (%s)",
  async (status) => {
    const { createResearchTask } = await import("@/lib/research");
    const { useAgentRunStore } = await import("@/store/core/agentRunStore");
    const original = createResearchTask({
      id: "task",
      sessionId: "session",
      goal: "Research",
      now: 100,
    });
    const run = {
      id: "run",
      nodes: [],
      waves: [],
      phase: "exploring",
    } as unknown as import("@/lib/research").ResearchReportRun;
    let task = {
      ...original,
      status: "researching",
      checkpoint: {
        createdAt: 100,
        resumeStatus: "researching",
        committedEvidenceIds: [],
        committedToolExecutionIds: [],
        historyPath: "checkpoint.json",
        researchRunId: run.id,
      },
    } as import("@/lib/research").ResearchTask;
    useAgentRunStore.setState({
      runsById: {
        agent: { id: "agent", status } as import("@/lib/agent").AgentRun,
      },
    });
    const ctx = {
      taskId: "task",
      lastAgentRunId: "agent",
      controller: new AbortController(),
      run,
      evidence: [],
      store: {
        tasksById: { task },
        updateTask: async (
          _id: string,
          update: (current: typeof task) => typeof task,
        ) => {
          task = update(task);
          return task;
        },
        setActiveTask: vi.fn(),
      },
      t: (key: string) => key,
    } as unknown as ResearchExecutionContext;
    const publishedBefore = publish.mock.calls.length;
    await handleExecutionFailure(ctx, new TypeError("Failed to fetch"));
    expect(task.status).toBe("paused");
    expect(task.error?.code).toBe("RESEARCH_CONNECTION_LOST");
    expect(task.checkpoint?.historyPath).toBe("checkpoint.json");
    expect(publish).toHaveBeenCalledTimes(publishedBefore);
  },
);
