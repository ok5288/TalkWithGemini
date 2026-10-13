import type { Message } from "@/types";
import { parseIntelligentUiText } from "./parser";

export type UiHostAction = "explain" | "modify" | "repair";

/** Fail closed: copied/imported identities cannot establish original provenance. */
export function getUiRepairSource(
  message: Message | undefined,
  blockId: string,
): string | undefined {
  if (!message || message.role !== "model" || !message.content) return;
  const blocks = message.outputBlocks?.filter(
    (block) => block.type === "intelligent_ui",
  );
  if (blocks?.length !== 1) return;
  const block = blocks[0];
  if (
    block.id !== blockId ||
    block.definitionRevision !== 1 ||
    !["failed", "cancelled"].includes(block.status) ||
    block.unsupportedPayload ||
    block.diagnostic?.code === "unsupported_version" ||
    block.diagnostic?.code === "unsupported_kind"
  )
    return;
  const identity = /^(.*)-ui-(\d+)$/.exec(blockId);
  if (!identity) return;
  const segments = parseIntelligentUiText(message.content, {
    idPrefix: identity[1],
    final: true,
    cancelled: block.status === "cancelled",
  });
  const candidates = segments.filter((item) => item.type === "intelligent_ui");
  if (candidates.length !== 1) return;
  const candidate = candidates[0];
  if (
    candidate.block.id !== blockId ||
    candidate.block.status !== block.status ||
    candidate.block.renderer !== block.renderer ||
    candidate.block.unsupportedPayload
  )
    return;
  const next = segments[segments.indexOf(candidate) + 1];
  const raw = message.content.slice(candidate.offset, next?.offset);
  // An interrupted fence can still contain complete, unsupported metadata.
  const fence = /^ {0,3}(`{3,}|~{3,})/.exec(raw)?.[1];
  if (fence) {
    const completed = parseIntelligentUiText(`${raw}\n${fence}\n`, {
      final: true,
    }).find((item) => item.type === "intelligent_ui");
    if (completed?.block.unsupportedPayload) return;
  }
  return raw;
}

/** These are quoted context data, never promoted to system instructions. */
export function projectHostAction(
  action: UiHostAction,
  content: string,
): string {
  return JSON.stringify({
    hostAction: action,
    ...(action === "repair"
      ? { untrustedOriginalUiSource: content }
      : { currentUiResult: content }),
    ...(action === "modify" || action === "repair"
      ? { requestedOutput: "complete new definition; preserve original UI" }
      : {}),
  });
}
