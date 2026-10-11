import { describe, it, expect } from "vitest";
import { normalizeMcpVisibility } from "@/lib/mcpApps/policy";
import { normalizeMcpToolFunctions } from "@/lib/mcp/registry";
import {
  getModelCallablePluginFunctions,
  getEnabledPluginFunctions,
  resolveEnabledPluginFunction,
  getPluginFunctionNameCollisions,
} from "@/lib/plugin/resolve";
import type { Plugin } from "@/lib/plugin/types";

describe("MCP model visibility", () => {
  it("keeps visibility independent of a resource and rejects malformed declarations", () => {
    expect(normalizeMcpVisibility(undefined)).toEqual(["model", "app"]);
    for (const meta of [
      { ui: { visibility: [] } },
      { ui: { visibility: ["bad"] } },
      { ui: null },
    ])
      expect(normalizeMcpVisibility(meta)).toEqual([]);
    const functions = normalizeMcpToolFunctions("fixture", [
      {
        name: "hidden",
        inputSchema: { type: "object" },
        _meta: { ui: { visibility: ["app"] } },
      },
    ]);
    expect(functions[0].mcpUi).toBeUndefined();
    expect(functions[0].mcpVisibility).toEqual(["app"]);
  });
  it("blocks unknown old metadata and app-only tools from resolve and collisions but retains non-model inspection", () => {
    const plugin = {
      id: "test",
      source: "mcp",
      mcp: { toolMetadataVersion: 1 },
      functions: [
        { name: "hidden", mcpVisibility: ["app"] },
        { name: "visible", mcpVisibility: ["model"] },
      ],
    } as unknown as Plugin;
    expect(getEnabledPluginFunctions(plugin)).toHaveLength(2);
    expect(getModelCallablePluginFunctions(plugin).map((f) => f.name)).toEqual([
      "visible",
    ]);
    expect(resolveEnabledPluginFunction([plugin], "hidden")).toBeNull();
    expect(
      getPluginFunctionNameCollisions(
        [plugin, { ...plugin, id: "other" }],
        undefined,
      ).map((c) => c.name),
    ).toEqual(["visible"]);
    expect(
      getModelCallablePluginFunctions({
        ...plugin,
        mcp: { ...plugin.mcp!, toolMetadataVersion: undefined },
      }),
    ).toEqual([]);
  });
});
