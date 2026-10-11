import { isToolResultEnvelope } from "@/lib/agent/toolResult";
import type { Plugin, PluginConfig } from "@/lib/plugin/types";
import type { ToolCall } from "@/lib/chat/types";
import { createPluginFunctionFingerprint } from "@/lib/plugin/confirmation";

/** Persisted tool output and _meta cannot create an application association. */
export async function bindMcpApp(
  call: ToolCall,
  plugins: Plugin[],
  activePlugins: string[],
  configs: Record<string, PluginConfig>,
) {
  if (
    call.status !== "success" ||
    call.isError ||
    !call.pluginId ||
    !call.functionFingerprint
  )
    return null;
  if (isToolResultEnvelope(call.result) && !call.result.ok) return null;
  const plugin = plugins.find(
    (item) => item.id === call.pluginId && item.source === "mcp",
  );
  const fn = plugin?.functions.find((item) => item.name === call.name);
  if (!plugin?.mcp || !fn?.mcpUi || !activePlugins.includes(plugin.id))
    return null;
  const config = configs[plugin.id];
  if (
    config?.disabledFunctions?.includes(fn.name) ||
    (config?.enabledFunctions && !config.enabledFunctions.includes(fn.name))
  )
    return null;
  if (
    (await createPluginFunctionFingerprint(plugin, fn)) !==
    call.functionFingerprint
  )
    return null;
  return {
    pluginId: plugin.id,
    title: plugin.title,
    resourceUri: fn.mcpUi.resourceUri,
    fingerprint: call.functionFingerprint,
  };
}
