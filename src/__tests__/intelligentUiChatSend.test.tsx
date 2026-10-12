// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Message } from "@/types";
import type { UiChatSource } from "@/components/content/intelligentUi/UiChatContext";
import { createChatFlowDeps } from "./support/chatFlowDeps";
import type { ComposerDraftRequest } from "@/lib/chat/composerActions";

const state = vi.hoisted(() => ({
  syncActiveSession: vi.fn(async () => undefined),
  currentSessionId: "session-1",
  selectedModel: "test-provider/test-model",
  activeMessages: [] as Message[],
  sessions: [{ id: "session-1" }],
  isActiveSessionLoading: false,
  pendingSessionId: null as string | null,
}));
const settings = vi.hoisted(() => ({ system: { enableIntelligentUi: true } }));
const stream = vi.hoisted(() =>
  vi.fn(async (...args: unknown[]) => {
    void args;
  }),
);
const prepareHistory = vi.hoisted(() => vi.fn(async () => []));
const resolveSkills = vi.hoisted(() =>
  vi.fn(async () => ({ context: "", invocations: [], skippedSkillIds: [] })),
);
const stageDraft = vi.hoisted(() =>
  vi.fn<(request: ComposerDraftRequest) => void>(),
);
vi.mock("@/lib/chat/composerActions", () => ({
  requestComposerDraft: stageDraft,
}));
vi.mock("@/store/core/chatStore", () => ({
  useChatStore: { getState: () => state },
}));
vi.mock("@/store/core/settingsStore", () => ({
  useSettingsStore: { getState: () => settings },
}));
vi.mock("@/lib/sync/deviceIdentity", () => ({
  getSyncDeviceId: () => "device",
}));
vi.mock("@/services/api/chatService", () => ({
  streamChatResponse: (...args: unknown[]) => stream(...args),
  prepareHistoryForLLM: () => prepareHistory(),
}));
vi.mock("@/services/api/skillService", () => ({
  resolveSkillsForMessage: () => resolveSkills(),
}));
const sourceAssert = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("@/lib/intelligentUi/sourceContext", () => ({
  createActiveUiSourceScope: async () => ({
    load: async () => ({}),
    assertValid: sourceAssert,
    assertDispatchValid: sourceAssert,
  }),
  getActiveUiSourceContextKey: () => "authority",
  resolveBlockUiProjectionData: async () => ({ sourceSummary: [] }),
}));
vi.mock("@/store/sessionMessagePersistence", () => ({
  waitForSessionMessageWrites: vi.fn(async () => undefined),
}));
import { useSendMessageFlow } from "@/hooks/useSendMessageFlow";
import { waitForSessionMessageWrites } from "@/store/sessionMessagePersistence";
import { parseIntelligentUiText } from "@/lib/intelligentUi/parser";
import { projectUiBlock } from "@/lib/intelligentUi/projection";
import { API_INPUT_LIMITS } from "@/config/limits";

afterEach(cleanup);

