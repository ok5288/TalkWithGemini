// @vitest-environment jsdom
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { ToolCall } from "@/types";
import {
  createAgentRun,
  prepareToolExecution,
  markToolExecutionRunning,
  commitToolExecution,
  recoverInterruptedAgentRun,
} from "@/lib/agent/run";
import {
  getAgentRunPersistence,
  closeAgentRunPersistence,
} from "@/services/agent/runtime";
import { writeWorkspaceText } from "@/services/workspace/sessionWorkspace";
import { captureToolResultView } from "@/lib/intelligentUi/toolResults/adapters";
import {
  prepareToolDraft,
  commitToolDraft,
  readToolDraftOutcome,
} from "@/lib/intelligentUi/toolResults/draft";

vi.mock("@/services/workspace/sessionWorkspace", () => ({
  writeWorkspaceText: vi.fn(),
}));
let held = false;
let appWriteHeld = false;
beforeEach(() => {
  closeAgentRunPersistence();
  vi.stubGlobal("indexedDB", new IDBFactory());
  localStorage.clear();
  held = false;
  appWriteHeld = false;
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: {
      request: async (
        _name: string,
        _options: unknown,
        callback: (lock: object | null) => Promise<unknown>,
      ) => {
        if (_name === "neo-chat-app-data") {
          appWriteHeld = true;
          try {
            return await callback({});
          } finally {
            appWriteHeld = false;
          }
        }
        if (held) return callback(null);
        held = true;
        try {
          return await callback({});
        } finally {
          held = false;
        }
      },
    },
  });
  vi.mocked(writeWorkspaceText)
    .mockReset()
    .mockImplementation(async (sessionId, path) => {
      if (typeof path !== "string") throw new Error("Invalid fixture path");
      return {
        ok: true,
        value: {
          path,
          url: `opfs://chat/workspace/${sessionId}/${path}`,
          fileName: "draft.md",
          mimeType: "text/markdown",
          bytes: 20,
          contentHash: "content-hash",
          revision: "revision-1",
          updatedAt: 100,
          source: "agent",
        },
      };
    });
});
afterEach(() => {
  closeAgentRunPersistence();
  vi.unstubAllGlobals();
});
async function fixture() {
  const call: ToolCall = {
    id: "call",
    name: "web_search",
    args: {},
    status: "success",
    executionRecordId: "source-exec",
    functionFingerprint: "fp",
    result: {
      ok: true,
      trust: "external_untrusted",
      provenance: { origin: "builtin", toolName: "web_search" },
      data: { sources: [{ title: "One", url: "https://example.com" }] },
    },
  };
  call.intelligentUiResult = await captureToolResultView({
    callId: call.id,
    toolName: call.name,
    executionId: call.executionRecordId,
    definitionFingerprint: call.functionFingerprint,
    result: call.result,
    retrievedAt: 1,
  });
  let run = prepareToolExecution(
    createAgentRun({
      id: "source-run",
      sessionId: "session",
      modelMessageId: "message",
    }),
    {
      id: "source-exec",
      callId: call.id,
      toolName: call.name,
      definitionFingerprint: "fp",
      argumentsHash: "args",
      policy: {
        effects: ["network_read"],
        origin: "builtin",
        sensitivity: "user_data",
        idempotency: "idempotent",
      },
    },
  );
  run = commitToolExecution(
    markToolExecutionRunning(run, "source-exec"),
    "source-exec",
    {
      resultRefs: [
        {
          kind: "tool_cache",
          id: call.id,
          contentHash: call.intelligentUiResult!.resultHash,
        },
      ],
    },
  );
  await getAgentRunPersistence().save(run);
  const proposal = (await prepareToolDraft({
    sessionId: "session",
    messageId: "message",
    call,
    selectedIds: ["source-1"],
    visibleColumns: ["title", "url"],
  }))!;
  return {
    call,
    proposal,
    context: { authorized: () => true, currentCall: () => call },
  };
}
describe("confirmed tool result workspace draft", () => {
  it.each([
    "receipt",
    "references",
    "effectId",
    "targetHash",
    "contentHash",
    "path",
  ])(
    "does not trust a committed draft with damaged %s evidence",
    async (damage) => {
      const { proposal, context } = await fixture();
      expect(await commitToolDraft(proposal, context)).toMatchObject({
        status: "committed",
      });
      const persistence = getAgentRunPersistence();
      const run = (await persistence.get(proposal.runId))!;
      const execution = run.toolExecutions[0];
      if (damage === "receipt") delete execution.receipt;
      if (damage === "references") delete execution.resultRefs;
      if (damage === "effectId")
        execution.receipt!.effectId = "another-attempt";
      if (damage === "targetHash")
        execution.receipt!.targetHash = "another-target";
      if (damage === "contentHash")
        execution.resultRefs![0].contentHash = "different-content";
      if (damage === "path")
        execution.resultRefs![0].id = "opfs://chat/workspace/session/other.md";
      await persistence.save(run);
      expect(await readToolDraftOutcome(proposal)).toMatchObject({
        status: "effect_unknown",
        retryable: false,
      });
      expect(await commitToolDraft(proposal, context)).toMatchObject({
        status: "effect_unknown",
        retryable: false,
      });
      expect(writeWorkspaceText).toHaveBeenCalledTimes(1);
    },
  );
  it("uses create-only writing, records receipt, and never dispatches the same proposal twice", async () => {
    const { proposal, context } = await fixture();
    const result = await commitToolDraft(proposal, context);
    expect(result.status).toBe("committed");
    expect(writeWorkspaceText).toHaveBeenCalledWith(
      "session",
      proposal.path,
      proposal.content,
      "create",
      { beforeWrite: expect.any(Function) },
    );
    expect(result.execution?.receipt?.reversible).toBe(true);
    expect(await commitToolDraft(proposal, context)).toMatchObject({
      status: "committed",
    });
    expect(writeWorkspaceText).toHaveBeenCalledTimes(1);
    expect(await readToolDraftOutcome(proposal)).toMatchObject({
      status: "committed",
    });
    expect(
      JSON.stringify(await getAgentRunPersistence().get(proposal.runId)),
    ).not.toContain("https://example.com");
  });
  it("denies revoked permission, result mutation, edited proposal and missing source journal", async () => {
    const { proposal, context, call } = await fixture();
    expect(
      await commitToolDraft(proposal, { ...context, authorized: () => false }),
    ).toMatchObject({ status: "denied" });
    expect(
      await commitToolDraft({ ...proposal, content: "injected" }, context),
    ).toMatchObject({ status: "denied" });
    expect(
      await commitToolDraft(proposal, {
        ...context,
        currentCall: () => ({ ...call, result: {} }),
      }),
    ).toMatchObject({ status: "denied" });
    await getAgentRunPersistence().remove("source-run");
    expect(await commitToolDraft(proposal, context)).toMatchObject({
      status: "denied",
    });
    expect(writeWorkspaceText).not.toHaveBeenCalled();
  });
  it("refuses a concurrent double-click and recovers interrupted effect as unknown without replay", async () => {
    const { proposal, context } = await fixture();
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    vi.mocked(writeWorkspaceText).mockImplementationOnce(async () => {
      await pending;
      throw new Error("interrupted");
    });
    const first = commitToolDraft(proposal, context);
    await vi.waitFor(() => expect(writeWorkspaceText).toHaveBeenCalledTimes(1));
    expect(await commitToolDraft(proposal, context)).toMatchObject({
      status: "busy",
    });
    finish();
    expect(await first).toMatchObject({ status: "effect_unknown" });
    expect(await commitToolDraft(proposal, context)).toMatchObject({
      status: "effect_unknown",
    });
    expect(writeWorkspaceText).toHaveBeenCalledTimes(1);
  });
  it("reports existing-target conflicts without overwriting or claiming success", async () => {
    const { proposal, context } = await fixture();
    vi.mocked(writeWorkspaceText).mockResolvedValueOnce({
      ok: false,
      error: { code: "WORKSPACE_FILE_EXISTS", message: "exists" },
    });
    expect(await commitToolDraft(proposal, context)).toMatchObject({
      status: "failed",
    });
    expect(await readToolDraftOutcome(proposal)).toMatchObject({
      status: "failed",
    });
  });
  it("treats a workspace metadata/write failure as uncertain rather than a safe-to-retry failure", async () => {
    const { proposal, context } = await fixture();
    vi.mocked(writeWorkspaceText).mockResolvedValueOnce({
      ok: false,
      error: {
        code: "WORKSPACE_WRITE_FAILED",
        message: "Manifest failed after writing",
      },
    });
    expect(await commitToolDraft(proposal, context)).toMatchObject({
      status: "effect_unknown",
    });
    expect(await commitToolDraft(proposal, context)).toMatchObject({
      status: "effect_unknown",
    });
    expect(writeWorkspaceText).toHaveBeenCalledTimes(1);
  });
  it("rechecks authority immediately before dispatch after durable checkpoint", async () => {
    const { proposal, context } = await fixture();
    const persistence = getAgentRunPersistence();
    let authorized = true;
    const save = persistence.save.bind(persistence);
    vi.spyOn(persistence, "save").mockImplementation(async (run) => {
      await save(run);
      if (run.id === proposal.runId) authorized = false;
    });
    expect(
      await commitToolDraft(proposal, {
        ...context,
        authorized: () => authorized,
      }),
    ).toMatchObject({ status: "denied" });
    expect(writeWorkspaceText).not.toHaveBeenCalled();
  });
  it("requires a fresh preview after quota failure and preserves each attempt", async () => {
    const { call, proposal, context } = await fixture();
    vi.mocked(writeWorkspaceText).mockResolvedValueOnce({
      ok: false,
      error: {
        code: "WORKSPACE_QUOTA_EXCEEDED",
        message: "full",
      },
    });
    expect(await commitToolDraft(proposal, context)).toMatchObject({
      status: "failed",
      retryable: true,
    });
    expect(await commitToolDraft(proposal, context)).toMatchObject({
      status: "failed",
    });
    expect(writeWorkspaceText).toHaveBeenCalledTimes(1);
    const input = {
      sessionId: "session",
      messageId: "message",
      call,
      selectedIds: proposal.selectedIds,
      visibleColumns: proposal.visibleColumns,
    };
    expect((await prepareToolDraft(input))?.runId).toBe(proposal.runId);
    const retry = (await prepareToolDraft({ ...input, retry: true }))!;
    expect(retry).toMatchObject({
      runId: `${proposal.runId}-a2`,
      attemptNumber: 2,
      previousRunId: proposal.runId,
      hash: proposal.hash,
      path: proposal.path,
    });
    expect(await getAgentRunPersistence().get(retry.runId)).toBeNull();
    expect(await commitToolDraft(retry, context)).toMatchObject({
      status: "committed",
    });
    expect(await commitToolDraft(retry, context)).toMatchObject({
      status: "committed",
    });
    expect(writeWorkspaceText).toHaveBeenCalledTimes(2);
    expect(
      (await getAgentRunPersistence().get(proposal.runId))?.toolExecutions[0]
        .status,
    ).toBe("failed");
  });
  it("refuses unknown results, missing predecessors, and revoked retry permission", async () => {
    const { call, proposal, context } = await fixture();
    const input = {
      sessionId: "session",
      messageId: "message",
      call,
      selectedIds: proposal.selectedIds,
      visibleColumns: proposal.visibleColumns,
      retry: true,
    };
    vi.mocked(writeWorkspaceText).mockResolvedValueOnce({
      ok: false,
      error: {
        code: "WORKSPACE_QUOTA_EXCEEDED",
        message: "full",
      },
    });
    await commitToolDraft(proposal, context);
    const retry = (await prepareToolDraft(input))!;
    expect(
      await commitToolDraft(retry, { ...context, authorized: () => false }),
    ).toMatchObject({ status: "denied" });
    await getAgentRunPersistence().remove(proposal.runId);
    expect(await commitToolDraft(retry, context)).toMatchObject({
      status: "denied",
    });
    expect(await commitToolDraft(proposal, context)).toMatchObject({
      status: "denied",
    });
    await expect(prepareToolDraft(input)).rejects.toThrow();
    expect(writeWorkspaceText).toHaveBeenCalledTimes(1);
  });
  it("holds the app write barrier throughout journal, effect, and receipt writes", async () => {
    const { proposal, context } = await fixture();
    const persistence = getAgentRunPersistence();
    const save = persistence.save.bind(persistence);
    const observed: boolean[] = [];
    const spy = vi
      .spyOn(persistence, "save")
      .mockImplementation(async (run) => {
        if (run.id === proposal.runId) observed.push(appWriteHeld);
        await save(run);
      });
    const original = vi.mocked(writeWorkspaceText).getMockImplementation()!;
    vi.mocked(writeWorkspaceText).mockImplementationOnce(async (...args) => {
      observed.push(appWriteHeld);
      return original(...args);
    });
    expect(await commitToolDraft(proposal, context)).toMatchObject({
      status: "committed",
    });
    expect(observed).toEqual([true, true, true, true]);
    expect(appWriteHeld).toBe(false);
    spy.mockRestore();
  });
  it("blocks dispatch during an app restore", async () => {
    const { proposal, context } = await fixture();
    localStorage.setItem("neo-chat-restore-write-lock", "restore");
    expect(await commitToolDraft(proposal, context)).toMatchObject({
      status: "denied",
    });
    expect(writeWorkspaceText).not.toHaveBeenCalled();
    expect(await getAgentRunPersistence().get(proposal.runId)).toBeNull();
  });
  it("preserves uncertainty when recovering a running create-only draft", async () => {
    const { proposal, context } = await fixture();
    let recoveredStatus: string | undefined;
    vi.mocked(writeWorkspaceText).mockImplementationOnce(async () => {
      const run = (await getAgentRunPersistence().get(proposal.runId))!;
      recoveredStatus =
        recoverInterruptedAgentRun(run).toolExecutions[0].status;
      throw new Error("interrupted");
    });
    expect(await commitToolDraft(proposal, context)).toMatchObject({
      status: "effect_unknown",
    });
    expect(recoveredStatus).toBe("effect_unknown");
  });
  it.each(["corrupt", "delete"])(
    "rejects %s raw journals after reopening persistence",
    async (damage) => {
      const { call, proposal, context } = await fixture();
      await commitToolDraft(proposal, context);
      closeAgentRunPersistence();
      await mutateRawJournal(proposal.runId, damage);
      const input = {
        sessionId: "session",
        messageId: "message",
        call,
        selectedIds: proposal.selectedIds,
        visibleColumns: proposal.visibleColumns,
        retry: true,
      };
      await expect(prepareToolDraft(input)).rejects.toThrow();
      expect(await commitToolDraft(proposal, context)).toMatchObject({
        status: "denied",
      });
      expect(writeWorkspaceText).toHaveBeenCalledTimes(1);
    },
  );
  it("keeps legacy receipts readable but does not guess missing legacy retry history", async () => {
    const { call, proposal, context } = await fixture();
    vi.mocked(writeWorkspaceText).mockResolvedValueOnce({
      ok: false,
      error: { code: "WORKSPACE_QUOTA_EXCEEDED", message: "full" },
    });
    await commitToolDraft(proposal, context);
    await mutateRawJournal(`ui-draft-journal:${proposal.runId}`, "delete");
    closeAgentRunPersistence();
    const input = {
      sessionId: "session",
      messageId: "message",
      call,
      selectedIds: proposal.selectedIds,
      visibleColumns: proposal.visibleColumns,
    };
    expect((await prepareToolDraft(input))?.runId).toBe(proposal.runId);
    await expect(prepareToolDraft({ ...input, retry: true })).rejects.toThrow(
      "Legacy",
    );
    expect(await commitToolDraft(proposal, context)).toMatchObject({
      status: "failed",
      retryable: false,
    });
    expect(writeWorkspaceText).toHaveBeenCalledTimes(1);
  });
  it("rejects a missing terminal suffix even when its failed predecessor remains", async () => {
    const { call, proposal, context } = await fixture();
    vi.mocked(writeWorkspaceText).mockResolvedValueOnce({
      ok: false,
      error: { code: "WORKSPACE_QUOTA_EXCEEDED", message: "full" },
    });
    await commitToolDraft(proposal, context);
    const input = {
      sessionId: "session",
      messageId: "message",
      call,
      selectedIds: proposal.selectedIds,
      visibleColumns: proposal.visibleColumns,
      retry: true,
    };
    const retry = (await prepareToolDraft(input))!;
    await commitToolDraft(retry, context);
    await getAgentRunPersistence().remove(retry.runId);
    closeAgentRunPersistence();
    await expect(prepareToolDraft(input)).rejects.toThrow();
    expect(await commitToolDraft(retry, context)).toMatchObject({
      status: "denied",
    });
    expect(writeWorkspaceText).toHaveBeenCalledTimes(2);
  });
  it("re-previews an expired pre-dispatch confirmation without reviving the old run", async () => {
    const { call, proposal, context } = await fixture();
    const persistence = getAgentRunPersistence();
    const save = persistence.save.bind(persistence);
    let authorized = true;
    const spy = vi
      .spyOn(persistence, "save")
      .mockImplementation(async (run) => {
        await save(run);
        if (run.id === proposal.runId) authorized = false;
      });
    expect(
      await commitToolDraft(proposal, {
        ...context,
        authorized: () => authorized,
      }),
    ).toMatchObject({ status: "denied", retryable: true });
    spy.mockRestore();
    const retry = (await prepareToolDraft({
      sessionId: "session",
      messageId: "message",
      call,
      selectedIds: proposal.selectedIds,
      visibleColumns: proposal.visibleColumns,
      retry: true,
    }))!;
    expect(retry.attemptNumber).toBe(2);
    expect(await commitToolDraft(retry, context)).toMatchObject({
      status: "committed",
    });
    expect(writeWorkspaceText).toHaveBeenCalledTimes(1);
  });
  it("serializes two confirmed retry candidates and rejects a corrupted predecessor", async () => {
    const { call, proposal, context } = await fixture();
    vi.mocked(writeWorkspaceText).mockResolvedValueOnce({
      ok: false,
      error: {
        code: "WORKSPACE_QUOTA_EXCEEDED",
        message: "full",
      },
    });
    await commitToolDraft(proposal, context);
    const input = {
      sessionId: "session",
      messageId: "message",
      call,
      selectedIds: proposal.selectedIds,
      visibleColumns: proposal.visibleColumns,
      retry: true,
    };
    const [first, second] = await Promise.all([
      prepareToolDraft(input),
      prepareToolDraft(input),
    ]);
    expect(first).toEqual(second);
    const persistence = getAgentRunPersistence();
    const predecessor = (await persistence.get(proposal.runId))!;
    await persistence.save({
      ...predecessor,
      toolExecutions: [
        { ...predecessor.toolExecutions[0], targetSummary: "wrong.md" },
      ],
    });
    expect(await commitToolDraft(first!, context)).toMatchObject({
      status: "denied",
    });
    await persistence.save(predecessor);
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const success = await vi
      .mocked(writeWorkspaceText)
      .getMockImplementation()!("session", proposal.path, proposal.content);
    vi.mocked(writeWorkspaceText).mockImplementationOnce(async () => {
      await pending;
      return success;
    });
    const firstCommit = commitToolDraft(first!, context);
    await vi.waitFor(() => expect(writeWorkspaceText).toHaveBeenCalledTimes(2));
    expect(await commitToolDraft(second!, context)).toMatchObject({
      status: "busy",
    });
    release();
    expect(await firstCommit).toMatchObject({ status: "committed" });
    expect(await commitToolDraft(second!, context)).toMatchObject({
      status: "committed",
    });
    expect(writeWorkspaceText).toHaveBeenCalledTimes(2);
  });
  it("does not replay a successful write whose receipt journal could not be saved", async () => {
    const { call, proposal, context } = await fixture();
    const persistence = getAgentRunPersistence();
    const save = persistence.save.bind(persistence);
    const spy = vi
      .spyOn(persistence, "save")
      .mockImplementation(async (run) => {
        if (
          run.id === proposal.runId &&
          run.toolExecutions[0].status === "committed"
        )
          throw new Error("disk full");
        await save(run);
      });
    expect(await commitToolDraft(proposal, context)).toMatchObject({
      status: "effect_unknown",
    });
    spy.mockRestore();
    closeAgentRunPersistence();
    const { useAgentRunStore } = await import("@/store/core/agentRunStore");
    useAgentRunStore.setState({ runsById: {}, loadedSessionIds: {} });
    await useAgentRunStore.getState().loadSessionRuns("session");
    expect(useAgentRunStore.getState().runsById[proposal.runId]).toMatchObject({
      status: "interrupted",
      stop: { reason: "effect_unknown" },
      toolExecutions: [{ status: "effect_unknown" }],
    });
    const retry = await prepareToolDraft({
      sessionId: "session",
      messageId: "message",
      call,
      selectedIds: proposal.selectedIds,
      visibleColumns: proposal.visibleColumns,
      retry: true,
    });
    expect(retry?.runId).toBe(proposal.runId);
    expect(await commitToolDraft(retry!, context)).toMatchObject({
      status: "effect_unknown",
    });
    expect(writeWorkspaceText).toHaveBeenCalledTimes(1);
  });
});

async function mutateRawJournal(runId: string, damage: string) {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("neo-chat-agent-runs", 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction("runs", "readwrite");
      const store = transaction.objectStore("runs");
      if (damage === "delete") store.delete(runId);
      else
        store.put({
          runId,
          sessionId: "session",
          storageVersion: 1,
          run: { id: runId, broken: true },
        });
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
}
