import type { MessageOutputBlock, ToolCall } from "@/lib/chat/types";

export function mergeToolResultUiState(
  incoming: ToolCall[],
  current: ToolCall[] | undefined,
): ToolCall[] {
  const existing = new Map<string, ToolCall>();
  for (const call of current ?? []) {
    const previous = existing.get(call.id);
    if (
      !previous ||
      (call.intelligentUiStateRevision ?? 0) >
        (previous.intelligentUiStateRevision ?? 0)
    )
      existing.set(call.id, call);
  }
  return incoming.map((call) => {
    const previous = existing.get(call.id);
    if (
      !previous?.intelligentUiState ||
      !call.intelligentUiResult ||
      call.intelligentUiResult.resultHash !==
        previous.intelligentUiResult?.resultHash ||
      call.name !== previous.name ||
      call.pluginId !== previous.pluginId ||
      (previous.intelligentUiStateRevision ?? 0) <=
        (call.intelligentUiStateRevision ?? 0)
    )
      return call;
    return {
      ...call,
      intelligentUiState: structuredClone(previous.intelligentUiState),
      intelligentUiStateRevision: previous.intelligentUiStateRevision,
    };
  });
}

/** Streaming definitions must never overwrite a newer user interaction. */
export function mergeIntelligentUiState(
  incoming: MessageOutputBlock[],
  current: MessageOutputBlock[] | undefined,
  toolCalls?: ToolCall[],
): MessageOutputBlock[] {
  const existing = new Map(current?.map((block) => [block.id, block]));
  const currentCalls = [
    ...(toolCalls ?? []),
    ...(current ?? []).flatMap((block) =>
      block.type === "tool_group" ? block.toolCalls : [],
    ),
  ];
  return incoming.map((block) => {
    const previous = existing.get(block.id);
    if (block.type === "tool_group") {
      return {
        ...block,
        toolCalls: mergeToolResultUiState(block.toolCalls, currentCalls),
      };
    }
    if (
      block.type !== "intelligent_ui" ||
      previous?.type !== "intelligent_ui" ||
      block.definitionRevision !== previous.definitionRevision ||
      previous.stateRevision <= block.stateRevision
    )
      return block;
    return {
      ...block,
      state: structuredClone(previous.state),
      stateRevision: previous.stateRevision,
      staticSnapshot: previous.staticSnapshot,
      dataSnapshot:
        previous.dataSnapshot && structuredClone(previous.dataSnapshot),
      sourceBindings:
        previous.sourceBindings && structuredClone(previous.sourceBindings),
    };
  });
}
