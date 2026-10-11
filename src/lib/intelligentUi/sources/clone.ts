import type { SessionMessageTree, Message, Attachment } from "@/lib/chat/types";
import type { ResearchTask } from "@/lib/research/types";
import { getUiSourceAlias } from "./resolver";
import type { UiSourceBinding } from "./types";

function messageSourceRefs(message: Message): string[] {
  const refs = (message.attachments ?? [])
    .filter((attachment) => !attachment.intelligentUiSource)
    .map((attachment) => `${message.id}:attachment:${attachment.id}`);
  for (const [kind, sources] of [
    ["web", message.searchSources],
    ["knowledge", message.ragSources],
  ] as const)
    sources?.forEach((_, index) => refs.push(`${message.id}:${kind}:${index}`));
  const calls = new Map(
    (message.toolCalls ?? []).map((call) => [call.id, call]),
  );
  for (const block of message.outputBlocks ?? [])
    if (block.type === "tool_group")
      for (const call of block.toolCalls) calls.set(call.id, call);
  for (const call of calls.values())
    refs.push(`${message.id}:tool:${call.executionRecordId ?? call.id}`);
  return refs;
}

/** Remap identities produced by the same clone transaction; never infer a source by matching content. */
export async function remapClonedUiSources(input: {
  originalSessionId: string;
  targetSessionId: string;
  originalTree: SessionMessageTree;
  clonedTree: SessionMessageTree;
  messageIdMap: ReadonlyMap<string, string>;
  taskIdMap: ReadonlyMap<string, string>;
  originalTasks: readonly ResearchTask[];
  targetTasks: readonly ResearchTask[];
  sourceRefMap?: ReadonlyMap<string, string>;
}): Promise<SessionMessageTree> {
  const sourceRefs = new Map(input.sourceRefMap);
  for (const [oldId, newId] of input.messageIdMap) {
    const original = input.originalTree.nodesById[oldId]?.message;
    const cloned = input.clonedTree.nodesById[newId]?.message;
    if (!original || !cloned) continue;
    const newRefs = new Set(messageSourceRefs(cloned));
    for (const ref of messageSourceRefs(original)) {
      const next = `${newId}${ref.slice(oldId.length)}`;
      if (newRefs.has(next)) sourceRefs.set(ref, next);
    }
  }
  const reports = new Map<
    string,
    NonNullable<Attachment["intelligentUiSource"]>
  >();
  for (const task of input.originalTasks) {
    const target = input.targetTasks.find(
      (candidate) =>
        candidate.id === input.taskIdMap.get(task.id) &&
        candidate.sessionId === input.targetSessionId,
    );
    if (!target || task.sessionId !== input.originalSessionId) continue;
    // Research cloning preserves array order; this is its explicit identity mapping.
    task.reportVersions.forEach((report, index) => {
      const copy = target.reportVersions[index];
      if (!copy || copy.version !== report.version) return;
      reports.set(`${task.id}\u0000${report.id}`, {
        kind: "report",
        taskId: target.id,
        reportId: copy.id,
        version: copy.version,
        artifactId: copy.artifactId,
      });
      sourceRefs.set(
        `report:${task.id}:${report.id}`,
        `report:${target.id}:${copy.id}`,
      );
    });
  }
  async function remapAlias(
    alias: string,
    version: string,
    sourceRef?: string,
  ) {
    const candidates = sourceRef
      ? sourceRefs.has(sourceRef)
        ? [[sourceRef, sourceRefs.get(sourceRef)!]]
        : []
      : [...sourceRefs];
    const matching: { alias: string; sourceRef: string }[] = [];
    for (const [before, after] of candidates) {
      if (
        (await getUiSourceAlias(input.originalSessionId, before, version)) ===
        alias
      )
        matching.push({
          alias: await getUiSourceAlias(input.targetSessionId, after, version),
          sourceRef: after,
        });
    }
    return matching.length === 1 ? matching[0] : undefined;
  }
  const nodesById: SessionMessageTree["nodesById"] = {};
  for (const [id, node] of Object.entries(input.clonedTree.nodesById)) {
    const attachments = node.message.attachments?.map((attachment) => {
      const selected = attachment.intelligentUiSource;
      if (!selected) return structuredClone(attachment);
      const mapped = reports.get(
        `${selected.taskId}\u0000${selected.reportId}`,
      );
      return mapped && mapped.version === selected.version
        ? {
            ...structuredClone(attachment),
            url: mapped.artifactId,
            intelligentUiSource: mapped,
          }
        : { ...structuredClone(attachment), localFileMissing: true };
    });
    const outputBlocks = await Promise.all(
      (node.message.outputBlocks ?? []).map(async (block) => {
        if (block.type !== "intelligent_ui") return block;
        const copied = structuredClone(block);
        if (copied.sourceBindings)
          copied.sourceBindings = await Promise.all(
            copied.sourceBindings.map(
              async (binding): Promise<UiSourceBinding> => {
                const mapped =
                  binding.version && binding.sourceRef
                    ? await remapAlias(
                        binding.alias,
                        binding.version,
                        binding.sourceRef,
                      )
                    : undefined;
                return mapped
                  ? {
                      ...binding,
                      ...mapped,
                      bindingId: `${mapped.alias}:${binding.version}`,
                      bindingStatus: "unverified",
                    }
                  : { ...binding, bindingStatus: "unavailable" };
              },
            ),
          );
        const definition = copied.definition;
        if (
          definition &&
          "kind" in definition &&
          definition.kind === "explorer" &&
          definition.props.dataset.kind === "context"
        ) {
          const selector = definition.props.dataset;
          const mapped = await remapAlias(selector.alias, selector.version);
          if (mapped) selector.alias = mapped.alias;
          // Unmatched references deliberately keep the old alias and resolve unavailable.
        }
        return copied;
      }),
    );
    nodesById[id] = {
      ...node,
      message: {
        ...node.message,
        ...(attachments ? { attachments } : {}),
        ...(node.message.outputBlocks ? { outputBlocks } : {}),
      },
    };
  }
  return { ...input.clonedTree, nodesById };
}
