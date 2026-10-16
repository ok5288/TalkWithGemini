import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AgentRun } from "@/lib/agent";
import type { ToolCall } from "@/types";
import {
  createResearchTask,
  createResearchReportRun,
  createNextResearchWave,
  getResearchQueriesFromToolCalls,
  isCommittedCheckpointToolCall,
  type ResearchPlanVersion,
  type ResearchTask,
} from "@/lib/research";
import type { ResearchExecutionContext } from "@/lib/research/runtime/executionContext";
import { ResearchPersistenceError } from "@/services/research/taskRepository/errors";

const mocks = vi.hoisted(() => ({
  runs: {} as Record<string, AgentRun>,
  files: new Map<string, string>(),
  stream: vi.fn(),
  write: vi.fn(),
  provider: vi.fn(),
}));
vi.mock("@/services/api/searchService", () => ({
  createSearchProvider: mocks.provider,
}));
vi.mock("@/store/core/agentRunStore", () => ({
  useAgentRunStore: { getState: () => ({ runsById: mocks.runs }) },
}));
vi.mock("@/services/api/chatService", () => ({
  streamChatResponse: mocks.stream,
}));
vi.mock("@/services/workspace/sessionWorkspace", () => ({
  writeWorkspaceText: mocks.write,
  deleteWorkspaceFile: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/lib/research/runtime/readLocalResearchJson", () => ({
  readResearchCheckpointJson: async (_session: string, path: string) => ({
    ok: true,
    value: JSON.parse(mocks.files.get(path)!),
  }),
}));
vi.mock("@/lib/plugin/researchSources/contracts", () => ({
  assertFrozenResearchSourceContracts: async () => {},
  getFrozenResearchSourceContracts: async () => [],
}));
vi.mock("@/lib/research/runtime/sourceSnapshot", () => ({
  getInvalidFrozenWorkspaceSource: async () => undefined,
}));
vi.mock("@/lib/research", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  buildResearchWavePrompt: () => "Research",
}));
vi.mock("@/lib/research/runtime/reportDelivery", () => ({
  deliverResearchReport: vi.fn(),
  ResearchReportDeliveryError: class extends Error {},
}));

vi.mock("@/lib/research/runtime/evidenceCollection", () => ({
  collectTaskEvidence: async () => ({
    evidence: [],
    newEvidenceIds: [],
    touchedEvidenceIds: [],
    searchOnlyCount: 0,
  }),
}));
vi.mock("@/lib/utils/model", () => ({
  parseModelString: () => ({ providerId: "provider", modelName: "model" }),
  resolveProviderModelMetadata: () => ({}),
  supportsStructuredOutput: () => false,
}));
import { executeWave } from "@/lib/research/runtime/wave";
import { runExplorationStage } from "@/lib/research/runtime/stages/exploration";
import { runVerificationStage } from "@/lib/research/runtime/stages/verification";
import { prepareWave } from "@/lib/research/runtime/wave/prepareWave";
import { handleExecutionFailure } from "@/lib/research/runtime/stages/failure";

function fixture() {
  const plan = {
    version: 1,
    steps: [],
    scope: {},
    strategy: {
      initialBreadth: 2,
      maxDepth: 2,
      maxQueries: 16,
      resultsPerQuery: 5,
    },
  } as unknown as ResearchPlanVersion;
  const task = {
    ...createResearchTask({
      id: "task",
      sessionId: "session",
      goal: "Research",
    }),
    status: "researching",
  } as ResearchTask;
  const run = createResearchReportRun({ id: "run", taskId: task.id, plan });
  const tasksById = { task };
  const ctx = {
    taskId: task.id,
    task,
    plan,
    run,
    evidence: [],
    imageSources: [],
    controller: new AbortController(),
    snapshot: {
      toolIds: [],
      knowledgeCollectionIds: [],
      attachmentIds: [],
      workspaceFileIds: [],
      pluginIds: [],
    },
    sourceContext: { frozenAttachments: [], approvedKnowledgeAttachments: [] },
    settings: {},
    effective: {},
    chatConfig: {},
    explorationToolCallCap: 20,
    sourceBodyLimit: 10,
    store: {
      tasksById,
      updateTask: async (
        _id: string,
        update: (value: ResearchTask) => ResearchTask,
      ) => {
        tasksById.task = update(tasksById.task);
        return tasksById.task;
      },
      setActiveTask: vi.fn(),
    },
    t: (key: string) => key,
    dependencyText: { checkpointUnavailable: "Checkpoint unavailable" },
    localizedRuntimeError: () => "storage failed",
  } as unknown as ResearchExecutionContext;
  const input = {
    run,
    waveId: "wave",
    nodeIds: [],
    phase: "exploring" as const,
    queryAllowance: 4,
    expandFrontier: false,
  };
  return { ctx, input, tasksById };
}
function recordTestQueries(args: unknown[], calls: ToolCall[]) {
  const options = args[17] as {
    researchQueryBudget: import("@/services/api/chat/builtinTools").BuiltinResearchQueryBudget;
  };
  options.researchQueryBudget.onQueriesExecuted?.(
    getResearchQueriesFromToolCalls(
      calls.filter(isCommittedCheckpointToolCall),
    ),
  );
}

