import { normalizeIntelligentUiBlock } from "./schema";

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** Pure snapshot recovery: never opens sessions or writes their IndexedDB trees. */
export function recoverKnownExplorerV2InAppData<
  T extends { sessionMessages: unknown },
>(data: T): T {
  const recoverMessage = (message: unknown): unknown => {
    if (!record(message) || !Array.isArray(message.outputBlocks))
      return message;
    return {
      ...message,
      outputBlocks: message.outputBlocks.map((value) => {
        if (
          !record(value) ||
          value.type !== "intelligent_ui" ||
          typeof value.unsupportedPayload !== "string"
        )
          return value;
        const restored = normalizeIntelligentUiBlock(value);
        return restored?.definition &&
          "kind" in restored.definition &&
          restored.definition.kind === "explorer" &&
          restored.definition.version === 2 &&
          !restored.unsupportedPayload
          ? restored
          : value;
      }),
    };
  };
  const recoverTree = (stored: unknown): unknown => {
    let tree = stored;
    if (typeof tree === "string") {
      try {
        tree = JSON.parse(tree);
      } catch {
        return stored;
      }
    }
    if (Array.isArray(tree)) return tree.map(recoverMessage);
    if (!record(tree) || !record(tree.nodesById)) return stored;
    return {
      ...tree,
      nodesById: Object.fromEntries(
        Object.entries(tree.nodesById).map(([id, node]) => [
          id,
          record(node)
            ? { ...node, message: recoverMessage(node.message) }
            : node,
        ]),
      ),
    };
  };
  if (!record(data.sessionMessages)) return data;
  return {
    ...data,
    sessionMessages: Object.fromEntries(
      Object.entries(data.sessionMessages).map(([id, tree]) => [
        id,
        recoverTree(tree),
      ]),
    ),
  };
}
