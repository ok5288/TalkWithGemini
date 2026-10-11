// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMcpAppRuntime } from "@/lib/mcpApps/runtime";

function harness() {
  const sent: Record<string, unknown>[] = [];
  const target = {
    postMessage: vi.fn((message) => sent.push(message)),
  } as unknown as Window;
  const phase = vi.fn();
  const height = vi.fn();
  let current = true;
  const runtime = createMcpAppRuntime({
    target,
    origin: "https://sandbox.example",
    html: "<p>App</p>",
    result: { content: [{ type: "text", text: "Visible" }] },
    current: () => current,
    onPhase: phase,
    onHeight: height,
    theme: "light",
    locale: "en",
  });
  const dispatch = (message: unknown) =>
    window.dispatchEvent(
      new MessageEvent("message", {
        source: target,
        origin: "https://sandbox.example",
        data: message,
      }),
    );
  const notify = (method: string, params?: unknown) =>
    dispatch({ jsonrpc: "2.0", method, ...(params ? { params } : {}) });
  const initialize = async () => {
    await runtime.start();
    notify("ui/notifications/sandbox-proxy-ready", {});
    dispatch({
      jsonrpc: "2.0",
      id: 1,
      method: "ui/initialize",
      params: {
        appInfo: { name: "fixture", version: "1" },
        appCapabilities: {},
        protocolVersion: "2026-01-26",
      },
    });
    await vi.waitFor(() =>
      expect(sent.some((message) => message.id === 1)).toBe(true),
    );
    notify("ui/notifications/initialized");
    await vi.waitFor(() =>
      expect(
        sent.some(
          (message) => message.method === "ui/notifications/tool-result",
        ),
      ).toBe(true),
    );
  };
  return {
    runtime,
    phase,
    height,
    sent,
    dispatch,
    notify,
    initialize,
    expire: () => {
      current = false;
    },
  };
}
afterEach(() => vi.useRealTimers());

describe("official AppBridge restricted lifecycle", () => {
  it("negotiates official initialization then sends bounded display-only content once", async () => {
    const h = harness();
    await h.initialize();
    expect(h.phase).toHaveBeenLastCalledWith("ready");
    const result = h.sent.find((message) => message.id === 1)?.result as Record<
      string,
      unknown
    >;
    expect(result.hostCapabilities).toEqual({
      sandbox: { permissions: {}, csp: {} },
    });
    expect(
      h.sent.filter(
        (message) => message.method === "ui/notifications/tool-input",
      ),
    ).toHaveLength(1);
    h.notify("ui/notifications/size-changed", { height: 9999 });
    await vi.waitFor(() => expect(h.height).toHaveBeenCalledWith(720));
    h.runtime.loaded();
    h.runtime.loaded();
    expect(h.phase).toHaveBeenLastCalledWith("failed");
    await h.runtime.dispose();
  });
  it("fails early initialized and cannot be revived by later notifications", async () => {
    const h = harness();
    await h.runtime.start();
    h.notify("ui/notifications/sandbox-proxy-ready", {});
    h.notify("ui/notifications/initialized");
    expect(h.phase).toHaveBeenLastCalledWith("failed");
    h.notify("ui/notifications/initialized");
    expect(
      h.sent.some((m) => m.method === "ui/notifications/tool-result"),
    ).toBe(false);
    await h.runtime.dispose();
  });
  it("caches context during handshake then emits full context before tool data", async () => {
    const h = harness();
    h.runtime.context("dark", "ja");
    expect(h.sent).toHaveLength(0);
    await h.initialize();
    const contextMessages = h.sent.filter(
      (m) => m.method === "ui/notifications/host-context-changed",
    );
    const contextIndex = h.sent.indexOf(contextMessages[0]!);
    const toolIndex = h.sent.findIndex(
      (m) => m.method === "ui/notifications/tool-input",
    );
    expect(contextIndex).toBeGreaterThanOrEqual(0);
    expect(contextIndex).toBeLessThan(toolIndex);
    expect(contextMessages).toHaveLength(1);
    expect(contextMessages[0]?.params).toEqual({
      theme: "dark",
      locale: "ja",
      platform: "web",
      displayMode: "inline",
      availableDisplayModes: ["inline"],
      containerDimensions: { maxHeight: 720 },
    });
    h.runtime.loaded();
    h.runtime.loaded();
    await h.runtime.dispose();
  });
  it("sends a complete context for later updates, including unchanged fields", async () => {
    const h = harness();
    await h.initialize();
    const before = h.sent.filter(
      (message) => message.method === "ui/notifications/host-context-changed",
    ).length;

    h.runtime.context("dark", "ja");
    await vi.waitFor(() =>
      expect(
        h.sent.filter(
          (message) =>
            message.method === "ui/notifications/host-context-changed",
        ),
      ).toHaveLength(before + 1),
    );

    const contextMessages = h.sent.filter(
      (message) => message.method === "ui/notifications/host-context-changed",
    );
    expect(contextMessages.at(-1)?.params).toEqual({
      theme: "dark",
      locale: "ja",
      platform: "web",
      displayMode: "inline",
      availableDisplayModes: ["inline"],
      containerDimensions: { maxHeight: 720 },
    });
    await h.runtime.dispose();
  });
  it("fails a second sandbox proxy-ready notification", async () => {
    const h = harness();
    await h.runtime.start();
    h.notify("ui/notifications/sandbox-proxy-ready", {});
    await vi.waitFor(() =>
      expect(
        h.sent.some(
          (m) => m.method === "ui/notifications/sandbox-resource-ready",
        ),
      ).toBe(true),
    );
    h.notify("ui/notifications/sandbox-proxy-ready", {});
    expect(h.phase).toHaveBeenLastCalledWith("failed");
    expect(
      h.sent.filter(
        (m) => m.method === "ui/notifications/sandbox-resource-ready",
      ),
    ).toHaveLength(1);
    await h.runtime.dispose();
  });
  it("times out an unresponsive proxy and rejects late initialization", async () => {
    vi.useFakeTimers();
    const h = harness();
    await h.runtime.start();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(h.phase).toHaveBeenLastCalledWith("failed");
    h.notify("ui/notifications/sandbox-proxy-ready", {});
    expect(h.sent).toHaveLength(0);
    await h.runtime.dispose();
  });
  it("tears down within two seconds and never accepts expired UI updates", async () => {
    const h = harness();
    await h.initialize();
    vi.useFakeTimers();
    h.expire();
    const disposal = h.runtime.dispose();
    h.notify("ui/notifications/size-changed", { height: 200 });
    expect(h.height).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2001);
    await disposal;
    expect(
      h.sent.some((message) => message.method === "ui/resource-teardown"),
    ).toBe(true);
  });
});