const call: ToolCall = {
  id: "search",
  name: "search_web",
  args: { queries: ["ocean evidence"] },
  status: "success",
  result: { results: [] },
};

beforeEach(() => {
  vi.stubGlobal("navigator", { onLine: true });
  mocks.runs = {};
  mocks.files.clear();
  mocks.stream.mockReset();
  mocks.provider.mockReset();
  mocks.write
    .mockReset()
    .mockImplementation(
      async (_session: string, path: string, body: string) => {
        mocks.files.set(path, body);
        return { ok: true };
      },
    );
});
afterEach(() => vi.unstubAllGlobals());

it.each([
  new TypeError("Failed to fetch"),
  new Error("Response timeout"),
  Object.assign(new Error("Service unavailable"), { statusCode: 503 }),
  new DOMException("Paused", "AbortError"),
])(
  "preserves committed calls and query budget across online interruption: %s",
  async (error) => {
    const { ctx, input, tasksById } = fixture();
    mocks.stream.mockImplementationOnce(async (...args: unknown[]) => {
      const options = args[17] as { agentRun: { id: string } };
      // chatService's research execution contract is tested separately against its real transport.
      mocks.runs[options.agentRun.id] = {
        id: options.agentRun.id,
        status: "interrupted",
        usage: { toolRounds: 1, toolCalls: 1, wallTimeMs: 1, totalTokens: 10 },
        toolExecutions: [{ id: "execution", status: "committed" }],
      } as AgentRun;
      recordTestQueries(args, [call]);
      (args[9] as (calls: ToolCall[]) => void)([call]);
      throw error;
    });
    await expect(executeWave(ctx, input)).rejects.toBe(error);
    await handleExecutionFailure(ctx, error);
    expect(tasksById.task.status).toBe("paused");
    if (error.name !== "AbortError")
      expect(tasksById.task.error?.code).toBe("RESEARCH_CONNECTION_LOST");
    expect(tasksById.task.checkpoint?.historyPath).toBeTruthy();
    expect(tasksById.task.checkpoint?.committedToolExecutionIds).toEqual([
      "execution",
    ]);
    const resumed = await prepareWave(ctx, { ...input, run: ctx.run });
    expect(resumed?.resumeThisWave).toBe(true);
    expect(resumed?.agentRunId).toBe(ctx.lastAgentRunId);
    expect(tasksById.task.executionRunIds).toHaveLength(1);
    expect(resumed?.resumeHistory[1].toolCalls).toEqual([call]);
    expect(resumed?.executedQueries).toEqual(["ocean evidence"]);
    expect(resumed?.queryBudget.seenQueries?.has("ocean evidence")).toBe(true);
    expect(resumed?.queryBudget.remainingQueries).toBe(3);
    expect(mocks.stream).toHaveBeenCalledOnce();
  },
);

