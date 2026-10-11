import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerHtmlRuntimeFlusher } from "@/lib/intelligentUi/runtimeFlush";
import { normalizeMessageTreeMessages } from "@/store/storage/migrations";
import { HTML_RUNTIME_LIMITS } from "@/lib/intelligentUi/runtimeLimits";
import { captureToolResultView } from "@/lib/intelligentUi/toolResults/adapters";
import type { Message, SessionMessageTree, ToolCall } from "@/types";
import type { IntelligentUiBlock, JsonObject } from "@/lib/intelligentUi/types";
import { parseIntelligentUiText } from "@/lib/intelligentUi/parser";
import {
  cloneMessageTreeWithNewIds,
  getActiveMessagePath,
  normalizeSessionMessageTree,
} from "@/lib/chat/messageTree";
const { appDb, stored } = vi.hoisted(() => {
  const stored = new Map<string, unknown>();
  return {
    stored,
    appDb: {
      getItem: vi.fn(async (key: string) => stored.get(key)),
      setItem: vi.fn(async (key: string, value: unknown) => {
        stored.set(key, value);
      }),
      removeItem: vi.fn(async (key: string) => {
        stored.delete(key);
      }),
    },
  };
});
vi.mock("@/store/storage/storageConfig", () => ({
  appDb,
  getAppDbStorage: () => ({
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
  }),
  STORAGE_KEYS: { CHAT: "neo-chat-storage" },
  STORAGE_VERSION: 2,
}));
vi.mock("@/services/sharing/client", () => ({
  revokeSessionShareBeforeDelete: vi.fn(async () => undefined),
  cancelSessionShareDeletion: vi.fn(async () => undefined),
}));
vi.mock("@/utils/opfs", () => ({
  deleteFromOPFS: vi.fn(async () => undefined),
}));
vi.mock("@/services/workspace/sessionArtifact", () => ({
  deleteSessionArtifacts: vi.fn(async () => undefined),
  duplicateSessionArtifacts: vi.fn(async () => new Map()),
}));
vi.mock("@/store/core/agentRunStore", () => ({
  useAgentRunStore: {
    getState: () => ({ clearSessionRuns: vi.fn(async () => undefined) }),
  },
}));
import { waitForSessionMessageWrites } from "@/store/sessionMessagePersistence";
afterEach(() => vi.useRealTimers());
const { useChatStore } = await import("@/store/core/chatStore");
function makeBlock(): IntelligentUiBlock {
  const result = parseIntelligentUiText(
    '```intelligent-ui\n{"version":1,"kind":"checklist","title":"Tasks","summary":"Prepare","props":{"items":[{"id":"one","label":"One"}]}}\n```',
    { idPrefix: "message", final: true },
  )[0];
  if (result?.type !== "intelligent_ui") throw Error("Invalid fixture");
  return result.block;
}
const message = (): Message => ({
  id: "message",
  role: "model",
  content: "",
  timestamp: 1,
  outputBlocks: [makeBlock()],
});
const currentBlock = () =>
  useChatStore.getState().activeMessages[0]!
    .outputBlocks![0] as IntelligentUiBlock;
