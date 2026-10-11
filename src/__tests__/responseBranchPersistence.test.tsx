// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Message } from "@/types";

const { waitForSessionMessageWrites } = vi.hoisted(() => ({
  waitForSessionMessageWrites: vi.fn<
    (sessionId: string) => Promise<void> | undefined
  >(() => undefined),
}));

const chatStoreState = {
  currentSessionId: "session-1",
  pendingSessionId: null as string | null,
  isActiveSessionLoading: false,
  activeMessages: [] as Message[],
};

vi.mock("@/store/sessionMessagePersistence", () => ({
  waitForSessionMessageWrites,
}));

vi.mock("@/store/core/chatStore", () => ({
  useChatStore: { getState: () => chatStoreState },
}));

import { useResponseBranchFlow } from "@/hooks/useResponseBranchFlow";
import { createChatFlowDeps } from "./support/chatFlowDeps";

const userMessage: Message = {
  id: "user-1",
  role: "user",
  content: "Use the latest state",
  timestamp: 1,
};

function modelMessage(
  id: string,
  status: "completed" | "interrupted" = "completed",
): Message {
  return {
    id,
    role: "model",
    content: "old",
    timestamp: 2,
    generation: {
      status,
      requestId: `request-${id}`,
      ownerDeviceId: "device",
      model: "test-provider/test-model",
      attempt: 0,
      checkpointAt: 2,
    },
  };
}

describe("response branch persistence barriers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    chatStoreState.currentSessionId = "session-1";
    chatStoreState.pendingSessionId = null;
    chatStoreState.isActiveSessionLoading = false;
    chatStoreState.activeMessages = [];
    waitForSessionMessageWrites.mockReturnValue(undefined);
  });

  it("does not create a branch when the save barrier fails", async () => {
    const failure = Promise.reject(new Error("save failed"));
    // Prevent the rejected promise from becoming an unhandled rejection before
    // the hook awaits it.
    failure.catch(() => undefined);
    waitForSessionMessageWrites.mockReturnValue(failure);
    chatStoreState.activeMessages = [userMessage, modelMessage("model-1")];
    const deps = createChatFlowDeps({
      activeMessages: [userMessage, modelMessage("model-1")],
      addMessageVersion: vi.fn(() => "new-branch"),
    });
    const { result } = renderHook(() => useResponseBranchFlow(deps));

    await act(async () => {
      await result.current.handleRegenerate("model-1");
    });

    expect(waitForSessionMessageWrites).toHaveBeenCalledWith("session-1");
    expect(deps.addMessageVersion).not.toHaveBeenCalled();
    expect(deps.beginActiveGeneration).not.toHaveBeenCalled();
    expect(deps.showActionError).toHaveBeenCalledWith("errSaveChanges");
  });

  it("re-reads the target branch after the barrier instead of using stale props", async () => {
    const release = deferred();
    waitForSessionMessageWrites.mockReturnValue(release.promise);
    const staleMessage = modelMessage("stale-model");
    const freshMessage = modelMessage("fresh-model");
    chatStoreState.activeMessages = [userMessage, freshMessage];
    const deps = createChatFlowDeps({
      activeMessages: [userMessage, staleMessage],
      addMessageVersion: vi.fn(() => null),
    });
    const { result } = renderHook(() => useResponseBranchFlow(deps));

    let action!: Promise<void>;
    act(() => {
      action = result.current.handleRegenerate("fresh-model");
    });
    expect(deps.addMessageVersion).not.toHaveBeenCalled();

    await act(async () => {
      release.resolve();
      await action;
    });

    expect(deps.addMessageVersion).toHaveBeenCalledWith(
      "session-1",
      "fresh-model",
      "Test Model",
    );
  });

  it("rejects a branch if the session changes while saving", async () => {
    const release = deferred();
    waitForSessionMessageWrites.mockReturnValue(release.promise);
    chatStoreState.activeMessages = [userMessage, modelMessage("model-1")];
    const deps = createChatFlowDeps({
      activeMessages: [userMessage, modelMessage("model-1")],
      addMessageVersion: vi.fn(() => "new-branch"),
    });
    const { result } = renderHook(() => useResponseBranchFlow(deps));

    let action!: Promise<void>;
    act(() => {
      action = result.current.handleRegenerate("model-1");
    });
    chatStoreState.currentSessionId = "session-2";
    await act(async () => {
      release.resolve();
      await action;
    });

    expect(deps.addMessageVersion).not.toHaveBeenCalled();
    expect(deps.beginActiveGeneration).not.toHaveBeenCalled();
  });

  it("rejects a branch while the session switch is still pending", async () => {
    chatStoreState.pendingSessionId = "session-2";
    chatStoreState.activeMessages = [userMessage, modelMessage("model-1")];
    const deps = createChatFlowDeps({
      activeMessages: [userMessage, modelMessage("model-1")],
      addMessageVersion: vi.fn(() => "new-branch"),
    });
    const { result } = renderHook(() => useResponseBranchFlow(deps));

    await act(async () => {
      await result.current.handleRegenerate("model-1");
    });

    expect(deps.addMessageVersion).not.toHaveBeenCalled();
    expect(deps.beginActiveGeneration).not.toHaveBeenCalled();
  });

  it("coalesces duplicate regenerate clicks while the barrier is pending", async () => {
    const release = deferred();
    waitForSessionMessageWrites.mockReturnValue(release.promise);
    chatStoreState.activeMessages = [userMessage, modelMessage("model-1")];
    const deps = createChatFlowDeps({
      activeMessages: [userMessage, modelMessage("model-1")],
      addMessageVersion: vi.fn(() => null),
    });
    const { result } = renderHook(() => useResponseBranchFlow(deps));

    let first!: Promise<void>;
    let second!: Promise<void>;
    act(() => {
      first = result.current.handleRegenerate("model-1");
      second = result.current.handleRegenerate("model-1");
    });
    expect(waitForSessionMessageWrites).toHaveBeenCalledTimes(1);

    await act(async () => {
      release.resolve();
      await Promise.all([first, second]);
    });

    expect(deps.addMessageVersion).toHaveBeenCalledTimes(1);
  });

  it("releases the action lock when branch setup throws before streaming", async () => {
    chatStoreState.activeMessages = [userMessage, modelMessage("model-1")];
    const addMessageVersion = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error("branch setup failed");
      })
      .mockReturnValueOnce(null);
    const deps = createChatFlowDeps({
      activeMessages: [userMessage, modelMessage("model-1")],
      addMessageVersion,
    });
    const { result } = renderHook(() => useResponseBranchFlow(deps));

    await expect(result.current.handleRegenerate("model-1")).rejects.toThrow(
      "branch setup failed",
    );
    await act(async () => {
      await result.current.handleRegenerate("model-1");
    });

    expect(addMessageVersion).toHaveBeenCalledTimes(2);
  });
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}