it("prioritizes failed final checkpoint persistence over a transport error", async () => {
  const { ctx, input, tasksById } = fixture();
  const storageError = new ResearchPersistenceError("quota");
  mocks.stream.mockImplementationOnce(async (...args: unknown[]) => {
    (args[8] as (searching: boolean) => void)(true);
    throw new TypeError("Failed to fetch");
  });
  mocks.write.mockRejectedValueOnce(storageError);
  await expect(executeWave(ctx, input)).rejects.toBe(storageError);
  await handleExecutionFailure(ctx, storageError);
  expect(tasksById.task.status).toBe("failed");
  expect(tasksById.task.error?.code).not.toBe("RESEARCH_CONNECTION_LOST");
});

it("retains receipts, cached results and identity through two interruptions", async () => {
  const { ctx, input } = fixture();
  const error = new TypeError("Failed to fetch");
  const cached = {
    ...call,
    executionRecordId: "execution-A",
    result: {
      ...call.result,
      tool_cache: { argsHash: "args-A", resultHash: "result-A" },
      reference: { path: "research/results/A.json", hash: "hash-A" },
    },
  };
  const charged: ToolCall = {
    ...call,
    id: "400",
    args: { queries: ["charged query"] },
    status: "error",
    isError: true,
    result: { refundedQueries: [] },
  };
  const success = {
    ...call,
    id: "second",
    args: { queries: ["second query"] },
  };
  const refunded: ToolCall = {
    ...charged,
    id: "429",
    args: { queries: ["refunded query"] },
    result: { refundedQueries: ["refunded query"] },
  };
  for (const next of [
    [cached, charged],
    [
      { ...cached, status: "running" as const, result: undefined },
      success,
      refunded,
    ],
  ]) {
    mocks.stream.mockImplementationOnce(async (...args: unknown[]) => {
      const options = args[17] as { agentRun: { id: string } };
      mocks.runs[options.agentRun.id] = {
        id: options.agentRun.id,
        status: "interrupted",
        usage: { toolRounds: 1, toolCalls: 1, wallTimeMs: 1, totalTokens: 10 },
        toolExecutions: [],
      } as unknown as AgentRun;
      recordTestQueries(args, next);
      (args[9] as (calls: ToolCall[]) => void)(next);
      throw error;
    });
    await expect(executeWave(ctx, { ...input, run: ctx.run })).rejects.toBe(
      error,
    );
    await handleExecutionFailure(ctx, error);
  }
  const resumed = await prepareWave(ctx, { ...input, run: ctx.run });
  expect(resumed?.latestToolCalls).toEqual([
    cached,
    charged,
    success,
    refunded,
  ]);
  expect(resumed?.executedQueries).toEqual([
    "ocean evidence",
    "charged query",
    "second query",
  ]);
  expect(resumed?.queryBudget.remainingQueries).toBe(1);
});

it("does not disguise a failed final flush as user pause", async () => {
  const { ctx, tasksById } = fixture();
  ctx.controller.abort();
  await handleExecutionFailure(ctx, new ResearchPersistenceError("quota"));
  expect(tasksById.task.status).toBe("failed");
});

it.each([
  "missing",
  "json",
  "version",
  "taskId",
  "researchRunId",
  "agentRunId",
  "waveId",
])("rejects %s checkpoints before dispatch", async (fault) => {
  const { ctx, input, tasksById } = fixture();
  mocks.stream.mockImplementationOnce(async (...args: unknown[]) => {
    const options = args[17] as { agentRun: { id: string } };
    mocks.runs[options.agentRun.id] = {
      id: options.agentRun.id,
      status: "interrupted",
      usage: { toolRounds: 1, toolCalls: 1, wallTimeMs: 1, totalTokens: 10 },
      toolExecutions: [],
    } as unknown as AgentRun;
    (args[9] as (calls: ToolCall[]) => void)([call]);
    throw new TypeError("Failed to fetch");
  });
  await expect(executeWave(ctx, input)).rejects.toThrow("Failed to fetch");
  const path = tasksById.task.checkpoint!.historyPath!;
  if (fault === "missing") mocks.files.delete(path);
  else if (fault === "json") mocks.files.set(path, "{");
  else {
    const saved = JSON.parse(mocks.files.get(path)!);
    saved[fault] = fault === "version" ? 99 : "wrong";
    mocks.files.set(path, JSON.stringify(saved));
  }
  const error = await executeWave(ctx, { ...input, run: ctx.run }).catch(
    (error: unknown) => error,
  );
  expect(error).toMatchObject({ code: "RESEARCH_CHECKPOINT_UNAVAILABLE" });
  await handleExecutionFailure(ctx, error);
  expect(tasksById.task.error?.code).toBe("RESEARCH_CHECKPOINT_UNAVAILABLE");
  expect(tasksById.task.status).toBe("paused");
  expect(mocks.stream).toHaveBeenCalledOnce();
});

