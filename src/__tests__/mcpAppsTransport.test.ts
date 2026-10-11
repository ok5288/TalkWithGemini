// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { McpAppTransport } from "@/lib/mcpApps/transport";

function setup() {
  const target = { postMessage: vi.fn() } as unknown as Window;
  let current = true;
  const transport = new McpAppTransport(
    target,
    "https://sandbox.example",
    () => current,
  );
  const receive = vi.fn();
  transport.onmessage = receive;
  const dispatch = (
    data: unknown,
    origin = "https://sandbox.example",
    source = target,
  ) =>
    window.dispatchEvent(new MessageEvent("message", { data, origin, source }));
  return {
    target,
    transport,
    receive,
    dispatch,
    expire: () => {
      current = false;
    },
  };
}
const init = {
  jsonrpc: "2.0",
  id: 1,
  method: "ui/initialize",
  params: {
    appInfo: { name: "test", version: "1" },
    appCapabilities: {},
    protocolVersion: "2026-01-26",
  },
};
const initializeResult = {
  protocolVersion: "2026-01-26",
  hostInfo: { name: "host", version: "1" },
  hostCapabilities: {},
  hostContext: {},
};

describe("MCP Apps exact-window transport", () => {
  it("rejects forged origin/window, malformed, oversized, duplicate and expired requests", async () => {
    const s = setup();
    await s.transport.start();
    s.dispatch(init, "null");
    s.dispatch(init, "https://sandbox.example", window);
    s.dispatch({ hello: "world" });
    s.dispatch({ ...init, params: { value: "x".repeat(260_000) } });
    expect(s.receive).not.toHaveBeenCalled();
    s.dispatch(init);
    s.dispatch({ jsonrpc: "2.0", id: 1, method: "ping" });
    expect(s.receive).toHaveBeenCalledTimes(1);
    s.expire();
    s.dispatch({ ...init, id: 2 });
    expect(s.receive).toHaveBeenCalledTimes(1);
    await expect(s.transport.send(init as never)).rejects.toThrow(
      "instance_expired",
    );
    await s.transport.close();
  });
  it("closes on a duplicate initialization without forwarding another request", async () => {
    const s = setup();
    const error = vi.fn();
    s.transport.onerror = error;
    await s.transport.start();
    s.dispatch(init);
    s.dispatch({ ...init, id: 2 });
    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({ message: "duplicate_initialization" }),
    );
    s.dispatch({ jsonrpc: "2.0", id: 3, method: "ping" });
    expect(s.receive).toHaveBeenCalledTimes(1);
    await s.transport.close();
  });
  it.each([
    {},
    { ...initializeResult, protocolVersion: "2099-01-01" },
    { ...initializeResult, hostContext: { theme: 42 } },
  ])("rejects invalid initialize results before delivery", async (result) => {
    const s = setup();
    const error = vi.fn();
    s.transport.onerror = error;
    await s.transport.start();
    s.dispatch(init);
    await expect(
      s.transport.send({ jsonrpc: "2.0", id: 1, result } as never),
    ).rejects.toThrow("invalid_initialize_result");
    expect(s.target.postMessage).not.toHaveBeenCalled();
    s.dispatch({ jsonrpc: "2.0", method: "ui/notifications/initialized" });
    expect(s.receive).toHaveBeenCalledTimes(1);
    await s.transport.close();
  });
  it("rejects malformed initialized notifications after a valid initialize response", async () => {
    const s = setup();
    const error = vi.fn();
    s.transport.onerror = error;
    await s.transport.start();
    s.dispatch(init);
    await s.transport.send({ jsonrpc: "2.0", id: 1, result: initializeResult });
    s.dispatch({
      jsonrpc: "2.0",
      method: "ui/notifications/initialized",
      id: 2,
    });
    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({ message: "invalid_initialized_notification" }),
    );
    expect(s.receive).toHaveBeenCalledTimes(1);
    await s.transport.close();
  });
  it("drops cyclic and BigInt payloads without escaping the listener or entering the SDK", async () => {
    const s = setup();
    const error = vi.fn((event: ErrorEvent) => event.preventDefault());
    window.addEventListener("error", error);
    await s.transport.start();
    try {
      const cyclic: Record<string, unknown> = {};
      cyclic.self = cyclic;
      s.dispatch({ ...init, params: cyclic });
      s.dispatch({ ...init, params: { value: BigInt(1) } });
      expect(error).not.toHaveBeenCalled();
      expect(s.receive).not.toHaveBeenCalled();
      expect(s.target.postMessage).not.toHaveBeenCalled();
      // Invalid messages must not consume the request id or poison the instance.
      s.dispatch(init);
      expect(s.receive).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener("error", error);
      await s.transport.close();
    }
  });
  it("returns standard unsupported errors without forwarding tool or messaging authority", async () => {
    const s = setup();
    await s.transport.start();
    for (const [id, method] of [
      "tools/call",
      "resources/read",
      "ui/message",
      "ui/open-link",
      "ui/update-model-context",
    ].entries())
      s.dispatch({ jsonrpc: "2.0", id, method, params: {} });
    expect(s.receive).not.toHaveBeenCalled();
    expect(s.target.postMessage).toHaveBeenCalledTimes(5);
    expect(s.target.postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({ code: -32601 }),
      }),
      "https://sandbox.example",
    );
    await s.transport.close();
  });
  it("drains teardown responses while denying new requests, then releases listener", async () => {
    const s = setup();
    await s.transport.start();
    s.transport.drain();
    s.expire();
    s.dispatch(init);
    s.dispatch({ jsonrpc: "2.0", id: 8, result: {} });
    expect(s.receive).toHaveBeenCalledTimes(1);
    await s.transport.close();
    s.dispatch({ jsonrpc: "2.0", id: 9, result: {} });
    expect(s.receive).toHaveBeenCalledTimes(1);
  });
});