function sendDraft(
  hook: { current: ReturnType<typeof useSendMessageFlow> },
  text = "Ask",
) {
  return hook.current.handleSendMessage(
    text,
    [],
    undefined,
    undefined,
    undefined,
    stageDraft.mock.lastCall![0].intelligentUiSend!.id,
  );
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function setup() {
  const deps = createChatFlowDeps();
  deps.addMessage = vi.fn(async (_session, message) => {
    state.activeMessages.push(message);
  });
  const source: UiChatSource = {
    sessionId: "session-1",
    messageId: "ui-message",
    blockId: state.activeMessages[0].outputBlocks![0].id,
    definitionRevision: 1,
    isActive: () => true,
  };
  return {
    deps,
    source,
    hook: renderHook(() => useSendMessageFlow(deps)).result,
  };
}

async function approve(
  hook: { current: ReturnType<typeof useSendMessageFlow> },
  source: UiChatSource,
) {
  let result!: Promise<import("@/lib/intelligentUi/bridgeTypes").UiSendResult>;
  let settled = false;
  const staged = stageDraft.mock.calls.length;
  act(() => {
    result = hook.current.handleUiSendMessage("Ask", source);
  });
  void result.then(() => {
    settled = true;
  });
  await waitFor(() =>
    expect(settled || stageDraft.mock.calls.length > staged).toBe(true),
  );
  if (!settled)
    act(() => {
      void sendDraft(hook);
    });
  return result;
}

beforeEach(() => {
  stageDraft.mockClear();
  vi.mocked(waitForSessionMessageWrites).mockReset();
  vi.mocked(waitForSessionMessageWrites).mockResolvedValue(undefined);
  const parsed = parseIntelligentUiText(
    '```intelligent-ui\n{"version":1,"title":"Form","summary":"Input"}\n<div>Input</div>\n```',
    { idPrefix: "ui", final: true },
  )[0];
  if (parsed.type !== "intelligent_ui") throw Error("fixture");
  parsed.block.staticSnapshot = "Latest visible answer";
  parsed.block.state = { secret: "HIDDEN_STATE_VALUE" };
  state.activeMessages = [
    {
      id: "ui-message",
      role: "model",
      content: "",
      timestamp: 0,
      outputBlocks: [parsed.block],
    },
  ];
  state.currentSessionId = "session-1";
  state.selectedModel = "test-provider/test-model";
  state.pendingSessionId = null;
  settings.system.enableIntelligentUi = true;
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    value: true,
  });
  sourceAssert.mockReset();
  sourceAssert.mockResolvedValue(undefined);
  stream.mockReset();
  stream.mockResolvedValue(undefined);
});