it.each([
  "archive",
  "repair",
  "pause",
  "exploration-exhausted",
  "verification-exhausted",
])(
  "resumes %s interruption by archiving without repeating tools or charges",
  async (stage) => {
    const { ctx, input, tasksById } = fixture();
    Object.assign(ctx, {
      plan: {
        ...ctx.plan,
        scope: {
          audience: "Readers",
          includes: [],
          excludes: [],
          allowedSourceTypes: ["web"],
        },
        steps: [
          {
            id: "step",
            title: "Study",
            objective: "Study",
            questions: ["Question"],
            queryTopics: ["Topic"],
            sourcePriorities: [],
            evidenceCriteria: [],
            priority: "high",
          },
        ],
      },
    });
    const next = createNextResearchWave(
      createResearchReportRun({ id: "run", taskId: "task", plan: ctx.plan }),
    )!;
    ctx.run = next.run;
    const nextInput = {
      ...input,
      run: next.run,
      waveId: next.wave.id,
      nodeIds: next.wave.nodeIds,
    };
    let externalCalls = 0;
    let archiveCalls = 0;
    mocks.stream.mockImplementation(async (...args: unknown[]) => {
      const options = args[17] as {
        disableTools?: boolean;
        agentRun: { id: string };
        researchQueryBudget: { onQueriesExecuted: (queries: string[]) => void };
      };
      if (!options.disableTools) {
        externalCalls++;
        mocks.runs[options.agentRun.id] = {
          id: options.agentRun.id,
          sessionId: "session",
          status: "completed",
          usage: {
            toolRounds: 1,
            toolCalls: 1,
            wallTimeMs: 1,
            totalTokens: 10,
          },
          toolExecutions: [],
        } as unknown as AgentRun;
        options.researchQueryBudget.onQueriesExecuted(["ocean evidence"]);
        (args[9] as (calls: ToolCall[]) => void)([call]);
        return "Factual handoff";
      }
      archiveCalls++;
      (args[6] as (text: string) => void)("partial");
      if (stage === "repair" && archiveCalls === 1) return "invalid";
      if (stage === "pause") ctx.controller.abort();
      throw stage === "pause"
        ? new DOMException("Paused", "AbortError")
        : new TypeError("Failed to fetch");
    });
    const failure = await executeWave(ctx, nextInput).catch(
      (error: unknown) => error,
    );
    await handleExecutionFailure(ctx, failure);
    expect(archiveCalls).toBe(stage === "repair" ? 2 : 1);
    expect(tasksById.task.checkpoint?.historyPath).toBeTruthy();
    expect(ctx.run.usage.queryCount).toBe(0);
    Object.assign(ctx, { controller: new AbortController() });
    mocks.stream.mockImplementation(async (...args: unknown[]) => {
      expect(args[17]).toMatchObject({ disableTools: true });
      return JSON.stringify({
        packets: [
          {
            nodeKey: "N1",
            learnings: [],
            sourceAssessments: [],
            followUps: [],
          },
        ],
      });
    });
    let completed;
    if (stage.endsWith("exhausted")) {
      tasksById.task.budget.maxToolCalls = 1;
      Object.assign(ctx, { explorationQueryLimit: 12 });
      if (stage === "exploration-exhausted") await runExplorationStage(ctx);
      else await runVerificationStage(ctx);
      completed = ctx.run;
    } else completed = await executeWave(ctx, { ...nextInput, run: ctx.run });
    expect(externalCalls).toBe(1);
    expect(completed.usage.queryCount).toBe(1);
    expect(completed.executedQueries).toEqual(["ocean evidence"]);
    expect(tasksById.task.checkpoint?.historyPath).toBeUndefined();
    expect(tasksById.task.executionRunIds).toHaveLength(1);
  },
);

