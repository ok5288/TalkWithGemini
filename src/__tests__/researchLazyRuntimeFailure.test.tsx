// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ResearchTask } from "@/lib/research/types";
import type { ResearchTranslate } from "@/lib/research/runtime/executionContext";
import type { RunResearchOperation } from "@/lib/research/runtime/operations";

const state = vi.hoisted(() => ({
  task: null as ResearchTask | null,
  activeTaskId: null as string | null,
  writes: [] as boolean[],
}));
vi.mock("@/lib/research/runtime/preparePlan", () => {
  throw new Error("chunk download failed");
});
vi.mock("@/lib/research/runtime/executeResearch", () => {
  throw new Error("chunk download failed");
});
vi.mock("@/store/core/researchStore", () => ({
  useResearchStore: {
    getState: () => ({
      activeTaskId: state.activeTaskId,
      refreshTask: async () => state.task,
      updateTask: async (
        id: string,
        update: (task: ResearchTask) => ResearchTask,
      ) => {
        state.writes.push(isResearchTaskLocallyLocked(id));
        state.task = update(state.task!);
      },
      setActiveTask: (id: string | null) => {
        state.activeTaskId = id;
      },
    }),
  },
}));

import { createResearchTask } from "@/lib/research/task";
import {
  isResearchTaskLocallyLocked,
  withResearchTaskExecutionLock,
} from "@/services/research/taskExecutionLock";
import { usePreparePlan } from "@/hooks/research/usePreparePlan";
import { useResearchExecution } from "@/hooks/research/useResearchExecution";

const t = ((key: string) => key) as ResearchTranslate;
const localizedRuntimeError = (_error: unknown, fallback: string) => fallback;
const onError = vi.fn();
let controller: AbortController;
const runOperation: RunResearchOperation = async (_taskId, _kind, operation) =>
  operation(controller);
const dependencies = {
  runOperation,
  operationsRef: { current: new Map() },
  userInputController: { requestInput: vi.fn() },
  t,
  localizedRuntimeError,
  dependencyText: {
    offline: "offline",
    modelUnavailable: "model",
    toolCallingUnavailable: "tools",
    searchUnavailable: "search",
    searchDisabled: "disabled",
    checkpointUnavailable: "checkpoint",
    sourceUnavailable: (source: string) => source,
  },
  onError,
};

beforeEach(() => {
  state.task = {
    ...createResearchTask({
      id: "task",
      sessionId: "session",
      goal: "Research",
    }),
    status: "researching",
  };
  state.activeTaskId = "task";
  state.writes = [];
  controller = new AbortController();
  onError.mockClear();
});
afterEach(cleanup);

describe("Research chunk load failures", () => {
  it("fails planning recoverably before releasing its execution lease", async () => {
    state.task!.status = "draft";
    const { result } = renderHook(() => usePreparePlan(dependencies));
    await act(async () => result.current("task"));
    expect(state.task).toMatchObject({
      status: "failed",
      error: { code: "RESEARCH_MODEL_UNAVAILABLE", recoverable: true },
    });
    expect(state.writes).toEqual([true]);
    expect(state.activeTaskId).toBeNull();
    expect(onError).toHaveBeenCalledWith("runtime.error.plan");
    expect(isResearchTaskLocallyLocked("task")).toBe(false);
  });

  it("records execution load failure under the caller's still-held lease", async () => {
    const { result } = renderHook(() => useResearchExecution(dependencies));
    await act(async () => {
      await withResearchTaskExecutionLock("task", async (lease) => {
        await result.current.launchResearch("task", lease);
        expect(isResearchTaskLocallyLocked("task")).toBe(true);
      });
    });
    expect(state.task).toMatchObject({
      status: "failed",
      error: { code: "RESEARCH_MODEL_UNAVAILABLE", recoverable: true },
    });
    expect(state.writes).toEqual([true]);
    expect(state.activeTaskId).toBeNull();
    expect(onError).toHaveBeenCalledWith("runtime.error.report");
  });

  it("does not replace cancellation with a load failure or display an error", async () => {
    state.task!.status = "paused";
    controller.abort();
    const { result } = renderHook(() => useResearchExecution(dependencies));
    await act(async () => result.current.launchResearch("task"));
    expect(state.task!.status).toBe("paused");
    expect(state.writes).toEqual([]);
    expect(onError).not.toHaveBeenCalled();
  });
});

it("restores a completed plan when the follow-up planning module fails to load", async () => {
  const previous: ResearchTask = {
    ...state.task!,
    status: "completed",
    endedAt: 42,
    planVersions: [
      { id: "old-plan", version: 1 } as ResearchTask["planVersions"][number],
    ],
    activePlanVersion: 1,
  };
  state.task = {
    ...previous,
    status: "clarifying",
    pendingReportKind: "update",
    endedAt: undefined,
  };
  const { result } = renderHook(() => usePreparePlan(dependencies));
  await expect(
    result.current("task", "refresh", undefined, undefined, previous),
  ).rejects.toThrow("runtime.error.adjustFailed");
  expect(state.task).toMatchObject({
    status: "completed",
    endedAt: 42,
    pendingReportKind: "initial",
    activePlanVersion: 1,
  });
  expect(state.task!.planVersions).toEqual(previous.planVersions);
  expect(state.writes).toEqual([true]);
  expect(isResearchTaskLocallyLocked("task")).toBe(false);
});
