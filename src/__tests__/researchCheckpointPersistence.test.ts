import { beforeEach, expect, it, vi } from "vitest";
import type { ResearchWaveContext } from "@/lib/research/runtime/wave/waveContext";
import { ResearchPersistenceError } from "@/services/research/taskRepository/errors";
const mocks = vi.hoisted(() => ({
  write: vi.fn(async () => ({ ok: true })),
  save: vi.fn(),
  collect: vi.fn(),
  stream: vi.fn<(...args: unknown[]) => Promise<string>>(
    async () => "Evidence",
  ),
}));
vi.mock("@/services/workspace/sessionWorkspace", () => ({
  writeWorkspaceText: mocks.write,
}));
vi.mock("@/store/core/agentRunStore", () => ({
  useAgentRunStore: { getState: () => ({ runsById: {} }) },
}));
vi.mock("@/services/api/chatService", () => ({
  streamChatResponse: mocks.stream,
}));
vi.mock("@/lib/plugin/researchSources/contracts", () => ({
  getFrozenResearchSourceContracts: async () => [],
}));
vi.mock("@/lib/research/runtime/evidenceCollection", () => ({
  collectTaskEvidence: mocks.collect,
}));
import { persistWaveCheckpoint } from "@/lib/research/runtime/wave/waveCheckpoint";
import { runWaveStream } from "@/lib/research/runtime/wave/runWaveStream";

function wave(): ResearchWaveContext {
  return {
    ctx: {
      taskId: "task",
      task: { id: "task", sessionId: "session" },
      controller: new AbortController(),
      store: { updateTask: mocks.save },
      evidence: [],
      snapshot: {},
      sourceContext: {
        frozenAttachments: [],
        approvedKnowledgeAttachments: [],
      },
      settings: {},
      effective: {},
      chatConfig: {},
    },
    waveId: "wave",
    activeRun: { id: "run", waves: [], frontierNodeIds: [] },
    wavePrompt: "Research",
    latestContent: "",
    latestToolCalls: [],
    imageSources: [],
    checkpointPath: "checkpoint.json",
    checkpointQueue: Promise.resolve(),
    availableBudget: { maxToolRounds: 5 },
  } as unknown as ResearchWaveContext;
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.save.mockReset();
});
it("rejects checkpoint flush when workspace succeeds but the core task save fails", async () => {
  const failure = new ResearchPersistenceError("quota");
  mocks.save.mockRejectedValueOnce(failure);
  const current = wave();
  await expect(persistWaveCheckpoint(current)).rejects.toBe(failure);
  await expect(runWaveStream(current)).rejects.toBe(failure);
  expect(mocks.write).toHaveBeenCalledOnce();
  expect(mocks.collect).not.toHaveBeenCalled();
});
it("keeps the wave failed after an unsuccessful checkpoint instead of hiding it with a later write", async () => {
  const failure = new ResearchPersistenceError("quota");
  mocks.save.mockRejectedValueOnce(failure).mockResolvedValueOnce(undefined);
  const current = wave();
  await expect(persistWaveCheckpoint(current)).rejects.toBe(failure);
  await expect(persistWaveCheckpoint(current)).rejects.toBe(failure);
  expect(mocks.save).toHaveBeenCalledOnce();
  expect(mocks.stream).not.toHaveBeenCalled();
});

it("aborts an active multi-round stream on checkpoint failure and preserves its storage cause", async () => {
  const failure = new ResearchPersistenceError("quota");
  mocks.save.mockRejectedValueOnce(failure);
  const nextRound = vi.fn();
  const current = wave();
  let executionSignal: AbortSignal | undefined;
  mocks.stream.mockImplementationOnce(async (...args) => {
    executionSignal = args[12] as AbortSignal;
    const toolUpdate = args[9] as (calls: unknown[]) => void;
    toolUpdate([]);
    await new Promise<void>((resolve) =>
      executionSignal!.addEventListener("abort", () => resolve(), {
        once: true,
      }),
    );
    if (executionSignal!.aborted)
      throw new DOMException("Stream aborted", "AbortError");
    nextRound();
    return "Unexpected";
  });
  await expect(runWaveStream(current)).rejects.toBe(failure);
  expect(executionSignal?.aborted).toBe(true);
  expect(current.ctx.controller.signal.aborted).toBe(false);
  expect(nextRound).not.toHaveBeenCalled();
  expect(mocks.collect).not.toHaveBeenCalled();
});

it.each(["tool", "source", "knowledge", "resume"])(
  "does not retry a disconnected wave after %s activity",
  async (activity) => {
    const current = wave();
    if (activity === "resume") Object.assign(current, { resumeThisWave: true });
    const error = new TypeError("Failed to fetch");
    mocks.stream.mockImplementationOnce(async (...args) => {
      if (activity === "tool") (args[9] as (calls: unknown[]) => void)([]);
      if (activity === "source")
        (args[8] as (searching: boolean) => void)(true);
      if (activity === "knowledge")
        (
          args[17] as { onKnowledgeSources: (sources: unknown[]) => void }
        ).onKnowledgeSources([]);
      throw error;
    });
    await expect(runWaveStream(current)).rejects.toBe(error);
    await current.checkpointQueue;
    expect(mocks.stream).toHaveBeenCalledOnce();
  },
);

it("retries a fresh wave only before source or tool work", async () => {
  vi.useFakeTimers();
  try {
    const error = new TypeError("Failed to fetch");
    mocks.stream.mockRejectedValue(error);
    const result = expect(runWaveStream(wave())).rejects.toBe(error);
    await vi.runAllTimersAsync();
    await result;
    expect(mocks.stream).toHaveBeenCalledTimes(3);
  } finally {
    vi.useRealTimers();
  }
});