it("keeps an in-flight reservation charged after unmount without a terminal tool receipt", async () => {
  const { createWebSearchBinding } =
    await import("@/services/api/chat/builtinTools/webSearch");
  const { ctx, input } = fixture();
  mocks.provider.mockImplementationOnce(
    async (_request, signal: AbortSignal) => {
      const durable = JSON.parse([...mocks.files.values()].at(-1)!);
      expect(durable.executedQueries).toEqual(["cancelled solar query"]);
      expect(durable.toolCalls).toEqual([]);
      ctx.controller.abort(new DOMException("Page unmounted", "AbortError"));
      signal.throwIfAborted();
    },
  );
  mocks.stream.mockImplementationOnce(async (...args: unknown[]) => {
    const options = args[17] as {
      agentRun: { id: string };
      researchQueryBudget: import("@/services/api/chat/builtinTools").BuiltinResearchQueryBudget;
    };
    mocks.runs[options.agentRun.id] = {
      id: options.agentRun.id,
      status: "interrupted",
      usage: { toolRounds: 1, toolCalls: 1, wallTimeMs: 1, totalTokens: 10 },
      toolExecutions: [],
    } as unknown as AgentRun;
    (args[9] as (calls: ToolCall[]) => void)([
      {
        id: "in-flight",
        name: "web_search",
        args: { query: "cancelled solar query" },
        status: "running",
      },
    ]);
    await createWebSearchBinding({
      queryBudget: options.researchQueryBudget,
    }).execute({ query: "cancelled solar query" }, {
      signal: args[12],
      emit: { search: vi.fn() },
    } as never);
    return "unreachable";
  });
  const failure = await executeWave(ctx, input).catch(
    (error: unknown) => error,
  );
  expect(failure).toMatchObject({ name: "AbortError" });
  await handleExecutionFailure(ctx, failure);
  Object.assign(ctx, { controller: new AbortController() });
  const resumed = await prepareWave(ctx, { ...input, run: ctx.run });
  expect(resumed?.queryBudget.remainingQueries).toBe(3);
  expect(resumed?.queryBudget.seenQueries?.has("cancelled solar query")).toBe(
    true,
  );
  const { consumeResearchQueries } =
    await import("@/services/api/chat/builtinTools/researchQueryBudget");
  expect(
    consumeResearchQueries(resumed!.queryBudget, ["cancelled solar query"]),
  ).toBe("duplicate");
  expect(
    consumeResearchQueries(resumed!.queryBudget, [
      "ocean currents",
      "forest ecology",
      "stellar evolution",
      "volcanic rocks",
    ]),
  ).toBe("exhausted");
});

it.each([
  null,
  "invalid",
  [""],
  [42],
  ["same", " SAME "],
  Array(49).fill("query"),
  ["x".repeat(4_001)],
])("rejects a corrupt host query ledger %j", async (ledger) => {
  const { ctx, input, tasksById } = fixture();
  const wave = (await prepareWave(ctx, input))!;
  mocks.runs[wave.agentRunId] = {
    id: wave.agentRunId,
    status: "interrupted",
    usage: { toolRounds: 0, toolCalls: 0, wallTimeMs: 0, totalTokens: 0 },
    toolExecutions: [],
  } as unknown as AgentRun;
  const { persistWaveCheckpoint } =
    await import("@/lib/research/runtime/wave/waveCheckpoint");
  await persistWaveCheckpoint(wave);
  const path = tasksById.task.checkpoint!.historyPath!;
  const saved = JSON.parse(mocks.files.get(path)!);
  saved.executedQueries = ledger;
  mocks.files.set(path, JSON.stringify(saved));
  await expect(
    prepareWave(ctx, { ...input, run: ctx.run }),
  ).rejects.toMatchObject({ code: "RESEARCH_CHECKPOINT_UNAVAILABLE" });
  expect(mocks.stream).not.toHaveBeenCalled();
});

