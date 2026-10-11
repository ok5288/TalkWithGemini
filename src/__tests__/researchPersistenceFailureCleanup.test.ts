import { beforeEach, expect, it, vi } from "vitest";
import type {
  ResearchTask,
  ResearchPlanVersion,
  ResearchSourceSnapshot,
} from "@/lib/research";
import { ResearchPersistenceError } from "@/services/research/taskRepository/errors";
const mocks = vi.hoisted(() => ({
  task: null as ResearchTask | null,
  save: vi.fn(),
  model: vi.fn(),
  messages: vi.fn(),
}));
vi.mock("@/services/research", () => ({
  getResearchTaskRepository: () => ({
    get: async () => mocks.task,
    getStatus: () => ({ durable: true }),
    save: mocks.save,
  }),
}));
vi.mock("@/lib/research/runtime/sourceSnapshot", () => ({
  resolveResearchTaskModel: mocks.model,
  getInvalidFrozenWorkspaceSource: async () => undefined,
  loadSessionMessages: mocks.messages,
}));
vi.mock("@/lib/research/runtime/taskContext", () => ({
  getResearchDependencyError: () => undefined,
  resolveTaskContext: () => ({ chatConfig: {}, effective: {}, settings: {} }),
}));
import { createResearchTask } from "@/lib/research/task";
import { useResearchStore } from "@/store/core/researchStore";
import { executeResearchRun } from "@/lib/research/runtime/executeResearch";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.model.mockReset().mockResolvedValue(null);
  mocks.messages.mockReset();
  mocks.save.mockRejectedValue(new ResearchPersistenceError("quota"));
  mocks.task = {
    ...createResearchTask({
      id: "task",
      sessionId: "session",
      goal: "Research",
      now: 100,
    }),
    status: "researching",
    activePlanVersion: 1,
    planVersions: [{ version: 1 } as ResearchPlanVersion],
    sourceSnapshot: { model: "provider:model" } as ResearchSourceSnapshot,
  };
  useResearchStore.setState({
    tasksById: { task: mocks.task },
    activeTaskId: "task",
  });
});
function run() {
  const onNotice = vi.fn();
  const onError = vi.fn();
  const promise = executeResearchRun({
    taskId: "task",
    controller: new AbortController(),
    operationsRef: { current: new Map() },
    userInputController: { requestInput: vi.fn() },
    t: ((key: string) => key) as Parameters<typeof executeResearchRun>[0]["t"],
    localizedRuntimeError: () => "Storage unavailable",
    dependencyText: {
      modelUnavailable: "Model unavailable",
      sourceUnavailable: () => "Source unavailable",
      offline: "Offline",
      toolCallingUnavailable: "Tools unavailable",
      searchUnavailable: "Search unavailable",
      searchDisabled: "Search disabled",
      checkpointUnavailable: "Checkpoint unavailable",
    },
    onNotice,
    onError,
  });
  return { promise, onNotice, onError };
}
it("still pauses and releases the active task when saving a missing-model failure also fails", async () => {
  const { promise, onNotice } = run();
  await expect(promise).resolves.toBeUndefined();
  expect(useResearchStore.getState().activeTaskId).toBeNull();
  expect(useResearchStore.getState().tasksById.task).toMatchObject({
    status: "paused",
    error: { code: "RESEARCH_MODEL_UNAVAILABLE" },
  });
  expect(onNotice).toHaveBeenCalledWith("Model unavailable");
});
it("records pre-context failure and calls onError even when the failure-state save rejects", async () => {
  mocks.model.mockResolvedValue("provider:model");
  mocks.messages.mockRejectedValue(new ResearchPersistenceError("quota"));
  const { promise, onError } = run();
  await expect(promise).resolves.toBeUndefined();
  expect(useResearchStore.getState().activeTaskId).toBeNull();
  expect(useResearchStore.getState().tasksById.task).toMatchObject({
    status: "failed",
    error: { message: "Storage unavailable" },
  });
  expect(onError).toHaveBeenCalledOnce();
});
