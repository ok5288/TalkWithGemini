import type { Message, MessageOutputBlock } from "@/types";
import { getMessageOutputBlocks } from "./messageOutputBlocks";
import {
  projectUiBlock,
  projectUiText,
  type UiProjectionOptions,
} from "@/lib/intelligentUi/projection";

type StaticProjectionOptions = Omit<UiProjectionOptions, "purpose"> & {
  purpose: "static-original" | "static-current";
  sourceScope?:
    import("@/lib/intelligentUi/sourceContext").FrozenUiSourceScope | null;
};

/** User examples stay literal; model output follows one explicit privacy purpose. */
export function projectMessageUi(
  message: Message,
  options: UiProjectionOptions,
): string {
  if (message.role !== "model") return message.content;
  return getMessageOutputBlocks(message)
    .flatMap((block) => {
      if (block.type === "intelligent_ui")
        return [projectUiBlock(block, options)];
      if (block.type === "text") return [projectUiText(block.content, options)];
      return [];
    })
    .join("\n\n");
}

/** Explicit export boundary: resolve current source authority and verified tool projections. */
export async function projectMessageUiForExport(
  message: Message,
  sessionId: string | undefined,
  options: UiProjectionOptions & {
    sourceScope?: import("@/lib/intelligentUi/sourceContext").FrozenUiSourceScope;
  },
): Promise<string> {
  if (
    options.purpose === "static-original" ||
    options.purpose === "static-current"
  ) {
    const prepared = await prepareMessageUiForStatic(message, sessionId, {
      ...options,
      purpose: options.purpose,
    });
    if (!options.sourceScope) await assertPreparedMessageUiValid(prepared);
    return getMessageOutputBlocks(prepared)
      .flatMap((block) => (block.type === "text" ? [block.content] : []))
      .join("\n\n");
  }
  if (message.role !== "model") return message.content;
  const parts: string[] = [];
  for (const block of getMessageOutputBlocks(message)) {
    if (block.type === "intelligent_ui") {
      const { resolveBlockUiProjectionData } =
        await import("@/lib/intelligentUi/sourceContext");
      const resolved = sessionId
        ? await resolveBlockUiProjectionData(
            block,
            sessionId,
            message.id,
            options.purpose,
          ).catch(() => ({}))
        : {};
      parts.push(projectUiBlock(block, { ...options, ...resolved }));
    } else if (block.type === "text")
      parts.push(projectUiText(block.content, options));
    else if (
      block.type === "tool_group" &&
      options.purpose === "compose-result"
    ) {
      const { renderToolResultSnapshot } =
        await import("@/lib/intelligentUi/toolResults/projection");
      for (const call of block.toolCalls) {
        const content = await renderToolResultSnapshot(call, {
          ...options,
          purpose: "compose-result",
        }).catch(() => null);
        if (content) parts.push(content);
      }
    }
  }
  return parts.join("\n\n");
}

/**
 * Resolve source-backed UI and tool projections before a DOM export mounts.
 * The returned message owns a fresh output-block list; the chat message is
 * never mutated and unsupported tool metadata is intentionally omitted.
 */
export async function prepareMessageUiForStatic(
  message: Message,
  sessionId: string | undefined,
  options: StaticProjectionOptions,
): Promise<Message> {
  if (message.role !== "model") return message;

  const blocks = getMessageOutputBlocks(message);
  const hasToolProjection = blocks.some(
    (block) =>
      block.type === "tool_group" &&
      block.toolCalls.some((call) => !!call.intelligentUiResult),
  );
  const needsSources =
    hasToolProjection ||
    blocks.some(
      (block) =>
        block.type === "intelligent_ui" &&
        (block.sourceBindings?.length ||
          (block.definition &&
            "kind" in block.definition &&
            block.definition.kind === "explorer" &&
            block.definition.props.dataset.kind === "context")),
    );
  const scope =
    options.sourceScope !== undefined
      ? options.sourceScope
      : sessionId && needsSources
        ? await prepareStaticUiSourceScope(sessionId, message.id)
        : undefined;
  const sourceContext = hasToolProjection
    ? await scope?.load(message.id)
    : undefined;
  const prepared: MessageOutputBlock[] = [];
  let sourceContextModule:
    typeof import("@/lib/intelligentUi/sourceContext") | undefined;
  let toolProjectionModule:
    typeof import("@/lib/intelligentUi/toolResults/projection") | undefined;

  const resolveBlock = async (
    block: Extract<MessageOutputBlock, { type: "intelligent_ui" }>,
  ) => {
    if (!sessionId) return {};
    try {
      sourceContextModule ??= await import("@/lib/intelligentUi/sourceContext");
      return await sourceContextModule.resolveBlockUiProjectionData(
        block,
        sessionId,
        message.id,
        options.purpose,
        scope ?? undefined,
      );
    } catch {
      return {};
    }
  };

  for (const block of blocks) {
    if (block.type === "intelligent_ui") {
      const resolved = await resolveBlock(block);
      prepared.push({
        id: `${block.id}:static`,
        type: "text",
        content: projectUiBlock(block, { ...options, ...resolved }),
      });
      continue;
    }

    if (block.type === "text") {
      prepared.push({
        ...block,
        content: projectUiText(block.content, options),
      });
      continue;
    }

    if (block.type === "tool_group") {
      try {
        toolProjectionModule ??=
          await import("@/lib/intelligentUi/toolResults/projection");
        for (const call of block.toolCalls) {
          if (
            !sourceContext ||
            ![...sourceContext.materials.values()].some(
              (material) =>
                material.sourceRef ===
                  `${message.id}:tool:${call.executionRecordId ?? call.id}` &&
                material.access === "allowed" &&
                material.availability === "available",
            )
          )
            continue;
          const snapshot = await toolProjectionModule
            .renderToolResultSnapshot(call, options)
            .catch(() => null);
          if (snapshot)
            prepared.push({
              id: `${block.id}:${call.id}:static`,
              type: "text",
              content: snapshot,
            });
        }
      } catch {
        // A failed or unsupported tool adapter has no safe static projection.
      }
      continue;
    }

    prepared.push(block);
  }

  const output = { ...message, outputBlocks: prepared, toolCalls: undefined };
  if (scope) {
    if (options.sourceScope === undefined) await scope.assertValid();
    validity.set(output, scope.assertValid);
  }
  return output;
}

const validity = new WeakMap<Message, () => Promise<void>>();
export async function assertPreparedMessageUiValid(
  message: Message,
): Promise<void> {
  await validity.get(message)?.();
}

async function prepareStaticUiSourceScope(
  sessionId: string,
  messageId: string,
) {
  const [
    { useChatStore },
    { readSessionForPresentation },
    { createFrozenUiSourceScope },
  ] = await Promise.all([
    import("@/store/core/chatStore"),
    import("./readSessionForPresentation"),
    import("@/lib/intelligentUi/sourceContext"),
  ]);
  const session = useChatStore
    .getState()
    .sessions.find((item) => item.id === sessionId);
  if (!session) throw new Error("UI_SOURCE_STALE");
  const frozen = await readSessionForPresentation(session);
  const end = frozen.messages.findIndex((item) => item.id === messageId);
  if (end < 0) throw new Error("UI_SOURCE_STALE");
  return createFrozenUiSourceScope(frozen, frozen.messages.slice(0, end + 1));
}