it("restores legacy checkpoints from receipts when the host ledger is absent", async () => {
  const { ctx, input, tasksById } = fixture();
  const wave = (await prepareWave(ctx, input))!;
  mocks.runs[wave.agentRunId] = {
    id: wave.agentRunId,
    status: "interrupted",
    usage: { toolRounds: 0, toolCalls: 0, wallTimeMs: 0, totalTokens: 0 },
    toolExecutions: [],
  } as unknown as AgentRun;
  wave.latestToolCalls = [call];
  const { persistWaveCheckpoint } =
    await import("@/lib/research/runtime/wave/waveCheckpoint");
  await persistWaveCheckpoint(wave);
  const path = tasksById.task.checkpoint!.historyPath!;
  const saved = JSON.parse(mocks.files.get(path)!);
  delete saved.executedQueries;
  mocks.files.set(path, JSON.stringify(saved));
  const restored = await prepareWave(ctx, { ...input, run: ctx.run });
  expect(restored?.executedQueries).toEqual(["ocean evidence"]);
  expect(restored?.queryBudget.remainingQueries).toBe(3);
});

it("blocks external dispatch when the actual wave reservation checkpoint fails", async () => {
  const { createWebSearchBinding } =
    await import("@/services/api/chat/builtinTools/webSearch");
  const { ctx, input, tasksById } = fixture();
  const failure = new ResearchPersistenceError("quota");
  mocks.write.mockRejectedValueOnce(failure);
  mocks.stream.mockImplementationOnce(async (...args: unknown[]) => {
    const options = args[17] as {
      researchQueryBudget: import("@/services/api/chat/builtinTools").BuiltinResearchQueryBudget;
    };
    await createWebSearchBinding({
      queryBudget: options.researchQueryBudget,
    }).execute({ query: "solar physics" }, {
      signal: args[12],
      emit: {},
    } as never);
    return "unreachable";
  });
  await expect(executeWave(ctx, input)).rejects.toBe(failure);
  expect(mocks.provider).not.toHaveBeenCalled();
  await handleExecutionFailure(ctx, failure);
  expect(tasksById.task.status).toBe("failed");
});

it("recovers the durable net ledger after a partially refunded batch without terminal receipts", async () => {
  const { createSearchWebV2Binding } =
    await import("@/services/api/chat/builtinTools/webSearch");
  const { consumeResearchQueries } =
    await import("@/services/api/chat/builtinTools/researchQueryBudget");
  const { SearchRequestError } = await import("@/lib/search/errors");
  const { ctx, input } = fixture();
  mocks.provider
    .mockResolvedValueOnce({ sources: [], images: [] })
    .mockRejectedValueOnce(
      new SearchRequestError("busy", 429, "SEARCH_HTTP_ERROR", "provider"),
    );
  mocks.stream.mockImplementationOnce(async (...args: unknown[]) => {
    const options = args[17] as {
      agentRun: { id: string };
      researchQueryBudget: import("@/services/api/chat/builtinTools").BuiltinResearchQueryBudget;
    };
    mocks.runs[options.agentRun.id] = {
      id: options.agentRun.id,
      status: "interrupted",
      usage: { toolRounds: 1, toolCalls: 1, wallTimeMs: 1, totalTokens: 10 },
      toolExecutions: [],
    } as unknown as AgentRun;
    const result = await createSearchWebV2Binding({
      queryBudget: options.researchQueryBudget,
    }).execute({ queries: ["solar physics", "ocean currents"] }, {
      signal: args[12],
      emit: {},
    } as never);
    expect(result).toMatchObject({ refundedQueries: ["ocean currents"] });
    expect(
      JSON.parse([...mocks.files.values()].at(-1)!).executedQueries,
    ).toEqual(["solar physics"]);
    throw new TypeError("Failed to fetch");
  });
  await expect(executeWave(ctx, input)).rejects.toThrow("Failed to fetch");
  const restored = await prepareWave(ctx, { ...input, run: ctx.run });
  expect(restored?.executedQueries).toEqual(["solar physics"]);
  expect(restored?.queryBudget.remainingQueries).toBe(3);
  expect(consumeResearchQueries(restored!.queryBudget, ["solar physics"])).toBe(
    "duplicate",
  );
  expect(
    consumeResearchQueries(restored!.queryBudget, ["ocean currents"]),
  ).toBe("ok");
});
