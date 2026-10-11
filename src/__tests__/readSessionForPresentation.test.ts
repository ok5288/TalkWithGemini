import { describe, expect, it, vi } from "vitest";
import type { Message, Session } from "@/types";

const { appDb, waitForSessionMessageWrites, chatStoreState } = vi.hoisted(
  () => ({
    appDb: { getItem: vi.fn() },
    waitForSessionMessageWrites: vi.fn<() => Promise<void> | undefined>(
      () => undefined,
    ),
    chatStoreState: {
      currentSessionId: "session-1" as string | null,
      activeMessages: [] as Message[],
      activeMessageTree: undefined,
      sessions: [] as Session[],
    },
  }),
);

vi.mock("@/store/storage/storageConfig", () => ({ appDb }));
vi.mock("@/store/sessionMessagePersistence", () => ({
  waitForSessionMessageWrites,
}));
vi.mock("@/store/core/chatStore", () => ({
  useChatStore: { getState: () => chatStoreState },
}));

import { readMessageForPresentation } from "@/lib/chat/readSessionForPresentation";

const session: Session = {
  id: "session-1",
  title: "Session",
  updatedAt: 1,
  model: "test-model",
  pinned: false,
  messageCount: 1,
};

function message(content: string): Message {
  return { id: "model-1", role: "model", content, timestamp: 1 };
}

describe("readMessageForPresentation", () => {
  it("returns the message after the persistence barrier resolves", async () => {
    const stale = message("stale");
    const fresh = message("fresh");
    chatStoreState.sessions = [session];
    chatStoreState.activeMessages = [stale];
    const release = deferred();
    waitForSessionMessageWrites.mockReturnValueOnce(release.promise);

    const pending = readMessageForPresentation("session-1", "model-1");
    chatStoreState.activeMessages = [fresh];
    release.resolve();

    await expect(pending).resolves.toMatchObject({
      session,
      message: fresh,
    });
    expect(waitForSessionMessageWrites).toHaveBeenCalledWith("session-1");
    expect(appDb.getItem).not.toHaveBeenCalled();
  });

  it("does not silently read a missing message", async () => {
    chatStoreState.sessions = [session];
    chatStoreState.activeMessages = [message("other")];

    await expect(
      readMessageForPresentation("session-1", "missing"),
    ).rejects.toThrow("MESSAGE_NOT_FOUND");
  });
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}
