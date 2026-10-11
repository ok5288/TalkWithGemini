import { describe, expect, it, vi } from "vitest";
import { createSessionCreationGate } from "@/lib/chat/sessionCreationGate";

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function setup() {
  let state = {
    currentSessionId: "existing" as string | null,
    pendingSessionId: null as string | null,
    isActiveSessionLoading: false,
  };
  const listeners = new Set<() => void>();
  const write = deferred();
  const waitForWrites = vi.fn(() => write.promise);
  const gate = createSessionCreationGate({
    selection: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    waitForWrites,
  });
  return {
    gate,
    write,
    waitForWrites,
    listeners,
    change: (id: string) => {
      state = { ...state, currentSessionId: id };
      listeners.forEach((listener) => listener());
    },
  };
}

describe("session creation persistence boundary", () => {
  it("waits for the leaving session before model/config/create mutations", async () => {
    const { gate, write, waitForWrites, listeners } = setup();
    const commit = vi.fn();
    const error = vi.fn();
    const result = gate.run(async () => "agent profile", commit, error);
    await Promise.resolve();
    expect(waitForWrites).toHaveBeenCalledWith("existing");
    expect(commit).not.toHaveBeenCalled();
    write.resolve();
    await result;
    expect(commit).toHaveBeenCalledWith("agent profile");
    expect(error).not.toHaveBeenCalled();
    expect(listeners.size).toBe(0);
  });
  it("preserves the existing session and reports a failed flush", async () => {
    const { gate, write } = setup();
    const commit = vi.fn();
    const error = vi.fn();
    const result = gate.run(async () => undefined, commit, error);
    const failure = new Error("disk full");
    write.reject(failure);
    await result;
    expect(commit).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(failure);
  });
  it("does not revive a stale creation after switching away and back", async () => {
    const { gate, write, change } = setup();
    const commit = vi.fn();
    const result = gate.run(async () => undefined, commit, vi.fn());
    await Promise.resolve();
    change("other");
    change("existing");
    write.resolve();
    await result;
    expect(commit).not.toHaveBeenCalled();
  });
  it("allows only the latest concurrent creation intent to commit", async () => {
    const { gate, write } = setup();
    const first = vi.fn();
    const second = vi.fn();
    const pending = gate.run(async () => undefined, first, vi.fn());
    await Promise.resolve();
    const latest = gate.run(async () => undefined, second, vi.fn());
    write.resolve();
    await Promise.all([pending, latest]);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
  });
  it("sidebar selection cancels creation even before selection changes in the store", async () => {
    const { gate, write } = setup();
    const commit = vi.fn();
    const pending = gate.run(async () => undefined, commit, vi.fn());
    await Promise.resolve();
    gate.cancel();
    write.resolve();
    await pending;
    expect(commit).not.toHaveBeenCalled();
  });
});