function install(sessionId = "session") {
  const messages = [message()];
  useChatStore.setState({
    _hasHydrated: true,
    currentSessionId: sessionId,
    sessions: [
      {
        id: sessionId,
        title: "Session",
        model: "model",
        updatedAt: 1,
        messageCount: 1,
      },
    ],
    activeMessages: messages,
    activeMessageTree: normalizeSessionMessageTree(messages),
    isActiveSessionLoading: false,
  });
}
beforeEach(() => {
  useChatStore.getState().discardTemporarySession();
  stored.clear();
  vi.clearAllMocks();
  install();
});
describe("Intelligent UI conversation state", () => {
  it("persists reserved JSON keys from validated HTML runtime updates without weakening limits", async () => {
    const htmlBlock: IntelligentUiBlock = {
      ...makeBlock(),
      renderer: "html",
      definition: {
        version: 1,
        title: "HTML",
        summary: "Saved",
        html: "<p>Saved</p>",
      },
    };
    const htmlMessage: Message = { ...message(), outputBlocks: [htmlBlock] };
    useChatStore.setState({
      activeMessages: [htmlMessage],
      activeMessageTree: normalizeSessionMessageTree([htmlMessage]),
    });
    const jsonState = JSON.parse(
      '{"__proto__":{"value":1},"constructor":"saved","prototype":[2]}',
    );
    expect(
      await useChatStore
        .getState()
        .updateIntelligentUiState(
          "session",
          "message",
          htmlBlock.id,
          1,
          jsonState,
        ),
    ).toBe(true);
    const saved = normalizeMessageTreeMessages(
      stored.get("session_messages_session") as SessionMessageTree,
    );
    expect(
      JSON.stringify(
        (getActiveMessagePath(saved)[0]!.outputBlocks![0] as IntelligentUiBlock)
          .state,
      ),
    ).toBe(JSON.stringify(jsonState));
    const prior = currentBlock();
    let deep: JsonObject = { leaf: 1 };
    for (let i = 0; i < 30; i++) deep = { next: deep };
    for (const invalid of [
      { text: "x".repeat(HTML_RUNTIME_LIMITS.stateBytes + 1) },
      deep,
    ]) {
      expect(
        await useChatStore
          .getState()
          .updateIntelligentUiState(
            "session",
            "message",
            htmlBlock.id,
            1,
            invalid,
          ),
      ).toBe(false);
      expect(currentBlock().stateRevision).toBe(prior.stateRevision);
      expect(currentBlock().state).toEqual(prior.state);
    }
    expect(appDb.setItem).toHaveBeenCalledTimes(1);
  });

  it("retains failed immediate native UI updates for explicit retry", async () => {
    appDb.setItem.mockRejectedValueOnce(new Error("quota"));
    await expect(
      useChatStore
        .getState()
        .updateIntelligentUiState("session", "message", currentBlock().id, 1, {
          checked: ["one"],
        }),
    ).rejects.toThrow("quota");
    expect(currentBlock().state).toEqual({ checked: ["one"] });
    expect(currentBlock().stateRevision).toBe(1);
    await waitForSessionMessageWrites("session");
    expect(appDb.setItem).toHaveBeenCalledTimes(2);
    expect(
      getActiveMessagePath(
        stored.get("session_messages_session") as SessionMessageTree,
      )[0]!.outputBlocks![0],
    ).toMatchObject({ state: { checked: ["one"] }, stateRevision: 1 });
  });

  it("retains immediate tool-result UI state for retry", async () => {
    const call: ToolCall = {
      id: "search-call",
      name: "web_search",
      args: {},
      status: "success",
      result: {
        ok: true,
        trust: "external_untrusted",
        provenance: { origin: "builtin", toolName: "web_search" },
        data: { sources: [{ title: "Source", url: "https://example.com" }] },
      },
    };
    call.intelligentUiResult = await captureToolResultView({
      callId: call.id,
      toolName: call.name,
      retrievedAt: 1,
      result: call.result,
    });
    const toolMessage: Message = {
      ...message(),
      outputBlocks: undefined,
      toolCalls: [call],
    };
    useChatStore.setState({
      activeMessages: [toolMessage],
      activeMessageTree: normalizeSessionMessageTree([toolMessage]),
    });
    appDb.setItem.mockRejectedValueOnce(new Error("quota"));
    await expect(
      useChatStore
        .getState()
        .updateToolResultUiState(
          "session",
          "message",
          call.id,
          call.intelligentUiResult!.resultHash,
          { selected: ["source-1"] },
        ),
    ).rejects.toThrow("quota");
    expect(
      useChatStore.getState().activeMessages[0]!.toolCalls![0]!
        .intelligentUiStateRevision,
    ).toBe(1);
    await waitForSessionMessageWrites("session");
    expect(
      getActiveMessagePath(
        stored.get("session_messages_session") as SessionMessageTree,
      )[0]!.toolCalls![0],
    ).toMatchObject({
      intelligentUiStateRevision: 1,
      intelligentUiState: { selected: ["source-1"] },
    });
  });

  it("blocks switching when an immediate native UI retry still fails", async () => {
    useChatStore.setState({
      sessions: [
        ...useChatStore.getState().sessions,
        {
          id: "other",
          title: "Other",
          model: "model",
          updatedAt: 1,
          messageCount: 0,
        },
      ],
    });
    stored.set("session_messages_other", normalizeSessionMessageTree([]));
    appDb.setItem
      .mockRejectedValueOnce(new Error("quota"))
      .mockRejectedValueOnce(new Error("quota"));
    await expect(
      useChatStore
        .getState()
        .updateIntelligentUiState("session", "message", currentBlock().id, 1, {
          checked: ["one"],
        }),
    ).rejects.toThrow("quota");
    await useChatStore.getState().selectSession("other");
    expect(useChatStore.getState()).toMatchObject({
      currentSessionId: "session",
      activeSessionLoadError: "session_load_failed",
    });
    expect(currentBlock().state).toEqual({ checked: ["one"] });
    expect(appDb.getItem).not.toHaveBeenCalledWith("session_messages_other");
    await waitForSessionMessageWrites("session");
    expect(
      getActiveMessagePath(
        stored.get("session_messages_session") as SessionMessageTree,
      )[0]!.outputBlocks![0],
    ).toMatchObject({ state: { checked: ["one"] } });
  });

  it("does not retain a rolled-back ordinary deletion over an earlier dirty UI snapshot", async () => {
    appDb.setItem
      .mockRejectedValueOnce(new Error("UI quota"))
      .mockRejectedValueOnce(new Error("delete quota"));
    await expect(
      useChatStore
        .getState()
        .updateIntelligentUiState("session", "message", currentBlock().id, 1, {
          checked: ["one"],
        }),
    ).rejects.toThrow("UI quota");
    await expect(
      useChatStore.getState().deleteMessage("session", "message"),
    ).rejects.toThrow("delete quota");
    expect(currentBlock().state).toEqual({ checked: ["one"] });
    await waitForSessionMessageWrites("session");
    expect(
      getActiveMessagePath(
        stored.get("session_messages_session") as SessionMessageTree,
      )[0]!.outputBlocks![0],
    ).toMatchObject({ state: { checked: ["one"] } });
    expect(useChatStore.getState().activeMessages).toHaveLength(1);
  });

  it("accepts final runtime state before switching invalidates its active lease", async () => {
    let acknowledge!: () => void;
    const ack = new Promise<void>((resolve) => {
      acknowledge = resolve;
    });
    const unregister = registerHtmlRuntimeFlusher("session", () => ack);
    useChatStore.setState({
      sessions: [
        ...useChatStore.getState().sessions,
        {
          id: "other",
          title: "Other",
          model: "model",
          updatedAt: 1,
          messageCount: 0,
        },
      ],
    });
    stored.set("session_messages_other", normalizeSessionMessageTree([]));
    try {
      const switching = useChatStore.getState().selectSession("other");
      const update = useChatStore
        .getState()
        .updateIntelligentUiState(
          "session",
          "message",
          currentBlock().id,
          1,
          { value: "last frame update" },
          undefined,
          undefined,
          "coalesced",
        );
      expect(currentBlock().state).toEqual({ value: "last frame update" });
      acknowledge();
      expect(await update).toBe(true);
      await switching;
      expect(useChatStore.getState().currentSessionId).toBe("other");
      expect(
        getActiveMessagePath(
          stored.get("session_messages_session") as SessionMessageTree,
        )[0]!.outputBlocks![0],
      ).toMatchObject({ state: { value: "last frame update" } });
    } finally {
      unregister();
    }
  });

  it("updates memory immediately and coalesces durable UI snapshots", async () => {
    vi.useFakeTimers();
    const pending = [];
    for (let i = 0; i < 100; i++) {
      pending.push(
        useChatStore
          .getState()
          .updateIntelligentUiState(
            "session",
            "message",
            currentBlock().id,
            1,
            { value: i },
            undefined,
            undefined,
            "coalesced",
          ),
      );
    }
    expect(currentBlock().stateRevision).toBe(100);
    expect(currentBlock().state).toEqual({ value: 99 });
    expect(appDb.setItem).not.toHaveBeenCalled();
    await waitForSessionMessageWrites("session");
    await Promise.all(pending);
    expect(appDb.setItem).toHaveBeenCalledTimes(1);
    expect(
      getActiveMessagePath(
        stored.get("session_messages_session") as SessionMessageTree,
      )[0]!.outputBlocks![0],
    ).toMatchObject({ state: { value: 99 }, stateRevision: 100 });
  });
  it("retains unsaved UI memory and retries the latest snapshot explicitly", async () => {
    appDb.setItem.mockRejectedValueOnce(new Error("quota"));
    const save = useChatStore
      .getState()
      .updateIntelligentUiState(
        "session",
        "message",
        currentBlock().id,
        1,
        { value: 42 },
        undefined,
        undefined,
        "coalesced",
      );
    const rejected = expect(save).rejects.toThrow("quota");
    await expect(waitForSessionMessageWrites("session")).rejects.toThrow(
      "quota",
    );
    await rejected;
    expect(currentBlock().state).toEqual({ value: 42 });
    await waitForSessionMessageWrites("session");
    expect(
      getActiveMessagePath(
        stored.get("session_messages_session") as SessionMessageTree,
      )[0]!.outputBlocks![0],
    ).toMatchObject({ state: { value: 42 } });
  });

  it("persists isolated JSON state with a revision and rejects stale callbacks", async () => {
    const input = { checked: ["one"] };
    const store = useChatStore.getState();
    const block = currentBlock();
    expect(
      await store.updateIntelligentUiState(
        "session",
        "message",
        block.id,
        1,
        input,
        "Completed",
      ),
    ).toBe(true);
    input.checked.length = 0;
    expect(currentBlock()).toMatchObject({
      state: { checked: ["one"] },
      stateRevision: 1,
      staticSnapshot: "Completed",
    });
    const saved = stored.get("session_messages_session") as SessionMessageTree;
    expect(getActiveMessagePath(saved)[0]?.outputBlocks?.[0]).toMatchObject({
      state: { checked: ["one"] },
    });
    for (const [sessionId, messageId, blockId, revision] of [
      ["old", "message", block.id, 1],
      ["session", "old", block.id, 1],
      ["session", "message", "old", 1],
      ["session", "message", block.id, 2],
    ] as const) {
      expect(
        await store.updateIntelligentUiState(
          sessionId,
          messageId,
          blockId,
          revision,
          {},
        ),
      ).toBe(false);
    }
    expect(currentBlock().stateRevision).toBe(1);
  });
  it("preserves edits across streaming and terminal message updates", async () => {
    const store = useChatStore.getState();
    await store.updateIntelligentUiState(
      "session",
      "message",
      currentBlock().id,
      1,
      { checked: ["one"] },
      "Done",
    );
    store.updateMessageContent("session", "message", "more", undefined, [
      makeBlock(),
    ]);
    expect(currentBlock()).toMatchObject({
      state: { checked: ["one"] },
      stateRevision: 1,
      staticSnapshot: "Done",
    });
    store.updateMessage("session", "message", {
      content: "final",
      outputBlocks: [makeBlock()],
    });
    expect(currentBlock()).toMatchObject({
      state: { checked: ["one"] },
      stateRevision: 1,
    });
    await store.syncActiveSession("session");
  });
  it("does not transplant edits into a different definition revision", async () => {
    const store = useChatStore.getState();
    await store.updateIntelligentUiState(
      "session",
      "message",
      currentBlock().id,
      1,
      { checked: ["one"] },
    );
    store.updateMessageContent("session", "message", "new", undefined, [
      { ...makeBlock(), definitionRevision: 2 },
    ]);
    expect(currentBlock()).toMatchObject({
      definitionRevision: 2,
      stateRevision: 0,
      state: { checked: [] },
    });
  });
  it("rejects non-ready and user-message blocks", async () => {
    const block = { ...makeBlock(), status: "preview" as const };
    const preview = { ...message(), outputBlocks: [block] };
    useChatStore.setState({
      activeMessages: [preview],
      activeMessageTree: normalizeSessionMessageTree([preview]),
    });
    expect(
      await useChatStore
        .getState()
        .updateIntelligentUiState("session", "message", block.id, 1, {}),
    ).toBe(false);
    const user = { ...message(), role: "user" as const };
    useChatStore.setState({
      activeMessages: [user],
      activeMessageTree: normalizeSessionMessageTree([user]),
    });
    expect(
      await useChatStore
        .getState()
        .updateIntelligentUiState("session", "message", block.id, 1, {}),
    ).toBe(false);
  });
  it("clones state deeply and gives copied UI a new identity", () => {
    const tree = normalizeSessionMessageTree([message()]);
    const copy = cloneMessageTreeWithNewIds(tree, () => "copy");
    const copied = getActiveMessagePath(copy)[0]!
      .outputBlocks![0] as IntelligentUiBlock;
    expect(copied.id).not.toBe(makeBlock().id);
    copied.state.checked = ["one"];
    expect(
      (getActiveMessagePath(tree)[0]!.outputBlocks![0] as IntelligentUiBlock)
        .state.checked,
    ).toEqual([]);
    if (
      copied.definition &&
      "kind" in copied.definition &&
      copied.definition.kind === "checklist"
    )
      copied.definition.props.items[0]!.label = "Changed";
    expect(JSON.stringify(tree)).not.toContain("Changed");
  });
  it("keeps temporary state in memory without database writes", async () => {
    const id = useChatStore.getState().createTemporarySession();
    await useChatStore.getState().addMessage(id, message());
    appDb.setItem.mockClear();
    expect(
      await useChatStore.getState().updateIntelligentUiState(
        id,
        "message",
        currentBlock().id,
        1,
        {
          checked: ["one"],
        },
        undefined,
        undefined,
        "coalesced",
      ),
    ).toBe(true);
    expect(currentBlock().state.checked).toEqual(["one"]);
    expect(appDb.setItem).not.toHaveBeenCalled();
    useChatStore.getState().discardTemporarySession();
    expect(useChatStore.getState().activeMessages).toEqual([]);
  });
});
