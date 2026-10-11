import { isToolResultEnvelope } from "@/lib/agent/toolResult";
import type { McpUiDescriptor } from "@/lib/plugin/types";

export const MCP_APP_MIME = "text/html;profile=mcp-app";
export const MCP_APP_MAX_BYTES = 2 * 1024 * 1024;
export const MCP_APP_LOAD_TIMEOUT = 15_000;
export const MCP_APP_INIT_TIMEOUT = 10_000;
export const MCP_APP_TEARDOWN_TIMEOUT = 2_000;

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** Visibility is independent of whether a tool has a renderable App resource. */
export function normalizeMcpVisibility(meta: unknown): ("model" | "app")[] {
  if (meta === undefined) return ["model", "app"];
  if (!record(meta)) return [];
  if ("ui" in meta && !record(meta.ui)) return [];
  const visibility = record(meta.ui) ? meta.ui.visibility : undefined;
  if (visibility === undefined) return ["model", "app"];
  if (
    !Array.isArray(visibility) ||
    visibility.some((value) => value !== "model" && value !== "app")
  )
    return [];
  return [...new Set(visibility)] as ("model" | "app")[];
}

/** Nested metadata is authoritative, even when malformed; legacy is read-only. */
export function normalizeMcpUiDescriptor(
  meta: unknown,
): McpUiDescriptor | null {
  if (!record(meta)) return null;
  if ("ui" in meta && !record(meta.ui)) return null;
  const ui = record(meta.ui) ? meta.ui : undefined;
  const uri =
    ui && "resourceUri" in ui ? ui.resourceUri : meta["ui/resourceUri"];
  if (
    typeof uri !== "string" ||
    uri.length > 8192 ||
    !/^ui:\/\/[^\s]+$/.test(uri)
  )
    return null;
  return { resourceUri: uri };
}

export function validateMcpAppResource(value: unknown, uri: string): string {
  if (
    !record(value) ||
    !Array.isArray(value.contents) ||
    value.contents.length !== 1
  )
    throw new Error("resource_invalid");
  const content = value.contents[0];
  if (
    !record(content) ||
    content.uri !== uri ||
    content.mimeType !== MCP_APP_MIME ||
    typeof content.text !== "string" ||
    !content.text.trim() ||
    "blob" in content
  )
    throw new Error("resource_invalid");
  if (
    new TextEncoder().encode(content.text).length > MCP_APP_MAX_BYTES ||
    /\u0000|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(
      content.text,
    )
  )
    throw new Error("resource_size_encoding");
  const meta = content._meta;
  if (meta !== undefined && !record(meta)) throw new Error("resource_policy");
  const ui = record(meta) ? meta.ui : undefined;
  if (ui !== undefined) {
    if (!record(ui) || ui.domain !== undefined)
      throw new Error("resource_policy");
    if (
      ui.permissions !== undefined &&
      (!record(ui.permissions) || Object.keys(ui.permissions).length)
    )
      throw new Error("resource_policy");
    if (ui.csp !== undefined) {
      if (
        !record(ui.csp) ||
        Object.entries(ui.csp).some(
          ([key, domains]) =>
            ![
              "connectDomains",
              "resourceDomains",
              "frameDomains",
              "baseUriDomains",
            ].includes(key) ||
            !Array.isArray(domains) ||
            domains.length > 0,
        )
      )
        throw new Error("resource_policy");
    }
  }
  return content.text;
}

/** Only visible text, never _meta, raw tool arguments or hidden structured fields. */
export function projectMcpAppResult(result: unknown): {
  content: { type: "text"; text: string }[];
} {
  if (isToolResultEnvelope(result)) {
    if (!result.ok) throw new Error("tool_result_failed");
    result = result.data;
  }
  if (record(result) && result.isError === true)
    throw new Error("tool_result_failed");
  const content =
    record(result) && Array.isArray(result.content) ? result.content : [];
  const text = content
    .filter(
      (item) =>
        record(item) && item.type === "text" && typeof item.text === "string",
    )
    .map((item) => ({
      type: "text" as const,
      text: String(item.text).slice(0, 40_000),
    }))
    .slice(0, 30);
  return { content: text };
}
