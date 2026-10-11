import type { IntelligentUiBlock } from "./types";
import { parseHtmlDefinition, parseNativeDefinition } from "./schema";
import { getNativeInitialState } from "./catalog";
import { renderUiMarkdown } from "./presentation";
import {
  isUnsupportedHtmlMetadata,
  isUnsupportedNativeDefinition,
  quarantineUnsupportedUiPayload,
} from "./compatibility";
export type UiTextSegment =
  | { type: "text"; content: string; offset: number }
  | { type: "intelligent_ui"; block: IntelligentUiBlock; offset: number };
export function parseIntelligentUiText(
  text: string,
  options: { idPrefix?: string; final?: boolean; cancelled?: boolean } = {},
): UiTextSegment[] {
  const result: UiTextSegment[] = [];
  let plainStart = 0;
  let offset = 0;
  let fence: {
    char: string;
    length: number;
    start: number;
    bodyStart: number;
    mode: string;
  } | null = null;
  const addUi = (end: number, closed: boolean) => {
    if (!fence) return;
    if (fence.start > plainStart)
      result.push({
        type: "text",
        content: text.slice(plainStart, fence.start),
        offset: plainStart,
      });
    const source = text.slice(fence.bodyStart, end);
    let definition: IntelligentUiBlock["definition"] = null;
    let metadata: unknown;
    let renderer: IntelligentUiBlock["renderer"] = "native";
    let unsupportedPayload: string | undefined;
    const readableFallback = () => {
      if (!metadata || typeof metadata !== "object" || Array.isArray(metadata))
        return "";
      const value = metadata as Record<string, unknown>;
      return (
        [value.title, value.summary]
          .filter(
            (item): item is string =>
              typeof item === "string" && Boolean(item.trim()),
          )
          .join(" — ") || ""
      );
    };
    if (closed) {
      try {
        metadata = JSON.parse(source);
        definition = parseNativeDefinition(metadata);
        if (isUnsupportedNativeDefinition(metadata))
          unsupportedPayload = quarantineUnsupportedUiPayload(metadata);
      } catch {
        /* incomplete or invalid */
      }
    }
    if (!definition && !unsupportedPayload) {
      const lineEnd = source.search(/\r?\n/);
      if (lineEnd >= 0) {
        try {
          const header: unknown = JSON.parse(source.slice(0, lineEnd));
          if (
            !header ||
            typeof header !== "object" ||
            Array.isArray(header) ||
            "kind" in header
          )
            throw new Error("Not HTML metadata");
          metadata = header;
          renderer = "html";
          const html = source.slice(lineEnd).replace(/^\r?\n/, "");
          definition = parseHtmlDefinition({
            ...(metadata && typeof metadata === "object" ? metadata : {}),
            html,
          });
          if (closed && isUnsupportedHtmlMetadata(metadata)) {
            unsupportedPayload = quarantineUnsupportedUiPayload({
              ...(metadata && typeof metadata === "object" ? metadata : {}),
              html,
            });
          }
        } catch {
          /* invalid metadata */
        }
      }
    }
    const block: IntelligentUiBlock = {
      id: `${options.idPrefix ?? "ui"}-ui-${fence.start}`,
      type: "intelligent_ui",
      schemaVersion: 1,
      renderer,
      definition,
      definitionRevision: 1,
      status: closed
        ? definition
          ? "ready"
          : "failed"
        : options.final
          ? options.cancelled
            ? "cancelled"
            : "failed"
          : definition
            ? "preview"
            : "receiving",
      fallbackMarkdown: definition?.summary ?? readableFallback(),
      state:
        definition && "kind" in definition
          ? getNativeInitialState(definition)
          : {},
      stateRevision: 0,
      staticSnapshot: "",
      sourceRefs: [],
      ...(unsupportedPayload ? { unsupportedPayload } : {}),
    };
    if (closed && definition && renderer === "native")
      block.staticSnapshot = renderUiMarkdown(block, false);
    result.push({ type: "intelligent_ui", block, offset: fence.start });
  };
  while (offset < text.length) {
    const match = /\r\n|\n|\r/g;
    match.lastIndex = offset;
    const nl = match.exec(text);
    const end = nl?.index ?? text.length;
    const next = nl ? end + nl[0].length : text.length;
    const line = text.slice(offset, end);
    if (fence) {
      if (
        (nl !== null || options.final) &&
        new RegExp(`^ {0,3}${fence.char}{${fence.length},}[\\t ]*$`).test(line)
      ) {
        if (fence.mode === "intelligent-ui") {
          addUi(offset, true);
          plainStart = next;
        }
        fence = null;
      }
    } else {
      const open = /^ {0,3}(`{3,}|~{3,})([^\r\n]*)$/.exec(line);
      if (open) {
        const mode = open[2]!.trim();
        if (open[1]![0] !== "`" || !mode.includes("`"))
          fence = {
            char: open[1]![0]!,
            length: open[1]!.length,
            start: offset,
            bodyStart: next,
            mode,
          };
      }
    }
    offset = next;
  }
  if (fence && fence.mode === "intelligent-ui") {
    addUi(text.length, false);
    plainStart = text.length;
  }
  if (plainStart < text.length) {
    let end = text.length;
    if (!options.final) {
      const lineStart = text.lastIndexOf("\n") + 1;
      const tail = text.slice(lineStart);
      const prefix = /^ {0,3}(?:`+|~+)([^`~]*)$/.exec(tail);
      if (prefix && "intelligent-ui".startsWith(prefix[1]!)) end = lineStart;
    }
    if (end > plainStart)
      result.push({
        type: "text",
        content: text.slice(plainStart, end),
        offset: plainStart,
      });
  }
  return result;
}
