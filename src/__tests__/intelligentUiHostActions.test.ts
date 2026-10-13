import { describe, expect, it } from "vitest";
import type { Message } from "@/types";
import { getUiRepairSource } from "@/lib/intelligentUi/actions";
import { parseIntelligentUiText } from "@/lib/intelligentUi/parser";
const content = '```intelligent-ui\n{"version":1,broken}\n```';
function fixture(): Message {
  const parsed = parseIntelligentUiText(content, {
    idPrefix: "original",
    final: true,
  })[0];
  if (parsed.type !== "intelligent_ui") throw Error("fixture");
  return {
    id: "message",
    role: "model",
    content,
    timestamp: 0,
    outputBlocks: [parsed.block],
  };
}
describe("host repair provenance", () => {
  it("extracts only a unique original failed fence", () => {
    const message = fixture();
    expect(getUiRepairSource(message, message.outputBlocks![0].id)).toBe(
      content,
    );
  });
  it.each([
    "multiple fences",
    "multiple blocks",
    "copied id",
    "missing source",
    "quarantine",
    "unknown kind",
  ])("rejects %s", (kind) => {
    const message = fixture();
    const block = message.outputBlocks![0];
    if (block.type !== "intelligent_ui") throw Error("fixture");
    if (kind === "multiple fences") message.content += "\n" + content;
    if (kind === "multiple blocks")
      message.outputBlocks!.push({ ...block, id: "other" });
    if (kind === "copied id") block.id = "copied-uuid";
    if (kind === "missing source") message.content = "";
    if (kind === "quarantine") block.unsupportedPayload = "future";
    if (kind === "unknown kind")
      block.diagnostic = { code: "unsupported_kind" };
    expect(getUiRepairSource(message, block.id)).toBeUndefined();
  });
});

it("does not offer repair for interrupted future metadata", () => {
  const message = fixture();
  message.content = '```intelligent-ui\n{"version":99,"kind":"explorer"}';
  const segment = parseIntelligentUiText(message.content, {
    idPrefix: "original",
    final: true,
    cancelled: true,
  })[0];
  if (segment.type !== "intelligent_ui") throw Error("fixture");
  message.outputBlocks = [segment.block];
  expect(getUiRepairSource(message, segment.block.id)).toBeUndefined();
});