describe("host-owned intelligent UI sends", () => {
  it("stages only a composer draft, rejects duplicates, and preserves composer refs on cancel", async () => {
    const { deps, source, hook } = setup();
    deps.skillParameterValuesRef.current = { draft: { value: "untouched" } };
    let first!: Promise<unknown>;
    act(() => {
      first = hook.current.handleUiSendMessage("Ask", source);
    });
    await waitFor(() => expect(stageDraft).toHaveBeenCalledOnce());
    expect(await hook.current.handleUiSendMessage("Again", source)).toEqual({
      ok: false,
      code: "busy",
    });
    expect(deps.processPromptForModel).not.toHaveBeenCalled();
    expect(deps.addMessage).not.toHaveBeenCalled();
    expect(stream).not.toHaveBeenCalled();
    expect(stageDraft.mock.lastCall![0]).toMatchObject({
      sessionId: source.sessionId,
      text: "Ask",
      intelligentUiSend: {
        id: expect.any(String),
        cancel: expect.any(Function),
      },
    });
    act(() => stageDraft.mock.lastCall![0].intelligentUiSend!.cancel());
    expect(await first).toEqual({ ok: false, code: "cancelled" });
    expect(deps.skillParameterValuesRef.current).toEqual({
      draft: { value: "untouched" },
    });
  });

  it("sends edited text, attachments and forced references with the frozen UI context", async () => {
    const { deps, source, hook } = setup();
    let receipt!: Promise<unknown>;
    act(() => {
      receipt = hook.current.handleUiSendMessage("Original question", source);
    });
    await waitFor(() => expect(stageDraft).toHaveBeenCalledOnce());
    const attachment = {
      id: "attachment",
      mimeType: "text/plain",
      fileName: "notes.txt",
      url: "opfs://notes.txt",
    };
    const forced = { skillIds: ["skill"], pluginIds: ["plugin"] };
    await act(() =>
      hook.current.handleSendMessage(
        "Edited question",
        [attachment],
        undefined,
        undefined,
        forced,
        stageDraft.mock.lastCall![0].intelligentUiSend!.id,
      ),
    );
    expect(await receipt).toEqual({ ok: true, messageId: "user-1" });
    expect(deps.processPromptForModel).toHaveBeenCalledWith(
      expect.anything(),
      "Edited question",
      [attachment],
      expect.anything(),
      undefined,
      undefined,
      state.selectedModel,
    );
    await waitFor(() => expect(stream).toHaveBeenCalledOnce());
    expect(stream.mock.calls[0][17]).toMatchObject({
      intelligentUiSource: {
        messageId: source.messageId,
        blockId: source.blockId,
      },
    });
  });

  it("does not send an expired draft through the ordinary chat path", async () => {
    const { deps, source, hook } = setup();
    let receipt!: Promise<unknown>;
    act(() => {
      receipt = hook.current.handleUiSendMessage("Ask", source);
    });
    await waitFor(() => expect(stageDraft).toHaveBeenCalledOnce());
    source.isActive = () => false;
    await waitFor(() => expect(receipt).resolves.toMatchObject({ ok: false }));
    await act(async () => expect(await sendDraft(hook)).toBe(false));
    expect(deps.processPromptForModel).not.toHaveBeenCalled();
    expect(deps.addMessage).not.toHaveBeenCalled();
    expect(stream).not.toHaveBeenCalled();
  });

  it("retains a draft when edited text exceeds the chat input limit", async () => {
    const { deps, source, hook } = setup();
    act(() => {
      void hook.current.handleUiSendMessage("Ask", source);
    });
    await waitFor(() => expect(stageDraft).toHaveBeenCalledOnce());
    await act(async () =>
      expect(
        await sendDraft(
          hook,
          "x".repeat(API_INPUT_LIMITS.maxChatTextChars + 1),
        ),
      ).toBe(false),
    );
    expect(deps.addMessage).not.toHaveBeenCalled();
    expect(stream).not.toHaveBeenCalled();
    expect(deps.showActionError).toHaveBeenCalledWith(
      "intelligentUiInvalidMessage",
    );
    await act(async () =>
      expect(await sendDraft(hook, "Short question")).toBe(true),
    );
  });

  it("cancels during asynchronous preparation without reviving the draft", async () => {
    const { deps, source, hook } = setup();
    const prepared = deferred<void>();
    const process = vi
      .mocked(deps.processPromptForModel)
      .getMockImplementation()!;
    vi.mocked(deps.processPromptForModel).mockImplementationOnce(
      async (...args) => {
        await prepared.promise;
        return process(...args);
      },
    );
    let receipt!: Promise<unknown>;
    act(() => {
      receipt = hook.current.handleUiSendMessage("Ask", source);
    });
    await waitFor(() => expect(stageDraft).toHaveBeenCalledOnce());
    let attempt!: Promise<boolean | void>;
    act(() => {
      attempt = sendDraft(hook);
    });
    await waitFor(() =>
      expect(deps.processPromptForModel).toHaveBeenCalledOnce(),
    );
    act(() => stageDraft.mock.lastCall![0].intelligentUiSend!.cancel());
    await act(async () => {
      prepared.resolve();
      expect(await attempt).toBe(false);
    });
    expect(await receipt).toEqual({ ok: false, code: "cancelled" });
    expect(deps.addMessage).not.toHaveBeenCalled();
    expect(stream).not.toHaveBeenCalled();
    await Promise.resolve();
    act(() => {
      void hook.current.handleUiSendMessage("New draft", source);
    });
    await waitFor(() => expect(stageDraft).toHaveBeenCalledTimes(2));
  });

  it("invalidates a pending draft when an unrelated composer send replaces it", async () => {
    const { deps, source, hook } = setup();
    let pending!: Promise<unknown>;
    act(() => {
      pending = hook.current.handleUiSendMessage("Frame request", source);
    });
    await waitFor(() => expect(stageDraft).toHaveBeenCalledOnce());
    await act(() => hook.current.handleSendMessage("Composer request", []));
    expect(await pending).toEqual({ ok: false, code: "inactive" });
    expect(deps.processPromptForModel).toHaveBeenCalledWith(
      expect.anything(),
      "Composer request",
      [],
      expect.anything(),
      undefined,
      undefined,
      state.selectedModel,
    );
  });

  it("keeps frozen context even if local state changes before manual send", async () => {
    const { source, hook } = setup();
    let pending!: Promise<unknown>;
    act(() => {
      pending = hook.current.handleUiSendMessage("Ask", source);
    });
    await waitFor(() => expect(stageDraft).toHaveBeenCalledOnce());
    const blockBeforeEdit = state.activeMessages[0].outputBlocks![0];
    if (blockBeforeEdit.type !== "intelligent_ui") throw Error("fixture");
    const preview = projectUiBlock(blockBeforeEdit, {
      purpose: "model-continuation",
      locale: "en",
      sourceSummary: [],
    });
    const block = state.activeMessages[0].outputBlocks![0];
    if (block.type === "intelligent_ui")
      block.staticSnapshot = "Changed after preview";
    await act(() => sendDraft(hook));
    expect(await pending).toEqual({ ok: true, messageId: "user-1" });
    const options = stream.mock.calls[0][17] as {
      intelligentUiSource: { content: string };
    };
    expect(options.intelligentUiSource.content).toBe(preview);
    expect(preview).not.toContain("Changed after preview");
  });

  it("keeps a failed-save draft available for explicit retry without sending", async () => {
    const { deps, source, hook } = setup();
    vi.mocked(waitForSessionMessageWrites).mockRejectedValueOnce(
      new Error("disk full"),
    );
    let pending!: Promise<unknown>;
    act(() => {
      pending = hook.current.handleUiSendMessage("Ask", source);
    });
    await waitFor(() => expect(stageDraft).toHaveBeenCalledOnce());
    await act(() => sendDraft(hook));
    expect(deps.showActionError).toHaveBeenCalledWith("disk full");
    expect(deps.addMessage).not.toHaveBeenCalled();
    expect(stream).not.toHaveBeenCalled();
    await act(() => sendDraft(hook));
    expect(await pending).toEqual({ ok: true, messageId: "user-1" });
  });

  it("revalidates the instance after waiting for durable writes", async () => {
    const { deps, source, hook } = setup();
    const write = deferred<void>();
    vi.mocked(waitForSessionMessageWrites).mockReturnValueOnce(write.promise);
    let pending!: Promise<unknown>;
    act(() => {
      pending = hook.current.handleUiSendMessage("Ask", source);
    });
    await waitFor(() => expect(stageDraft).toHaveBeenCalledOnce());
    let confirmation!: Promise<boolean | void>;
    act(() => {
      confirmation = sendDraft(hook);
    });
    source.isActive = () => false;
    await act(async () => {
      write.resolve();
      await confirmation;
    });
    expect(await pending).toEqual({ ok: false, code: "inactive" });
    expect(deps.addMessage).not.toHaveBeenCalled();
    expect(stream).not.toHaveBeenCalled();
  });

  it("rejects an expired instance before manual send", async () => {
    const { deps, source, hook } = setup();
    let pending!: Promise<unknown>;
    act(() => {
      pending = hook.current.handleUiSendMessage("Ask", source);
    });
    await waitFor(() => expect(stageDraft).toHaveBeenCalledOnce());
    source.isActive = () => false;
    await act(() => sendDraft(hook));
    expect(await pending).toEqual({ ok: false, code: "inactive" });
    expect(deps.addMessage).not.toHaveBeenCalled();
    expect(stream).not.toHaveBeenCalled();
  });

  it("returns a failure receipt and allows retrying the same draft when preparation throws", async () => {
    const { deps, source, hook } = setup();
    vi.mocked(deps.prepareComposerSkillParameters).mockRejectedValueOnce(
      new Error("preparation failed"),
    );
    expect(await approve(hook, source)).toEqual({
      ok: false,
      code: "send_failed",
    });
    await waitFor(() => expect(deps.addMessage).not.toHaveBeenCalled());
    // The rejected operation's finalizer runs before another browser event.
    await Promise.resolve();
    await act(async () => expect(await sendDraft(hook)).toBe(true));
    await waitFor(() =>
      expect(deps.finishActiveGeneration).toHaveBeenCalledOnce(),
    );
  });

  it("blocks UI while composer prepares skills", async () => {
    const { deps, source, hook } = setup();
    const pending =
      deferred<
        Awaited<ReturnType<typeof deps.prepareComposerSkillParameters>>
      >();
    vi.mocked(deps.prepareComposerSkillParameters).mockReturnValue(
      pending.promise,
    );
    const preparation = hook.current.prepareComposerSend();
    expect(await approve(hook, source)).toEqual({
      ok: false,
      code: "busy",
    });
    pending.resolve(null);
    await preparation;
  });

  it.each(["branch", "setting", "model", "lease"])(
    "revalidates %s after async preparation",
    async (change) => {
      const { deps, source, hook } = setup();
      const pending =
        deferred<
          Awaited<ReturnType<typeof deps.prepareComposerSkillParameters>>
        >();
      vi.mocked(deps.prepareComposerSkillParameters).mockReturnValue(
        pending.promise,
      );
      const sending = approve(hook, source);
      await waitFor(() =>
        expect(deps.prepareComposerSkillParameters).toHaveBeenCalled(),
      );
      if (change === "branch") state.activeMessages = [];
      if (change === "setting") settings.system.enableIntelligentUi = false;
      if (change === "model") state.selectedModel = "other";
      if (change === "lease") source.isActive = () => false;
      pending.resolve({
        skillParameterValues: {},
        skillBundleParameterValues: {},
      });
      expect(await sending).toEqual({
        ok: false,
        code: change === "model" ? "model_unavailable" : "inactive",
      });
      expect(deps.addMessage).not.toHaveBeenCalled();
    },
  );

  it("acknowledges insertion without waiting for generation; freezes the latest snapshot for compressed history", async () => {
    const { deps, source, hook } = setup();
    const output = deferred<void>();
    stream.mockImplementation(() => output.promise);
    expect(await approve(hook, source)).toEqual({
      ok: true,
      messageId: "user-1",
    });
    await waitFor(() => expect(stream).toHaveBeenCalledOnce());
    const options = stream.mock.calls[0][17] as {
      intelligentUiSource: { content: string; messageId: string };
    };
    expect(options.intelligentUiSource.messageId).toBe("ui-message");
    expect(options.intelligentUiSource.content).toContain(
      "Latest visible answer",
    );
    expect(options.intelligentUiSource.content).toContain("intelligent-ui");
    expect(options.intelligentUiSource.content).not.toContain(
      "HIDDEN_STATE_VALUE",
    );
    expect(deps.messageInputRef.current).toBeNull();
    expect(await hook.current.handleUiSendMessage("Again", source)).toEqual({
      ok: false,
      code: "busy",
    });
    output.resolve();
    await waitFor(() =>
      expect(deps.finishActiveGeneration).toHaveBeenCalledOnce(),
    );
  });

  it("revalidates after prompt preparation before inserting", async () => {
    const { deps, source } = setup();
    const original = deps.processPromptForModel;
    deps.processPromptForModel = vi.fn(
      async (...args: Parameters<typeof original>) => {
        const result = await original(...args);
        state.currentSessionId = "other";
        return result;
      },
    );
    const freshHook = renderHook(() => useSendMessageFlow(deps)).result;
    expect(await approve(freshHook, source)).toEqual({
      ok: false,
      code: "inactive",
    });
    expect(deps.addMessage).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    "does not write fallback messages when prompt preparation rejects (branch changed: %s)",
    async (branchChanged) => {
      const { deps, source, hook } = setup();
      const preparation = deferred<void>();
      vi.mocked(deps.processPromptForModel).mockImplementation(async () => {
        await preparation.promise;
        throw new Error("prompt preparation failed");
      });
      const sending = approve(hook, source);
      await waitFor(() =>
        expect(deps.prepareComposerSkillParameters).toHaveBeenCalled(),
      );
      await waitFor(() =>
        expect(deps.processPromptForModel).toHaveBeenCalledOnce(),
      );
      if (branchChanged) state.activeMessages = [];
      preparation.resolve();
      expect(await sending).toEqual({
        ok: false,
        code: branchChanged ? "inactive" : "send_failed",
      });
      await waitFor(() =>
        expect(deps.finishActiveGeneration).toHaveBeenCalledOnce(),
      );
      expect(deps.addMessage).not.toHaveBeenCalled();
      expect(deps.updateMessage).not.toHaveBeenCalled();
      expect(deps.syncActiveSession).not.toHaveBeenCalled();
      expect(stream).not.toHaveBeenCalled();
    },
  );

  it.each([false, true])(
    "reports actual insertion when persistence rejects (inserted: %s)",
    async (inserted) => {
      const { deps, source, hook } = setup();
      vi.mocked(deps.addMessage).mockImplementation(
        async (_session, message) => {
          if (inserted) state.activeMessages.push(message);
          throw new Error("storage failed");
        },
      );
      const response = await approve(hook, source);
      expect(response).toEqual(
        inserted
          ? { ok: true, messageId: "user-1" }
          : { ok: false, code: "send_failed" },
      );
      await waitFor(() =>
        expect(deps.finishActiveGeneration).toHaveBeenCalledOnce(),
      );
      expect(deps.addMessage).toHaveBeenCalledOnce();
      expect(
        state.activeMessages.filter((message) => message.role === "user"),
      ).toHaveLength(inserted ? 1 : 0);
      if (inserted)
        expect(deps.showActionError).toHaveBeenCalledWith("storage failed");
    },
  );

  it("keeps the successful receipt if creating the assistant placeholder fails", async () => {
    const { deps, source, hook } = setup();
    vi.mocked(deps.addMessage).mockImplementation(async (_session, message) => {
      if (message.role === "model") throw new Error("placeholder failed");
      state.activeMessages.push(message);
    });
    expect(await approve(hook, source)).toEqual({
      ok: true,
      messageId: "user-1",
    });
    await waitFor(() =>
      expect(deps.finishActiveGeneration).toHaveBeenCalledOnce(),
    );
    expect(deps.updateMessage).toHaveBeenCalledWith(
      "session-1",
      expect.any(String),
      expect.objectContaining({
        generationError: expect.objectContaining({
          message: "placeholder failed",
        }),
      }),
    );
  });

  it("rejects offline, unavailable models and remote generation", async () => {
    const { source, hook } = setup();
    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      value: false,
    });
    expect(await approve(hook, source)).toEqual({
      ok: false,
      code: "offline",
    });
    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      value: true,
    });
    state.selectedModel = "";
    expect(await approve(hook, source)).toEqual({
      ok: false,
      code: "model_unavailable",
    });
    state.selectedModel = "test-provider/test-model";
    state.activeMessages[0].generation = {
      status: "streaming",
      requestId: "remote",
      ownerDeviceId: "other-device",
      model: state.selectedModel,
      attempt: 0,
      checkpointAt: 0,
    };
    expect(await approve(hook, source)).toEqual({
      ok: false,
      code: "busy",
    });
  });
});

