// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ResearchTask,
  ResearchSourceSnapshot,
  ResearchPlanVersion,
} from "@/lib/research";
const data = vi.hoisted(() => ({
  tasks: new Map<string, ResearchTask>(),
  saves: vi.fn(),
  list: vi.fn(),
  capture: vi.fn(),
  resolveModel: vi.fn(),
  pruneFiles: vi.fn(),
  deleteArtifact: vi.fn(),
}));
const repository = vi.hoisted(() => ({
  getStatus: () => ({ durable: true, mode: "persistent" }),
  recover: vi.fn<(task: ResearchTask) => Promise<void>>(async () => {}),
  get: vi.fn(async (id: string) => structuredClone(data.tasks.get(id) ?? null)),
  save: async (task: ResearchTask) => {
    await data.saves(structuredClone(task));
    data.tasks.set(task.id, structuredClone(task));
  },
  list: async (sessionId?: string) =>
    data.list(sessionId) ??
    structuredClone(
      [...data.tasks.values()].filter(
        (task) => !sessionId || task.sessionId === sessionId,
      ),
    ),
  remove: vi.fn(async (id: string) => {
    data.tasks.delete(id);
  }),
}));
vi.mock("@/services/research", () => ({
  getResearchTaskRepository: () => repository,
  deleteResearchReportArtifact: data.deleteArtifact,
  pruneUnreferencedResearchStorage: data.pruneFiles,
}));
vi.mock("@/services/research/runtime", () => ({
  getResearchTaskRepository: () => repository,
}));
vi.mock("@/lib/research/runtime/sourceSnapshot", () => ({
  captureApprovedWorkspaceSources: data.capture,
  createSourceSnapshot: vi.fn(),
  resolveResearchTaskModel: data.resolveModel,
}));
vi.mock("@/lib/research/runtime/taskContext", () => ({
  getResearchDependencyError: vi.fn(() => undefined),
  resolveTaskContext: () => ({
    effective: { agentBudget: { maxToolCalls: 30, maxDurationMs: 600000 } },
  }),
}));
vi.mock("@/lib/research/runtime/evidenceConversation", () => ({
  cancelAllEvidenceAnswers: vi.fn(),
}));
vi.mock("@/services/research/extensionLifecycle", () => ({
  pruneResearchExtensions: vi.fn(),
}));
import { createResearchTask } from "@/lib/research";
import { useResearchStore } from "@/store/core/researchStore";
import { useResearchOperations } from "@/hooks/research/useResearchOperations";
import { runResearchTaskAction } from "@/lib/research/runtime/taskLifecycle";
import { useChatStore } from "@/store/core/chatStore";
import { useResearchTaskActions } from "@/hooks/research/useResearchTaskActions";
import { usePlanActions } from "@/hooks/research/usePlanActions";
import { ResearchWorkspaceUnavailableError } from "@/lib/research/runtime/dependencyErrors";
import {
  isResearchTaskExecutionLease,
  isResearchTaskLocallyLocked,
  withResearchTaskExecutionLock,
  type ResearchTaskExecutionLease,
} from "@/services/research/taskExecutionLock";
import {
  createMemoryResearchExtensionRepository,
  setResearchExtensionRepositoryForTests,
} from "@/services/research/extensionRepository";

