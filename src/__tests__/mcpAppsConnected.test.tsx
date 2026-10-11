// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import ConnectedMcpAppCard from "@/components/content/mcpApps/ConnectedMcpAppCard";
import { useSettingsStore } from "@/store/core/settingsStore";
import { useChatStore } from "@/store/core/chatStore";
import { normalizeMcpToolFunctions } from "@/lib/mcp/registry";
import { createPluginFunctionFingerprint } from "@/lib/plugin/confirmation";
import { DEFAULT_AGENT_PROFILE } from "@/lib/assistant/profile";
import { DEFAULT_SYSTEM_SETTINGS } from "@/config/defaults";
import type { Plugin } from "@/lib/plugin/types";
import type { ToolCall } from "@/lib/chat/types";
import messages from "@/i18n/locales/en/System.json";
const readResource = vi.hoisted(() => vi.fn());
vi.mock("@/services/api/mcpService", () => ({
  executeMcpCapability: readResource,
}));
vi.mock("@/store/core/settingsStore", async () => {
  const { create } = await import("zustand");
  return {
    useSettingsStore: create(() => ({
      system: {},
      installedPlugins: [],
      activePlugins: [],
      pluginConfigs: {},
    })),
  };
});
vi.mock("@/store/core/chatStore", async () => {
  const { create } = await import("zustand");
  return {
    useChatStore: create(() => ({
      currentSessionId: "session",
      workspaces: [],
      sessions: [],
      isActiveSessionLoading: false,
      pendingSessionId: null,
      activeMessages: [],
    })),
  };
});
const plugin: Plugin = {
  id: "p",
  title: "Server",
  description: "",
  logoUrl: "",
  manifestUrl: "",
  source: "mcp",
  mcp: {
    serverUrl: "https://mcp.example/mcp",
    transport: "streamable-http",
    serverName: "server",
  },
  functions: normalizeMcpToolFunctions("server", [
    { name: "show", _meta: { ui: { resourceUri: "ui://app/index" } } },
  ]),
};
let call: ToolCall;
function component(readOnly = false, input = call) {
  return (
    <NextIntlClientProvider locale="en" messages={{ System: messages }}>
      <ConnectedMcpAppCard
        toolCall={input}
        sessionId="session"
        messageId="message"
        readOnly={readOnly}
      />
    </NextIntlClientProvider>
  );
}
beforeEach(async () => {
  vi.stubEnv("NEXT_PUBLIC_MCP_APPS_SANDBOX_ORIGIN", "https://sandbox.example");
  readResource.mockReset().mockResolvedValue({
    contents: [
      {
        uri: "ui://app/index",
        mimeType: "text/html;profile=mcp-app",
        text: "<p>App</p>",
      },
    ],
  });
  call = {
    id: "call",
    name: plugin.functions[0].name,
    pluginId: "p",
    status: "success",
    args: {},
    result: {
      ok: true,
      data: { content: [{ type: "text", text: "Visible" }] },
      trust: "external_untrusted",
      provenance: { origin: "mcp", toolName: "show" },
    },
    functionFingerprint: await createPluginFunctionFingerprint(
      plugin,
      plugin.functions[0],
    ),
  };
  useSettingsStore.setState({
    system: { ...DEFAULT_SYSTEM_SETTINGS, enableMcpApps: true },
    installedPlugins: [plugin],
    activePlugins: ["p"],
    pluginConfigs: {},
  });
  useChatStore.setState({
    currentSessionId: "session",
    workspaces: [],
    sessions: [
      {
        id: "session",
        title: "Session",
        model: "model",
        updatedAt: 1,
        messageCount: 1,
      },
    ],
    isActiveSessionLoading: false,
    pendingSessionId: null,
    activeMessages: [
      {
        id: "message",
        role: "model",
        content: "",
        timestamp: 1,
        toolCalls: [call],
      },
    ],
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe("MCP Apps mounted eligibility", () => {
  it("never creates an iframe or reads resources in read-only, disabled or unconfigured views", () => {
    const view = render(component(true));
    expect(view.container.querySelector("iframe")).toBeNull();
    view.unmount();
    useSettingsStore.setState({
      system: { ...DEFAULT_SYSTEM_SETTINGS, enableMcpApps: false },
    });
    const disabled = render(component());
    expect(disabled.container.querySelector("iframe")).toBeNull();
    disabled.unmount();
    vi.stubEnv("NEXT_PUBLIC_MCP_APPS_SANDBOX_ORIGIN", "");
    useSettingsStore.setState({
      system: { ...DEFAULT_SYSTEM_SETTINGS, enableMcpApps: true },
    });
    const unconfigured = render(component());
    expect(unconfigured.container.querySelector("iframe")).toBeNull();
    expect(readResource).not.toHaveBeenCalled();
  });
  it("loads once across transcript cloning and releases on read-only transition", async () => {
    const view = render(component());
    await waitFor(() =>
      expect(view.container.querySelector("iframe")?.getAttribute("src")).toBe(
        "https://sandbox.example/sandbox",
      ),
    );
    expect(readResource).toHaveBeenCalledTimes(1);
    view.rerender(component(false, { ...call }));
    expect(readResource).toHaveBeenCalledTimes(1);
    view.rerender(component(true));
    expect(view.container.querySelector("iframe")).toBeNull();
    expect(readResource.mock.calls[0][3].aborted).toBe(true);
  });
  it("honors explicit session plugin enable and disable overrides", async () => {
    useSettingsStore.setState({ activePlugins: [] });
    useChatStore.setState((state) => ({
      sessions: state.sessions.map((session) => ({
        ...session,
        config: { ...session.config, activePlugins: ["p"] },
      })),
    }));
    const view = render(component());
    await waitFor(() =>
      expect(view.container.querySelector("iframe")?.getAttribute("src")).toBe(
        "https://sandbox.example/sandbox",
      ),
    );
    expect(readResource).toHaveBeenCalledTimes(1);
    act(() => {
      useSettingsStore.setState({ activePlugins: ["p"] });
      useChatStore.setState((state) => ({
        sessions: state.sessions.map((session) => ({
          ...session,
          config: { ...session.config, activePlugins: [] },
        })),
      }));
    });
    expect(view.container.querySelector("iframe")).toBeNull();
    expect(readResource.mock.calls[0][3].aborted).toBe(true);
    expect(readResource).toHaveBeenCalledTimes(1);
  });
  it("revokes global plugin access under the effective agent profile", async () => {
    const view = render(component());
    await waitFor(() => expect(readResource).toHaveBeenCalledTimes(1));
    act(() =>
      useChatStore.setState((state) => ({
        sessions: state.sessions.map((session) => ({
          ...session,
          config: { ...session.config, agentProfile: DEFAULT_AGENT_PROFILE },
        })),
      })),
    );
    expect(view.container.querySelector("iframe")).toBeNull();
    expect(readResource.mock.calls[0][3].aborted).toBe(true);
  });
  it.each([
    { isActiveSessionLoading: true, pendingSessionId: null },
    { isActiveSessionLoading: false, pendingSessionId: "other" },
  ])("does not mount during a session transition: %j", (transition) => {
    useChatStore.setState(transition);
    const view = render(component());
    expect(view.container.querySelector("iframe")).toBeNull();
    expect(readResource).not.toHaveBeenCalled();
  });
  it("drops late resource results when a session transition begins", async () => {
    let resolve!: (value: unknown) => void;
    readResource.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const view = render(component());
    await waitFor(() => expect(readResource).toHaveBeenCalledTimes(1));
    await act(async () => {
      useChatStore.setState({ pendingSessionId: "other" });
      resolve({
        contents: [
          {
            uri: "ui://app/index",
            mimeType: "text/html;profile=mcp-app",
            text: "<p>Late</p>",
          },
        ],
      });
      await Promise.resolve();
    });
    expect(readResource.mock.calls[0][3].aborted).toBe(true);
    expect(view.container.querySelector("iframe")).toBeNull();
    expect(view.container.textContent).not.toContain("ready");
  });
  it("does not read resources for stale function fingerprints", async () => {
    const view = render(
      component(false, { ...call, functionFingerprint: "stale" }),
    );
    await waitFor(() =>
      expect(view.container.textContent).toContain("could not start"),
    );
    expect(readResource).not.toHaveBeenCalled();
    expect(view.container.querySelector("iframe")).toBeNull();
  });
});