it("revalidates precise sources after manual send without accepting a message", async () => {
  const { deps, source, hook } = setup();
  let result!: Promise<unknown>;
  act(() => {
    result = hook.current.handleUiSendMessage("Ask", source);
  });
  await waitFor(() => expect(stageDraft).toHaveBeenCalledOnce());
  sourceAssert.mockRejectedValueOnce(new Error("UI_SOURCE_STALE"));
  await act(async () => {
    await sendDraft(hook);
  });
  expect(await result).toEqual({ ok: false, code: "inactive" });
  expect(deps.addMessage).not.toHaveBeenCalled();
  expect(stream).not.toHaveBeenCalled();
});

it("rejects a model removed from the latest model list while the draft is pending", async () => {
  const deps = createChatFlowDeps();
  deps.addMessage = vi.fn();
  const source: UiChatSource = {
    sessionId: "session-1",
    messageId: "ui-message",
    blockId: state.activeMessages[0].outputBlocks![0].id,
    definitionRevision: 1,
    isActive: () => true,
  };
  const { result, rerender } = renderHook(() => useSendMessageFlow(deps));
  let receipt!: Promise<unknown>;
  act(() => {
    receipt = result.current.handleUiSendMessage("Ask", source);
  });
  await waitFor(() => expect(stageDraft).toHaveBeenCalledOnce());
  deps.availableModels = [];
  rerender();
  await act(async () => {
    await sendDraft(result);
  });
  expect(await receipt).toEqual({ ok: false, code: "model_unavailable" });
  expect(deps.addMessage).not.toHaveBeenCalled();
});

