import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Plugin } from "@/types";

const h = vi.hoisted(() => ({
  state: {} as Record<string, any>,
  fetch: vi.fn(),
  auth: vi.fn(),
  encrypt: vi.fn(),
}));
vi.mock("@/store/core/settingsStore", () => ({
  useSettingsStore: {
    getState: () => h.state,
    setState: (update: (state: typeof h.state) => unknown) =>
      Object.assign(h.state, update(h.state)),
  },
}));
vi.mock("@/lib/byok/client", () => ({
  encryptSecret: h.encrypt,
  fetchWithByokRetry: vi.fn(),
}));
vi.mock("@/lib/security/localSecretResolvers", () => ({
  resolvePluginAuthValue: h.auth,
}));
vi.mock("@/lib/api/client", async () => ({
  ...(await vi.importActual("@/lib/api/client")),
  signedApiFetch: h.fetch,
}));
import { refreshMcpToolDefinition } from "@/services/api/pluginService";

const plugin: Plugin = {
  id: "mcp:fixture",
  title: "Fixture",
  description: "",
  logoUrl: "",
  manifestUrl: "",
  source: "mcp",
  functions: [],
  mcp: {
    transport: "sse",
    serverUrl: "https://example.com",
    serverName: "fixture",
  },
};
beforeEach(() => {
  h.fetch.mockReset();
  h.auth.mockReset();
  h.encrypt.mockReset();
  h.state = {
    system: {},
    installedPlugins: [plugin],
    pluginConfigs: { [plugin.id]: { disabledFunctions: ["disabled"] } },
    activePlugins: [plugin.id],
  };
});
describe("explicit MCP metadata refresh", () => {
  it("keeps old definition and configuration after discovery failure", async () => {
    h.fetch.mockResolvedValue(
      new Response(JSON.stringify({ error: "offline" }), {
        status: 503,
        headers: { "content-type": "application/json" },
      }),
    );
    await expect(refreshMcpToolDefinition(plugin.id)).rejects.toThrow();
    expect(h.state.installedPlugins[0]).toBe(plugin);
    expect(h.state.pluginConfigs[plugin.id].disabledFunctions).toEqual([
      "disabled",
    ]);
  });
  it("replaces only the definition after complete discovery", async () => {
    const config = h.state.pluginConfigs;
    h.fetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          plugin: { ...plugin, mcp: { ...plugin.mcp, toolMetadataVersion: 1 } },
        }),
        { headers: { "content-type": "application/json" } },
      ),
    );
    await refreshMcpToolDefinition(plugin.id);
    expect(h.state.installedPlugins[0].mcp.toolMetadataVersion).toBe(1);
    expect(h.state.pluginConfigs).toBe(config);
    expect(h.state.activePlugins).toEqual([plugin.id]);
  });
  it.each(["header", "query"] as const)(
    "preserves configured auth type, key and %s placement when refreshing",
    async (addTo) => {
      const manifest = {
        ...plugin,
        auth: {
          type: "bearer" as const,
          name: "Authorization",
          in: "header" as const,
        },
      };
      h.state.installedPlugins = [manifest];
      const auth = {
        type: "apiKey",
        key: "custom-key",
        addTo,
        localValueSecret: { version: 1 },
      };
      h.state.pluginConfigs[plugin.id].auth = auth;
      h.auth.mockResolvedValue("resolved-secret");
      const valueSecret = { version: 1, ciphertext: "encrypted" };
      h.encrypt.mockResolvedValue(valueSecret);
      h.fetch.mockResolvedValue(
        new Response(
          JSON.stringify({
            plugin: {
              ...manifest,
              mcp: { ...manifest.mcp, toolMetadataVersion: 1 },
            },
          }),
          { headers: { "content-type": "application/json" } },
        ),
      );
      await refreshMcpToolDefinition(plugin.id);
      const body = JSON.parse(h.fetch.mock.calls[0][1].body);
      expect(body.authConfig).toEqual({
        type: "apiKey",
        key: "custom-key",
        addTo,
        valueSecret,
      });
      expect(body.plugin.auth).toEqual(manifest.auth);
      expect(body).not.toHaveProperty("authConfig.value");
      expect(h.auth).toHaveBeenCalledWith(plugin.id, auth);
      expect(h.encrypt).toHaveBeenCalledWith(
        "resolved-secret",
        expect.any(String),
      );
      expect(h.state.pluginConfigs[plugin.id].auth).toBe(auth);
    },
  );
});