const browserLocks = new Set<string>();
const lockRequest = vi.fn(
  async (
    name: string,
    _options: unknown,
    callback: (lock: { name: string } | null) => Promise<unknown>,
  ) => {
    if (browserLocks.has(name)) return callback(null);
    browserLocks.add(name);
    try {
      return await callback({ name });
    } finally {
      browserLocks.delete(name);
    }
  },
);
function task(status: ResearchTask["status"]): ResearchTask {
  const base = createResearchTask({
    id: "task",
    sessionId: "session",
    goal: "Review",
    now: 1,
  });
  return {
    ...base,
    status,
    activePlanVersion: 1,
    requestedStrategy: {
      initialBreadth: 2,
      maxDepth: 2,
      maxQueries: 6,
      resultsPerQuery: 5,
    },
    planVersions: [
      {
        id: "plan",
        version: 1,
        strategy: {
          initialBreadth: 2,
          maxDepth: 2,
          maxQueries: 6,
          resultsPerQuery: 5,
        },
        steps: [],
      } as unknown as ResearchPlanVersion,
    ],
    sourceSnapshot: {
      model: "provider:model",
      pluginIds: [],
      toolIds: [],
    } as unknown as ResearchSourceSnapshot,
    checkpoint: {
      createdAt: 2,
      resumeStatus: "researching",
      committedEvidenceIds: [],
      committedToolExecutionIds: [],
    },
  };
}
function latestReport(): ResearchTask {
  return {
    ...task("completed"),
    updatedAt: 50,
    checkpoint: undefined,
    reportVersions: [
      {
        id: "new-report",
        researchRunId: "latest-run",
        version: 2,
        artifactId: "opfs://latest",
        planVersion: 1,
        createdAt: 50,
        summary: "Latest report",
        keyFindings: ["Latest evidence"],
        gaps: [],
        kind: "initial",
      },
    ],
  };
}
function hydrateLocal(value: ResearchTask) {
  useResearchStore.setState({
    tasksById: { task: value },
    hydrated: true,
    loadedSessionIds: { session: true },
  });
}
function dependencies(
  launchResearch = vi.fn<
    (id: string, lease?: ResearchTaskExecutionLease) => Promise<void>
  >(async () => {}),
) {
  return {
    claimActiveSlot: vi.fn(async () => true),
    checkpointUnavailableText: "Unavailable",
    launchResearch,
    preparePlan: vi.fn(async () => {}),
    onNotice: vi.fn(),
  };
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { resolve, promise };
}
beforeEach(() => {
  data.tasks.clear();
  data.saves.mockReset();
  repository.recover.mockReset().mockResolvedValue(undefined);
  data.list.mockReset();
  data.capture.mockReset().mockResolvedValue([]);
  data.resolveModel.mockReset().mockResolvedValue("provider:model");
  data.pruneFiles.mockReset();
  data.deleteArtifact.mockReset();
  repository.get.mockClear();
  repository.remove.mockClear();
  browserLocks.clear();
  lockRequest.mockClear();
  vi.stubGlobal("navigator", { locks: { request: lockRequest } });
  setResearchExtensionRepositoryForTests(
    createMemoryResearchExtensionRepository(),
  );
  useResearchStore.setState({
    tasksById: {},
    loadedSessionIds: {},
    hydrated: false,
    activeTaskId: null,
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  setResearchExtensionRepositoryForTests(undefined);
});

it("recovers the retained local task under its lease before refreshing or launching", async () => {
  const retained = {
    ...task("failed"),
    error: {
      code: "RESEARCH_PLAN_FAILED",
      message: "Unsaved",
      recoverable: true,
    },
  };
  hydrateLocal(retained);
  data.tasks.set("task", task("clarifying"));
  repository.recover.mockImplementationOnce(async (local) => {
    expect(isResearchTaskLocallyLocked(local.id)).toBe(true);
    expect(local).toEqual(retained);
    data.tasks.set(local.id, local);
  });
  const action = vi.fn(async (current: ResearchTask) => {
    expect(current).toEqual(retained);
  });
  await runResearchTaskAction("task", action);
  expect(action).toHaveBeenCalledOnce();
});

it("keeps recovery conflicts local and never starts the action or writes over the other tab", async () => {
  const { ResearchPersistenceError } =
    await import("@/services/research/taskRepository/errors");
  hydrateLocal(task("failed"));
  repository.recover.mockRejectedValueOnce(
    new ResearchPersistenceError("conflict"),
  );
  const action = vi.fn();
  const failureLocks: boolean[] = [];
  const unsubscribe = useResearchStore.subscribe((state) => {
    if (state.tasksById.task.error?.code === "RESEARCH_STORAGE_conflict")
      failureLocks.push(isResearchTaskLocallyLocked("task"));
  });
  try {
    await expect(runResearchTaskAction("task", action)).rejects.toMatchObject({
      reason: "conflict",
    });
  } finally {
    unsubscribe();
  }
  expect(failureLocks).toEqual([true]);
  expect(action).not.toHaveBeenCalled();
  expect(data.saves).not.toHaveBeenCalled();
  expect(useResearchStore.getState().tasksById.task.error?.code).toBe(
    "RESEARCH_STORAGE_conflict",
  );
});

it("pauses an optimistic execution transition when saving fails before the continuation starts", async () => {
  const { ResearchPersistenceError } =
    await import("@/services/research/taskRepository/errors");
  const ready = task("plan_ready");
  hydrateLocal(ready);
  data.tasks.set("task", ready);
  data.saves.mockRejectedValueOnce(new ResearchPersistenceError("quota"));
  useResearchStore.getState().setActiveTask("task");
  const launch = vi.fn();
  await expect(
    runResearchTaskAction("task", async () => {
      await useResearchStore.getState().updateTask("task", (current) => ({
        ...current,
        status: "researching",
        checkpoint: undefined,
      }));
      return { run: launch };
    }),
  ).rejects.toMatchObject({ reason: "quota" });
  expect(launch).not.toHaveBeenCalled();
  expect(useResearchStore.getState().activeTaskId).toBeNull();
  expect(useResearchStore.getState().tasksById.task).toMatchObject({
    status: "paused",
    checkpoint: { resumeStatus: "researching" },
    error: { code: "RESEARCH_STORAGE_quota", recoverable: true },
  });
});

it("allows a local failed task to be cancelled while persistence recovery remains unavailable", async () => {
  const { ResearchPersistenceError } =
    await import("@/services/research/taskRepository/errors");
  const failed = task("failed");
  hydrateLocal(failed);
  data.tasks.set("task", failed);
  repository.recover.mockRejectedValue(new ResearchPersistenceError("quota"));
  data.saves.mockRejectedValue(new ResearchPersistenceError("quota"));
  const { result } = renderHook(() =>
    useResearchOperations({
      userInputController: { requestInput: vi.fn() },
      t: ((key: string) => key) as Parameters<
        typeof useResearchOperations
      >[0]["t"],
    }),
  );
  await act(() => result.current.cancelTask("task"));
  expect(repository.recover).not.toHaveBeenCalled();
  expect(useResearchStore.getState().tasksById.task.status).toBe("cancelled");
});

describe("fresh task ownership across tabs", () => {
  it("does not let an old paused tab overwrite a completed newer report on Resume", async () => {
    const latest = latestReport();
    data.tasks.set("task", latest);
    hydrateLocal(task("paused"));
    const deps = dependencies();
    const { result } = renderHook(() => useResearchTaskActions(deps));
    await act(() => result.current.resumeTask("task"));
    expect(data.saves).not.toHaveBeenCalled();
    expect(data.tasks.get("task")).toEqual(latest);
    expect(deps.launchResearch).not.toHaveBeenCalled();
    expect(
      useResearchStore.getState().tasksById.task.reportVersions[0].id,
    ).toBe("new-report");
  });
  it("does not let an old plan-ready tab overwrite a completed report on Confirm", async () => {
    const latest = latestReport();
    data.tasks.set("task", latest);
    hydrateLocal(task("plan_ready"));
    const deps = {
      ...dependencies(),
      dependencyText: {} as Parameters<
        typeof usePlanActions
      >[0]["dependencyText"],
      pauseTask: vi.fn(async () => {}),
      t: ((key: string) => key) as Parameters<typeof usePlanActions>[0]["t"],
    };
    const { result } = renderHook(() => usePlanActions(deps));
    await act(() => result.current.confirmPlan("task"));
    expect(data.saves).not.toHaveBeenCalled();
    expect(data.capture).not.toHaveBeenCalled();
    expect(deps.launchResearch).not.toHaveBeenCalled();
    expect(data.tasks.get("task")).toEqual(latest);
  });
  it("does not approve a new plan revision the stale tab has not displayed", async () => {
    const old = task("plan_ready");
    const latest = {
      ...old,
      activePlanVersion: 2,
      planVersions: [
        ...old.planVersions,
        { ...old.planVersions[0], id: "new-plan", version: 2 },
      ],
    };
    data.tasks.set("task", latest);
    hydrateLocal(old);
    const deps = {
      ...dependencies(),
      dependencyText: {} as Parameters<
        typeof usePlanActions
      >[0]["dependencyText"],
      pauseTask: vi.fn(async () => {}),
      t: ((key: string) => key) as Parameters<typeof usePlanActions>[0]["t"],
    };
    const { result } = renderHook(() => usePlanActions(deps));
    await act(() => result.current.confirmPlan("task"));
    expect(data.saves).not.toHaveBeenCalled();
    expect(deps.launchResearch).not.toHaveBeenCalled();
    expect(useResearchStore.getState().tasksById.task.activePlanVersion).toBe(
      2,
    );
  });

  it("performs no Resume write while a different tab owns execution", async () => {
    const latest = task("researching");
    latest.updatedAt = 30;
    data.tasks.set("task", latest);
    hydrateLocal(task("paused"));
    browserLocks.add("research-execution:task");
    const deps = dependencies();
    const { result } = renderHook(() => useResearchTaskActions(deps));
    await act(() => result.current.resumeTask("task"));
    expect(data.saves).not.toHaveBeenCalled();
    expect(deps.launchResearch).not.toHaveBeenCalled();
    expect(data.tasks.get("task")).toEqual(latest);
  });
  it("hands Resume the same lease and retains ownership after the UI action returns", async () => {
    const saved = task("paused");
    data.tasks.set("task", saved);
    hydrateLocal(saved);
    const finished = deferred();
    let lease: ResearchTaskExecutionLease | undefined;
    const launch = vi.fn(
      async (_id: string, owned?: ResearchTaskExecutionLease) => {
        lease = owned;
        await withResearchTaskExecutionLock(
          "task",
          async (inner) => {
            expect(inner).toBe(owned);
            expect(data.tasks.get("task")?.status).toBe("researching");
            await finished.promise;
          },
          owned,
        );
      },
    );
    const { result } = renderHook(() =>
      useResearchTaskActions(dependencies(launch)),
    );
    await act(() => result.current.resumeTask("task"));
    expect(launch).toHaveBeenCalledOnce();
    expect(isResearchTaskExecutionLease(lease, "task")).toBe(true);
    expect(lockRequest).toHaveBeenCalledOnce();
    const unrelated = vi.fn(async () => {});
    expect(await withResearchTaskExecutionLock("task", unrelated)).toEqual({
      acquired: false,
    });
    expect(unrelated).not.toHaveBeenCalled();
    finished.resolve();
    await waitFor(() =>
      expect(isResearchTaskLocallyLocked("task")).toBe(false),
    );
    expect(isResearchTaskExecutionLease(lease, "task")).toBe(false);
    await expect(
      withResearchTaskExecutionLock("task", unrelated, lease),
    ).rejects.toThrow(/no longer valid/);
  });
  it("holds Confirm's capture, state write and continuation in one browser lock", async () => {
    const saved = task("plan_ready");
    data.tasks.set("task", saved);
    hydrateLocal(saved);
    const finished = deferred();
    data.capture.mockImplementation(async () => {
      expect(browserLocks.has("research-execution:task")).toBe(true);
      return [];
    });
    const launch = vi.fn(
      async (_id: string, lease?: ResearchTaskExecutionLease) => {
        expect(isResearchTaskExecutionLease(lease, "task")).toBe(true);
        await finished.promise;
      },
    );
    const deps = {
      ...dependencies(launch),
      dependencyText: {} as Parameters<
        typeof usePlanActions
      >[0]["dependencyText"],
      pauseTask: vi.fn(async () => {}),
      t: ((key: string) => key) as Parameters<typeof usePlanActions>[0]["t"],
    };
    const { result } = renderHook(() => usePlanActions(deps));
    await act(() => result.current.confirmPlan("task"));
    expect(data.tasks.get("task")?.status).toBe("researching");
    expect(lockRequest).toHaveBeenCalledOnce();
    expect(isResearchTaskLocallyLocked("task")).toBe(true);
    finished.resolve();
    await waitFor(() =>
      expect(isResearchTaskLocallyLocked("task")).toBe(false),
    );
  });
  it.each([false, true])(
    "pauses plan confirmation despite workspace failure (save also fails: %s)",
    async (saveFails) => {
      if (saveFails)
        data.saves.mockRejectedValueOnce(new Error("storage failed"));
      const saved = task("plan_ready");
      data.tasks.set("task", saved);
      hydrateLocal(saved);
      data.capture.mockRejectedValue(
        new ResearchWorkspaceUnavailableError("OPFS unavailable"),
      );
      const deps = {
        ...dependencies(),
        dependencyText: {
          modelUnavailable: "Model unavailable",
          sourceUnavailable: (source: string) => `${source} unavailable`,
        } as Parameters<typeof usePlanActions>[0]["dependencyText"],
        pauseTask: vi.fn(async () => {}),
        t: ((key: string) => key) as Parameters<typeof usePlanActions>[0]["t"],
      };
      const { result } = renderHook(() => usePlanActions(deps));

      await act(() => result.current.confirmPlan("task"));

      expect(useResearchStore.getState().tasksById.task).toMatchObject({
        status: "paused",
        error: {
          code: "RESEARCH_WORKSPACE_UNAVAILABLE",
          message: "workspace unavailable",
          recoverable: true,
        },
      });
      expect(deps.launchResearch).not.toHaveBeenCalled();
      expect(deps.onNotice).toHaveBeenCalledWith("workspace unavailable");
    },
  );
  it("restores a legacy plan's model from the linked original generation", async () => {
    const saved = task("plan_ready");
    delete saved.sourceSnapshot!.model;
    data.tasks.set("task", saved);
    hydrateLocal(saved);
    data.resolveModel.mockResolvedValue("provider:original-request-model");
    const deps = {
      ...dependencies(),
      dependencyText: {
        modelUnavailable: "Model unavailable",
        sourceUnavailable: (source: string) => `${source} unavailable`,
      } as Parameters<typeof usePlanActions>[0]["dependencyText"],
      pauseTask: vi.fn(async () => {}),
      t: ((key: string) => key) as Parameters<typeof usePlanActions>[0]["t"],
    };
    const { result } = renderHook(() => usePlanActions(deps));

    await act(() => result.current.confirmPlan("task"));

    expect(data.resolveModel).toHaveBeenCalledWith(saved);
    expect(data.tasks.get("task")).toMatchObject({
      status: "researching",
      sourceSnapshot: { model: "provider:original-request-model" },
    });
    expect(deps.launchResearch).toHaveBeenCalledOnce();
  });
  it("loads another tab's active task without writing a recovery checkpoint", async () => {
    const active = task("researching");
    data.tasks.set("task", active);
    browserLocks.add("research-execution:task");
    await useResearchStore.getState().hydrateTasks();
    expect(data.saves).not.toHaveBeenCalled();
    expect(data.pruneFiles).not.toHaveBeenCalled();
    expect(data.deleteArtifact).not.toHaveBeenCalled();
    expect(data.tasks.get("task")).toEqual(active);
    expect(useResearchStore.getState().tasksById.task.status).toBe(
      "researching",
    );
  });
  it("re-reads under the recovery lock instead of saving a stale list result", async () => {
    const latest = latestReport();
    data.tasks.set("task", latest);
    data.list.mockReturnValue([task("researching")]);
    await useResearchStore.getState().loadSessionTasks("session");
    expect(data.saves).not.toHaveBeenCalled();
    expect(data.tasks.get("task")).toEqual(latest);
    expect(
      useResearchStore.getState().tasksById.task.reportVersions[0].id,
    ).toBe("new-report");
  });
  it("recovers an orphaned active task only when no executor owns it", async () => {
    data.tasks.set("task", task("researching"));
    await useResearchStore.getState().hydrateTasks();
    expect(data.tasks.get("task")?.status).toBe("paused");
    expect(data.saves).toHaveBeenCalledOnce();
    expect(lockRequest).toHaveBeenCalledOnce();
  });
  it("does not resurrect a local cancellation when an earlier persisted read finishes late", async () => {
    const active = task("researching");
    data.tasks.set("task", active);
    hydrateLocal(active);
    const readFinished = deferred();
    repository.get.mockImplementationOnce(async () => {
      await readFinished.promise;
      return structuredClone(active);
    });
    await withResearchTaskExecutionLock("task", async () => {
      const refresh = useResearchStore.getState().refreshTask("task");
      await useResearchStore
        .getState()
        .updateTask("task", (current) => ({ ...current, status: "cancelled" }));
      readFinished.resolve();
      expect((await refresh)?.status).toBe("cancelled");
      expect(useResearchStore.getState().tasksById.task.status).toBe(
        "cancelled",
      );
    });
    expect(data.tasks.get("task")?.status).toBe("cancelled");
  });

  it("waits for the outer local lease before cancel returns so immediate deletion succeeds", async () => {
    const active = task("researching");
    data.tasks.set("task", active);
    hydrateLocal(active);
    const nativeRelease = deferred();
    const callbackFinished = deferred();
    lockRequest.mockImplementationOnce(async (name, _options, callback) => {
      browserLocks.add(name);
      try {
        const value = await callback({ name });
        callbackFinished.resolve();
        await nativeRelease.promise;
        return value;
      } finally {
        browserLocks.delete(name);
      }
    });
    const { result } = renderHook(() =>
      useResearchOperations({
        userInputController: { requestInput: vi.fn() } as unknown as Parameters<
          typeof useResearchOperations
        >[0]["userInputController"],
        t: ((key: string) => key) as Parameters<
          typeof useResearchOperations
        >[0]["t"],
      }),
    );
    await act(() =>
      runResearchTaskAction("task", async () => ({
        background: true,
        run: () =>
          result.current.runOperation(
            "task",
            "research",
            (controller) =>
              new Promise<void>((resolve) =>
                controller.signal.addEventListener("abort", () => resolve(), {
                  once: true,
                }),
              ),
          ),
      })),
    );
    expect(isResearchTaskLocallyLocked("task")).toBe(true);
    await act(async () => {
      let cancelReturned = false;
      const stopping = result.current.cancelTask("task").then(() => {
        cancelReturned = true;
      });
      await callbackFinished.promise;
      expect(cancelReturned).toBe(false);
      expect(isResearchTaskLocallyLocked("task")).toBe(true);
      nativeRelease.resolve();
      await stopping;
      expect(isResearchTaskLocallyLocked("task")).toBe(false);
      await useResearchStore.getState().removeTask("task");
    });
    expect(repository.remove).toHaveBeenCalledWith("task");
    expect(data.tasks.has("task")).toBe(false);
    expect(useResearchStore.getState().tasksById.task).toBeUndefined();
  });

  it("does not delete an active other-tab task during session cleanup", async () => {
    const active = task("researching");
    data.tasks.set("task", active);
    hydrateLocal(active);
    browserLocks.add("research-execution:task");
    await useResearchStore.getState().clearSessionTasks("session");
    expect(repository.remove).not.toHaveBeenCalled();
    expect(data.tasks.get("task")).toEqual(active);
    expect(useResearchStore.getState().tasksById.task).toEqual(active);
  });
});

it("updates preset, strategy and profile-capped budgets under the same lease", async () => {
  const ready = task("plan_ready");
  data.tasks.set("task", ready);
  hydrateLocal(ready);
  const { result } = renderHook(() =>
    usePlanActions({
      ...dependencies(),
      pauseTask: vi.fn(async () => {}),
      dependencyText: {} as Parameters<
        typeof usePlanActions
      >[0]["dependencyText"],
      t: ((key: string) => key) as Parameters<typeof usePlanActions>[0]["t"],
    }),
  );
  await act(() => result.current.updatePlanPreset("task", "deep"));
  const changed = data.tasks.get("task")!;
  expect(changed.budgetPreset).toBe("deep");
  expect(changed.budget).toEqual({
    maxToolRounds: 20,
    maxToolCalls: 30,
    maxDurationMs: 600000,
  });
  expect(changed.activePlanVersion).toBe(2);
  expect(changed.planVersions[1].strategy).toEqual(changed.requestedStrategy);
  expect(changed.planVersions[0]).toEqual(ready.planVersions[0]);
});

it("rejects an edit lease conflict so the form retains its input", async () => {
  const ready = task("plan_ready");
  data.tasks.set("task", ready);
  hydrateLocal(ready);
  browserLocks.add("research-execution:task");
  const deps = {
    ...dependencies(),
    pauseTask: vi.fn(async () => {}),
    dependencyText: {} as Parameters<
      typeof usePlanActions
    >[0]["dependencyText"],
    t: ((key: string) => key) as Parameters<typeof usePlanActions>[0]["t"],
  };
  const { result } = renderHook(() => usePlanActions(deps));
  await expect(
    result.current.adjustPlan("task", "Keep this instruction"),
  ).rejects.toThrow("runtime.dependency.leaseConflict");
  expect(deps.preparePlan).not.toHaveBeenCalled();
  expect(data.tasks.get("task")).toEqual(ready);
});

it.each(["continue", "update"])(
  "passes the pre-planning snapshot and switches the correct session for %s",
  async (kind) => {
    const completed = latestReport();
    data.tasks.set("task", completed);
    hydrateLocal(completed);
    const mode = vi
      .spyOn(useChatStore.getState(), "setSessionChatMode")
      .mockImplementation(() => {});
    const deps = dependencies();
    const { result } = renderHook(() => useResearchTaskActions(deps));
    try {
      await act(() =>
        kind === "continue"
          ? result.current.continueResearch("task", "More detail")
          : result.current.updateLatest("task"),
      );
      expect(mode).toHaveBeenCalledWith("session", "research");
      expect(deps.preparePlan).toHaveBeenCalledWith(
        "task",
        expect.any(String),
        undefined,
        expect.anything(),
        completed,
      );
    } finally {
      mode.mockRestore();
    }
  },
);

it("restores a finished report when the initial refresh transition cannot persist", async () => {
  const { ResearchPersistenceError } =
    await import("@/services/research/taskRepository/errors");
  const completed = latestReport();
  data.tasks.set("task", completed);
  hydrateLocal(completed);
  data.saves.mockRejectedValueOnce(new ResearchPersistenceError("quota"));
  const deps = dependencies();
  const { result } = renderHook(() => useResearchTaskActions(deps));
  await expect(result.current.updateLatest("task")).rejects.toMatchObject({
    reason: "quota",
  });
  expect(deps.preparePlan).not.toHaveBeenCalled();
  expect(useResearchStore.getState().tasksById.task).toMatchObject({
    status: "completed",
    pendingReportKind: completed.pendingReportKind,
    evidence: completed.evidence,
    error: { code: "RESEARCH_STORAGE_quota" },
  });
});

it.each(["quota", "conflict"] as const)(
  "retains planning rollback storage diagnostics through the action wrapper for %s",
  async (reason) => {
    const { ResearchPersistenceError } =
      await import("@/services/research/taskRepository/errors");
    const ready = task("plan_ready");
    data.tasks.set("task", ready);
    hydrateLocal(ready);
    const failure = new ResearchPersistenceError(reason);
    await expect(
      runResearchTaskAction("task", async () => {
        useResearchStore.setState({
          tasksById: {
            task: {
              ...ready,
              error: {
                code: `RESEARCH_STORAGE_${reason}`,
                message: "Localized storage failure",
                recoverable: true,
              },
            },
          },
        });
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(useResearchStore.getState().tasksById.task).toMatchObject({
      status: "plan_ready",
      error: {
        code: `RESEARCH_STORAGE_${reason}`,
        message: "Localized storage failure",
      },
    });
    expect(data.saves).not.toHaveBeenCalled();
    expect(data.tasks.get("task")).toEqual(ready);
  },
);

describe("follow-up mode rollback", () => {
  beforeEach(() => {
    useChatStore.setState({
      sessions: ["session", "other"].map((id) => ({
        id,
        title: id,
        updatedAt: 1,
        model: "model",
        pinned: false,
        messageCount: 1,
        config: { chatMode: id === "session" ? "auto" : "agent" },
      })),
      currentSessionId: "session",
      chatConfig: {
        ...useChatStore.getState().chatConfig,
        chatMode: "auto",
        useAgentMode: false,
        useDeepResearch: false,
      },
    });
  });
  afterEach(() =>
    useChatStore.setState({ sessions: [], currentSessionId: null }),
  );

  it.each([
    ["continue", false],
    ["update", false],
    ["continue", true],
    ["update", true],
  ] as const)(
    "restores Auto after a failed %s with session switch %s",
    async (kind, switchSession) => {
      const completed = latestReport();
      data.tasks.set("task", completed);
      hydrateLocal(completed);
      const entered = deferred();
      const finish = deferred();
      const deps = dependencies();
      deps.preparePlan.mockImplementation(async () => {
        entered.resolve();
        await finish.promise;
        await useResearchStore.getState().updateTask("task", () => completed);
        throw new Error("Planning failed");
      });
      const { result } = renderHook(() => useResearchTaskActions(deps));
      const pending =
        kind === "continue"
          ? result.current.continueResearch("task", "More detail")
          : result.current.updateLatest("task");
      const rejected = expect(pending).rejects.toThrow("Planning failed");
      await entered.promise;
      expect(useChatStore.getState().chatConfig.chatMode).toBe("research");
      if (switchSession) {
        useChatStore.setState({
          currentSessionId: "other",
          chatConfig: {
            ...useChatStore.getState().chatConfig,
            chatMode: "agent",
            useAgentMode: true,
            useDeepResearch: false,
          },
        });
      }
      finish.resolve();
      await rejected;
      expect(
        useChatStore
          .getState()
          .sessions.find((session) => session.id === "session")!.config
          ?.chatMode,
      ).toBe("auto");
      expect(useChatStore.getState().chatConfig.chatMode).toBe(
        switchSession ? "agent" : "auto",
      );
      expect(useResearchStore.getState().tasksById.task.status).toBe(
        "completed",
      );
    },
  );

  it.each(["continue", "update"] as const)(
    "restores Auto after failed %s despite unrelated config changes",
    async (kind) => {
      const completed = latestReport();
      data.tasks.set("task", completed);
      hydrateLocal(completed);
      const deps = dependencies();
      deps.preparePlan.mockImplementation(async () => {
        useChatStore.getState().setChatConfig({ useSearch: true });
        useChatStore.getState().updateSessionConfig("session", {
          useSearch: true,
          approvalMode: "strict",
        });
        await useResearchStore.getState().updateTask("task", () => completed);
        throw new Error("Planning failed");
      });
      const { result } = renderHook(() => useResearchTaskActions(deps));
      await expect(
        kind === "continue"
          ? result.current.continueResearch("task", "More detail")
          : result.current.updateLatest("task"),
      ).rejects.toThrow("Planning failed");
      expect(useChatStore.getState().sessions[0].config).toMatchObject({
        chatMode: "auto",
        useSearch: true,
        approvalMode: "strict",
      });
      expect(useChatStore.getState().chatConfig).toMatchObject({
        chatMode: "auto",
        useSearch: true,
      });
    },
  );

  it.each([
    ["agent", "session"],
    ["research", "session"],
    ["agent", "composer"],
    ["research", "composer"],
    ["agent", "config"],
    ["research", "config"],
  ] as const)(
    "preserves the user's later %s selection via %s when planning fails",
    async (selected, path) => {
      const completed = latestReport();
      data.tasks.set("task", completed);
      hydrateLocal(completed);
      const deps = dependencies();
      deps.preparePlan.mockImplementation(async () => {
        for (const mode of ["agent", selected] as const) {
          if (path === "session")
            useChatStore.getState().setSessionChatMode("session", mode);
          else {
            const patch = {
              chatMode: mode,
              useAgentMode: mode === "agent",
              useDeepResearch: mode === "research",
            };
            if (path === "composer")
              useChatStore.getState().setChatConfig(patch);
            useChatStore.getState().updateSessionConfig("session", patch);
          }
        }
        throw new Error("Planning failed");
      });
      const { result } = renderHook(() => useResearchTaskActions(deps));
      await expect(result.current.updateLatest("task")).rejects.toThrow(
        "Planning failed",
      );
      expect(useChatStore.getState().sessions[0].config?.chatMode).toBe(
        selected,
      );
      if (path !== "config")
        expect(useChatStore.getState().chatConfig.chatMode).toBe(selected);
    },
  );

  it("does not change mode when another tab owns the follow-up lease", async () => {
    const completed = latestReport();
    data.tasks.set("task", completed);
    hydrateLocal(completed);
    browserLocks.add("research-execution:task");
    const deps = dependencies();
    const { result } = renderHook(() => useResearchTaskActions(deps));
    await expect(result.current.updateLatest("task")).rejects.toThrow();
    expect(useChatStore.getState().chatConfig.chatMode).toBe("auto");
    expect(deps.preparePlan).not.toHaveBeenCalled();
  });

  it("restores mode without reviving a cancelled follow-up", async () => {
    const completed = latestReport();
    data.tasks.set("task", completed);
    hydrateLocal(completed);
    const deps = dependencies();
    deps.preparePlan.mockImplementation(async () => {
      await useResearchStore
        .getState()
        .updateTask("task", (current) => ({ ...current, status: "cancelled" }));
      throw new DOMException("Aborted", "AbortError");
    });
    const { result } = renderHook(() => useResearchTaskActions(deps));
    await expect(result.current.updateLatest("task")).rejects.toThrow(
      "Aborted",
    );
    expect(useResearchStore.getState().tasksById.task.status).toBe("cancelled");
    expect(useChatStore.getState().chatConfig.chatMode).toBe("auto");
  });

  it("restores the current session's mode when planning fails before startup saves", async () => {
    const { ResearchPersistenceError } =
      await import("@/services/research/taskRepository/errors");
    const completed = latestReport();
    data.tasks.set("task", completed);
    hydrateLocal(completed);
    data.saves.mockRejectedValueOnce(new ResearchPersistenceError("conflict"));
    const { result } = renderHook(() => useResearchTaskActions(dependencies()));
    await expect(result.current.updateLatest("task")).rejects.toMatchObject({
      reason: "conflict",
    });
    expect(useChatStore.getState().chatConfig.chatMode).toBe("auto");
    expect(useChatStore.getState().sessions[0].config?.chatMode).toBe("auto");
    expect(data.saves).toHaveBeenCalledOnce();
    expect(data.tasks.get("task")).toEqual(completed);
  });
});