it("rejects source revocation during asynchronous prompt processing", async () => {
  const { deps, source, hook } = setup();
  const process = deps.processPromptForModel;
  deps.processPromptForModel = vi.fn(async (...args) => {
    const output = await process(...(args as Parameters<typeof process>));
    sourceAssert.mockRejectedValueOnce(new Error("UI_SOURCE_STALE"));
    return output;
  });
  // Re-render with the updated dependency before creating the proposal.
  const current = renderHook(() => useSendMessageFlow(deps)).result;
  expect(await approve(current, source)).toEqual({
    ok: false,
    code: "inactive",
  });
  expect(deps.addMessage).not.toHaveBeenCalled();
  expect(stream).not.toHaveBeenCalled();
  void hook;
});

it("keeps the accepted user message but blocks dispatch after history preparation revokes runtime", async () => {
  const { deps, source, hook } = setup();
  let active = true;
  source.isActive = () => active;
  prepareHistory.mockImplementationOnce(async () => {
    active = false;
    return [];
  });
  expect(await approve(hook, source)).toMatchObject({ ok: true });
  await waitFor(() => expect(deps.updateMessage).toHaveBeenCalled());
  expect(stream).not.toHaveBeenCalled();
  expect(state.activeMessages.some((message) => message.role === "user")).toBe(
    true,
  );
});

