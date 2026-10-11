import { afterEach, describe, expect, it, vi } from "vitest";
import {
  normalizeMcpUiDescriptor,
  validateMcpAppResource,
  projectMcpAppResult,
  MCP_APP_MAX_BYTES,
} from "@/lib/mcpApps/policy";
import { getContentSecurityPolicy } from "@/lib/security/headers";
import { parseMcpSandboxOrigin } from "@/lib/mcpApps/config";
import { normalizeMcpToolFunctions } from "@/lib/mcp/registry";
import { createPluginFunctionFingerprint } from "@/lib/plugin/confirmation";
import { bindMcpApp } from "@/lib/mcpApps/binding";
import type { Plugin } from "@/lib/plugin/types";
import type { ToolCall } from "@/lib/chat/types";
import { normalizeSystemSettings } from "@/lib/settings/appConfig";
import { sandboxResponse } from "../../deploy/mcp-app-sandbox/worker.mjs";

const resource = (changes = {}) => ({
  contents: [
    {
      uri: "ui://app/index",
      mimeType: "text/html;profile=mcp-app",
      text: "<p>Hello</p>",
      ...changes,
    },
  ],
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

afterEach(() => vi.unstubAllEnvs());
describe("MCP Apps trust and resource boundary", () => {
  it("adds only the deployment-owned exact origin to the chat frame CSP", () => {
    vi.stubEnv(
      "NEXT_PUBLIC_MCP_APPS_SANDBOX_ORIGIN",
      "https://sandbox.example",
    );
    expect(getContentSecurityPolicy("hosted")).toContain(
      "frame-src 'self' blob: data: https://sandbox.example",
    );
    expect(getContentSecurityPolicy("hosted")).not.toContain("'unsafe-eval'");
    vi.stubEnv("NEXT_PUBLIC_MCP_APPS_SANDBOX_ORIGIN", "https://*.example");
    expect(getContentSecurityPolicy("hosted")).not.toContain(
      "https://*.example",
    );
  });
  it("defaults closed and accepts only exact HTTPS deployment origins", () => {
    expect(normalizeSystemSettings({}).enableMcpApps).toBe(false);
    expect(parseMcpSandboxOrigin("https://sandbox.example/")).toBe(
      "https://sandbox.example",
    );
    for (const value of [
      "http://sandbox.example",
      "https://user:pass@sandbox.example",
      "https://sandbox.example/a",
      "https://sandbox.example?x=1",
      "https://*.example",
    ])
      expect(parseMcpSandboxOrigin(value)).toBeNull();
  });
  it("normalizes nested metadata with legacy read compatibility", () => {
    expect(
      normalizeMcpUiDescriptor({
        "ui/resourceUri": "ui://legacy",
        ui: { resourceUri: "ui://current", visibility: ["app"] },
      }),
    ).toEqual({ resourceUri: "ui://current" });
    expect(
      normalizeMcpUiDescriptor({
        "ui/resourceUri": "ui://legacy",
        ui: { resourceUri: "https://bad" },
      }),
    ).toBeNull();
    expect(
      normalizeMcpUiDescriptor({ "ui/resourceUri": "ui://legacy" })
        ?.resourceUri,
    ).toBe("ui://legacy");
    expect(
      normalizeMcpUiDescriptor({
        ui: { resourceUri: "ui://app", visibility: ["admin"] },
      }),
    ).toEqual({ resourceUri: "ui://app" });
  });
  it("rejects malformed authoritative nested metadata despite a valid legacy URI", () => {
    for (const ui of [null, "invalid", [], 42])
      expect(
        normalizeMcpUiDescriptor({ ui, "ui/resourceUri": "ui://legacy" }),
      ).toBeNull();
  });
  it("binds only current installed active fingerprint, never result metadata", async () => {
    const call: ToolCall = {
      id: "call",
      name: plugin.functions[0].name,
      pluginId: plugin.id,
      functionFingerprint: await createPluginFunctionFingerprint(
        plugin,
        plugin.functions[0],
      ),
      status: "success",
      args: {},
      result: {},
    };
    expect(await bindMcpApp(call, [plugin], [plugin.id], {})).toMatchObject({
      resourceUri: "ui://app/index",
    });
    expect(await bindMcpApp(call, [plugin], [], {})).toBeNull();
    expect(
      await bindMcpApp(call, [plugin], [plugin.id], {
        p: { disabledFunctions: [call.name] },
      }),
    ).toBeNull();
    const changed = {
      ...plugin,
      functions: [
        {
          ...plugin.functions[0],
          mcpUi: { resourceUri: "ui://changed", visibility: ["app" as const] },
        },
      ],
    };
    expect(await bindMcpApp(call, [changed], [plugin.id], {})).toBeNull();
    expect(
      await bindMcpApp(
        {
          ...call,
          functionFingerprint: undefined,
          result: { _meta: { ui: { resourceUri: "ui://app/index" } } },
        },
        [plugin],
        [plugin.id],
        {},
      ),
    ).toBeNull();
  });
  it("checks exact URI/MIME, UTF8 byte bound, permissions and resource CSP", () => {
    expect(validateMcpAppResource(resource(), "ui://app/index")).toBe(
      "<p>Hello</p>",
    );
    for (const changes of [
      { uri: "ui://other" },
      { mimeType: "text/html" },
      { blob: "aGVsbG8=" },
      { text: "界".repeat(Math.ceil(MCP_APP_MAX_BYTES / 3)) },
      { text: "\ud800" },
      { _meta: { ui: { permissions: { camera: {} } } } },
      { _meta: { ui: { csp: { connectDomains: ["https://api.example"] } } } },
      { _meta: { ui: { domain: "app.example" } } },
    ])
      expect(() =>
        validateMcpAppResource(resource(changes), "ui://app/index"),
      ).toThrow();
    expect(() =>
      validateMcpAppResource(
        { contents: [...resource().contents, ...resource().contents] },
        "ui://app/index",
      ),
    ).toThrow();
  });
  it("projects visible result text without arguments, structured hidden data or meta", () => {
    expect(
      projectMcpAppResult({
        content: [
          { type: "text", text: "Visible", _meta: { secret: true } },
          { type: "resource", resource: {} },
        ],
        structuredContent: { secret: true },
        _meta: { token: "private" },
      }),
    ).toEqual({ content: [{ type: "text", text: "Visible" }] });
  });
  it("projects the actual successful tool envelope and rejects failure envelopes", () => {
    const data = {
      content: [{ type: "text", text: "Envelope visible" }],
      _meta: { token: "private" },
      structuredContent: { hidden: true },
    };
    expect(
      projectMcpAppResult({
        ok: true,
        data,
        trust: "external_untrusted",
        provenance: { origin: "mcp", toolName: "show" },
      }),
    ).toEqual({ content: [{ type: "text", text: "Envelope visible" }] });
    expect(() =>
      projectMcpAppResult({
        ok: false,
        error: { code: "FAILED", message: "Failure", recoverable: true },
        trust: "external_untrusted",
        provenance: { origin: "mcp", toolName: "show" },
      }),
    ).toThrow("tool_result_failed");
  });
  it("deployment serves a fixed no-network proxy only for a distinct pinned host", async () => {
    const request = new Request("https://sandbox.example/sandbox");
    expect(
      sandboxResponse(request, {
        MCP_APPS_HOST_ORIGIN: "https://sandbox.example",
      }).status,
    ).toBe(503);
    expect(
      sandboxResponse(
        new Request("https://sandbox.example/sandbox?csp=allow"),
        { MCP_APPS_HOST_ORIGIN: "https://chat.example" },
      ).status,
    ).toBe(404);
    const response = sandboxResponse(request, {
      MCP_APPS_HOST_ORIGIN: "https://chat.example",
    });
    expect(response.headers.get("Content-Security-Policy")).toContain(
      "frame-ancestors https://chat.example",
    );
    expect(response.headers.get("Content-Security-Policy")).toContain(
      "connect-src 'none'",
    );
    expect(response.headers.get("Content-Security-Policy")).not.toContain(
      "unsafe-eval",
    );
    expect(response.headers.has("X-Frame-Options")).toBe(false);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const html = await response.text();
    expect(html).toContain("event.source === parent");
    expect(html).toContain("event.source === view.contentWindow");
    expect(html).toContain('"allow-scripts"');
  });
});
