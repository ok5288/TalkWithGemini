import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createHtmlRuntime,
  createUiInstanceLease,
} from "@/lib/intelligentUi/instance";
import { flushHtmlRuntimeUpdates } from "@/lib/intelligentUi/runtimeFlush";

const port = {
  onmessage: null as null | ((event: { data: unknown }) => void),
  postMessage: vi.fn(),
  start: vi.fn(),
  close: vi.fn(),
};
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  vi.stubGlobal(
    "MessageChannel",
    class {
      port1 = port;
      port2 = {};
    },
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
function setup(sessionId?: string) {
  const callbacks = { onStatus: vi.fn(), onError: vi.fn(), onMessage: vi.fn() };
  const runtime = createHtmlRuntime({
    instanceId: "instance",
    sessionId,
    source: "<p/>",
    state: {},
    ...callbacks,
  });
  const target = { postMessage: vi.fn() } as unknown as Window;
  runtime.connect(target);
  const identity = vi.mocked(target.postMessage).mock.calls[0]![0].identity;
  const send = (type: string, value?: unknown) =>
    port.onmessage!({ data: { type, identity, value } });
  return { runtime, send, target, ...callbacks };
}
describe("instance lifecycle", () => {
  it.each(["invalid_update", "runtime_error"])(
    "retains validated initialization updates before %s terminates the instance",
    (cause) => {
      const r = setup();
      r.send("connected");
      r.send("state", { value: 1 });
      r.send("snapshot", "last legal snapshot");
      r.send("state", { value: 2 });
      expect(r.onMessage).not.toHaveBeenCalled();
      if (cause === "invalid_update")
        r.send("state", { text: "x".repeat(256 * 1024) });
      else r.send("error", { code: "script_error" });
      expect(r.onMessage.mock.calls).toEqual([
        ["snapshot", "last legal snapshot"],
        ["state", { value: 2 }],
      ]);
      expect(r.onError).toHaveBeenCalledWith(cause);
      r.send("ready");
      r.send("state", { late: true });
      expect(r.onMessage).toHaveBeenCalledTimes(2);
      expect(r.onStatus).not.toHaveBeenCalledWith("active");
      r.runtime.dispose();
    },
  );
  it("flushes buffered frame updates before acknowledging a session consumer", async () => {
    const r = setup("flush-session");
    r.send("connected");
    r.send("ready");
    const order: string[] = [];
    const pending = flushHtmlRuntimeUpdates("flush-session")!.then(() =>
      order.push("ack"),
    );
    const request = port.postMessage.mock.lastCall![0];
    expect(request.type).toBe("flush-updates");
    r.send("state", { value: 2 });
    order.push("state");
    r.send("snapshot", "two");
    order.push("snapshot");
    r.send("updates-flushed", { requestId: "wrong" });
    await Promise.resolve();
    expect(order).toEqual(["state", "snapshot"]);
    r.send("updates-flushed", { requestId: request.value.requestId });
    await pending;
    expect(order).toEqual(["state", "snapshot", "ack"]);
    r.runtime.dispose();
    expect(flushHtmlRuntimeUpdates("flush-session")).toBeUndefined();
  });
  it("rejects flush on timeout or disposal instead of accepting stale state", async () => {
    for (const cause of ["timeout", "dispose"]) {
      const r = setup("flush-failure");
      r.send("connected");
      r.send("ready");
      const rejected = expect(
        flushHtmlRuntimeUpdates("flush-failure"),
      ).rejects.toThrow("runtime_flush_failed");
      if (cause === "timeout") vi.advanceTimersByTime(1500);
      else r.runtime.dispose();
      await rejected;
      r.runtime.dispose();
      expect(flushHtmlRuntimeUpdates("flush-failure")).toBeUndefined();
    }
  });
  it("fails closed on oversized raw state and stops accepting later updates", () => {
    const r = setup();
    r.send("connected");
    r.send("ready");
    r.send("state", { value: 1 });
    r.send("state", { text: "x".repeat(256 * 1024) });
    r.send("state", { value: 2 });
    expect(r.onError).toHaveBeenCalledWith("invalid_update");
    expect(r.onMessage.mock.calls).toEqual([["state", { value: 1 }]]);
    r.runtime.dispose();
  });
  it("limits raw message floods independently of the SDK", () => {
    const r = setup();
    r.send("connected");
    r.send("ready");
    for (let index = 0; index < 121; index++) r.send("height", 1);
    expect(r.onError).toHaveBeenCalledWith("message_rate_limit");
    expect(port.close).toHaveBeenCalled();
    r.runtime.dispose();
  });
  it("connects without probing constructors on the opaque child window", () => {
    const postMessage = vi.fn();
    const read = vi.fn((_: object, key: string | symbol) => {
      if (key === "postMessage") return postMessage;
      throw new DOMException("Cross-origin access", "SecurityError");
    });
    const target = new Proxy({}, { get: read }) as Window;
    const onError = vi.fn();
    const runtime = createHtmlRuntime({
      instanceId: "opaque",
      source: "<p>Ready</p>",
      state: {},
      onStatus: vi.fn(),
      onMessage: vi.fn(),
      onError,
    });
    runtime.connect(target);
    expect(read.mock.calls.map(([, key]) => key)).toEqual(["postMessage"]);
    expect(postMessage).toHaveBeenCalledOnce();
    expect(onError).not.toHaveBeenCalled();
    runtime.dispose();
  });
  it("requires initialization and ready acknowledgement and initializes once", () => {
    const r = setup();
    r.send("ready");
    expect(r.onStatus).not.toHaveBeenCalled();
    r.send("connected");
    r.send("connected");
    expect(port.postMessage).toHaveBeenCalledTimes(1);
    r.send("ready");
    expect(r.onStatus).toHaveBeenCalledWith("active");
    vi.advanceTimersByTime(5000);
    expect(r.onError).not.toHaveBeenCalled();
    r.runtime.dispose();
  });
  it("closes timed out, errored and reloaded instances and drops late messages", () => {
    for (const cause of ["timeout", "error", "reload"]) {
      const r = setup();
      r.send("connected");
      if (cause === "timeout") vi.advanceTimersByTime(30000);
      else if (cause === "error") r.send("error", "bad");
      else r.runtime.connect(r.target);
      expect(r.onStatus).toHaveBeenCalledWith("failed");
      expect(port.close).toHaveBeenCalled();
      r.send("state", { late: true });
      expect(r.onMessage).not.toHaveBeenCalled();
      r.runtime.dispose();
    }
  });
  it("drops messages after disposal", () => {
    const r = setup();
    r.send("connected");
    r.send("ready");
    r.runtime.dispose();
    r.send("state", { late: true });
    expect(r.onMessage).not.toHaveBeenCalled();
  });
  it("invalidates a view lease regardless of later store eligibility", () => {
    let enabled = true;
    const lease = createUiInstanceLease(
      {
        sessionId: "s",
        messageId: "m",
        blockId: "b",
        definitionRevision: 1,
        epoch: 0,
      },
      () => enabled,
    );
    expect(lease.accepts()).toBe(true);
    enabled = false;
    expect(lease.accepts()).toBe(false);
    lease.dispose();
    enabled = true;
    expect(lease.accepts()).toBe(false);
  });
});

describe("send bridge", () => {
  it("processes snapshots before sending and deduplicates request IDs", async () => {
    vi.stubGlobal("navigator", { userActivation: { isActive: true } });
    const events: string[] = [];
    const sendMessage = vi.fn(async () => {
      events.push("send");
      return { ok: true as const, messageId: "m2" };
    });
    const runtime = createHtmlRuntime({
      instanceId: "send",
      source: "",
      state: {},
      onStatus: vi.fn(),
      onError: vi.fn(),
      onMessage: (type) => events.push(type),
      onSendMessage: sendMessage,
    });
    const target = { postMessage: vi.fn() } as unknown as Window;
    runtime.connect(target);
    const identity = vi.mocked(target.postMessage).mock.calls[0]![0].identity;
    const send = (type: string, value?: unknown) =>
      port.onmessage!({ data: { type, identity, value } });
    send("connected");
    send("ready");
    send("snapshot", "latest");
    send("send-message", { requestId: "1", text: "Explain" });
    send("send-message", { requestId: "1", text: "Explain" });
    send("send-message", { requestId: "2", text: "Again" });
    await vi.waitFor(() =>
      expect(port.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "send-result",
          value: { requestId: "1", result: { ok: true, messageId: "m2" } },
        }),
      ),
    );
    expect(events).toEqual(["snapshot", "send"]);
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(port.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        value: { requestId: "2", result: { ok: false, code: "busy" } },
      }),
    );
    runtime.dispose();
  });
  it("rejects requests without browser activation and updates environment without reinitializing", () => {
    vi.stubGlobal("navigator", { userActivation: { isActive: false } });
    const r = setup();
    r.send("connected");
    r.send("ready");
    r.send("send-message", { requestId: "1", text: "Hello", isTrusted: true });
    expect(port.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        value: {
          requestId: "1",
          result: { ok: false, code: "user_action_required" },
        },
      }),
    );
    r.runtime.updateEnvironment({
      colorScheme: "dark",
      color: "white",
      fontFamily: "serif",
      fontSize: "16px",
      lineHeight: "24px",
      variables: {},
    });
    expect(port.postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: "environment",
        value: expect.objectContaining({ colorScheme: "dark" }),
      }),
    );
    expect(r.onStatus).toHaveBeenCalledTimes(1);
    r.runtime.dispose();
  });
});