it("does not replay a pre-output failure after runtime revocation", async () => {
  const { deps, source, hook } = setup();
  let active = true;
  source.isActive = () => active;
  stream.mockImplementationOnce(async () => {
    active = false;
    throw new Error("network unavailable");
  });
  expect(await approve(hook, source)).toMatchObject({ ok: true });
  await waitFor(
    () =>
      expect(deps.updateMessage).toHaveBeenCalledWith(
        "session-1",
        expect.any(String),
        expect.objectContaining({
          generation: expect.objectContaining({ status: "interrupted" }),
        }),
      ),
    { timeout: 2500 },
  );
  expect(stream).toHaveBeenCalledTimes(1);
  expect(
    state.activeMessages.filter((message) => message.role === "user"),
  ).toHaveLength(1);
});

it("rejects revoked authorization after a suspended skill read", async () => {
  const { deps, source, hook } = setup();
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  let started!: () => void;
  const preparing = new Promise<void>((resolve) => {
    started = resolve;
  });
  resolveSkills.mockImplementationOnce(async () => {
    started();
    await barrier;
    return { context: "", invocations: [], skippedSkillIds: [] };
  });
  expect(await approve(hook, source)).toMatchObject({ ok: true });
  await preparing;
  settings.system.enableIntelligentUi = false;
  release();
  await waitFor(() =>
    expect(deps.updateMessage).toHaveBeenCalledWith(
      "session-1",
      expect.any(String),
      expect.objectContaining({
        generationError: expect.objectContaining({
          code: "UI_SOURCE_STALE",
          recoverable: false,
        }),
      }),
    ),
  );
  expect(stream).not.toHaveBeenCalled();
});
