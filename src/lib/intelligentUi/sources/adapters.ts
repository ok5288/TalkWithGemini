import type { Attachment, Message, ToolCall } from "@/lib/chat/types";
import type { KnowledgeFile } from "@/lib/knowledge/types";
import type { ResearchTask, ResearchReportVersion } from "@/lib/research/types";
import type { ResearchEvidenceSnapshot } from "@/lib/research/evidenceConversations";
import type { Source } from "@/lib/search/types";
import { resolveToolResultView } from "@/lib/intelligentUi/toolResults/adapters";
import {
  createUiSourceContext,
  hashUiSourceContent,
  publicUiSourceUrl,
} from "./resolver";
import type { UiSourceMaterial } from "./types";

const MAX_SOURCE_TEXT = 1_000_000;

/** Inline attachment text only. Blob/OPFS/network loading stays with the host. */
function attachmentText(attachment: Attachment): string | undefined {
  if (
    !attachment.data ||
    attachment.data.length > MAX_SOURCE_TEXT * 2 ||
    !/^(?:text\/|application\/(?:json|csv))/.test(attachment.mimeType)
  )
    return undefined;
  try {
    const base64 = attachment.data.replace(/^data:[^,]*;base64,/, "");
    const bytes = Uint8Array.from(atob(base64), (character) =>
      character.charCodeAt(0),
    );
    if (bytes.length > MAX_SOURCE_TEXT) return undefined;
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return undefined;
  }
}

export interface MessageSourceInput {
  sessionId: string;
  /** The caller supplies the authorized active branch, never a global message index. */
  messages: readonly Message[];
  knowledgeFiles?: readonly KnowledgeFile[];
  researchTasks?: readonly ResearchTask[];
  /** Already authorized, fixed published snapshots; this adapter never fetches versions. */
  researchSnapshots?: readonly ResearchEvidenceSnapshot[];
  attachmentTexts?: ReadonlyMap<string, string>;
  canAccessTool?: (tool: ToolCall) => boolean;
}

export async function createMessageSourceContext(input: MessageSourceInput) {
  const materials: UiSourceMaterial[] = [];
  const add = async (
    source: Omit<UiSourceMaterial, "contentHash" | "version"> & {
      version?: string;
    },
    hashInput?: string,
  ) => {
    const contentHash = await hashUiSourceContent(
      hashInput ?? source.content ?? "",
    );
    materials.push({
      ...source,
      contentHash,
      version: source.version ?? contentHash,
    });
  };
  const addSearch = async (
    source: Source,
    message: Message,
    index: number,
    knowledge: boolean,
  ) => {
    const fileId = source.metadata?.fileId;
    const file = knowledge
      ? input.knowledgeFiles?.find(
          (candidate) => candidate.id === fileId || candidate.ragId === fileId,
        )
      : undefined;
    const access =
      knowledge && (!file || file.sourceMissing) ? "denied" : "allowed";
    const chunk = source.metadata?.chunkIndex;
    const locator =
      Number.isSafeInteger(chunk) && Number(chunk) >= 0
        ? `chunk:${chunk}`
        : undefined;
    const content = source.content.slice(0, MAX_SOURCE_TEXT);
    const changedSinceCapture =
      knowledge &&
      ((file?.contentEditedAt ?? 0) > message.timestamp ||
        (typeof source.metadata?.chunkingRevision === "string" &&
          source.metadata.chunkingRevision !== file?.indexedChunkingRevision));
    await add({
      sessionId: input.sessionId,
      sourceRef: `${message.id}:${knowledge ? "knowledge" : "web"}:${index}`,
      kind: knowledge ? "knowledge" : "web",
      title: source.title,
      content,
      locator,
      access,
      availability:
        content && !changedSinceCapture ? "available" : "unavailable",
      retentionPolicy: knowledge ? "session" : "fixed-snapshot",
      capturedAt: message.timestamp,
      ...(knowledge
        ? {
            version: `${file?.contentEditedAt ?? file?.uploadedAt ?? "unknown"}:${file?.indexedChunkingRevision ?? "text"}:${await hashUiSourceContent(content)}`,
          }
        : {
            publicMetadata: {
              title: source.title,
              url: publicUiSourceUrl(source.url),
            },
          }),
    });
  };
  for (const message of input.messages) {
    for (const attachment of message.attachments ?? []) {
      // A published report requires its research authorization/version checks below.
      // Never reclassify its cached body as an ordinary attachment after revocation.
      if (attachment.intelligentUiSource?.kind === "report") continue;
      const provided = input.attachmentTexts?.get(attachment.id);
      const content =
        provided !== undefined && provided.length <= MAX_SOURCE_TEXT
          ? provided
          : attachmentText(attachment);
      await add({
        sessionId: input.sessionId,
        sourceRef: `${message.id}:attachment:${attachment.id}`,
        kind: "attachment",
        title: attachment.fileName,
        content,
        access: attachment.localFileMissing ? "denied" : "allowed",
        availability: content !== undefined ? "available" : "unavailable",
        retentionPolicy: "session",
        capturedAt: message.timestamp,
      });
    }
    for (const [index, source] of (message.searchSources ?? []).entries())
      await addSearch(source, message, index, false);
    for (const [index, source] of (message.ragSources ?? []).entries())
      await addSearch(source, message, index, true);
    const calls = new Map(
      (message.toolCalls ?? []).map((call) => [call.id, call]),
    );
    for (const block of message.outputBlocks ?? [])
      if (block.type === "tool_group")
        for (const call of block.toolCalls) calls.set(call.id, call);
    for (const tool of calls.values()) {
      if (
        tool.status !== "success" ||
        tool.isError ||
        tool.result === undefined
      )
        continue;
      const view = await resolveToolResultView(tool);
      if (!view) continue;
      const content = JSON.stringify(view.dataset);
      if (!content || content.length > MAX_SOURCE_TEXT) continue;
      await add({
        sessionId: input.sessionId,
        sourceRef: `${message.id}:tool:${tool.executionRecordId ?? tool.id}`,
        kind: "tool",
        title: tool.pluginTitle ?? tool.name,
        content,
        version: view.descriptor.resultHash,
        access: input.canAccessTool?.(tool) ? "allowed" : "unknown",
        availability: "available",
        retentionPolicy: "session",
        capturedAt: view.descriptor.retrievedAt,
      });
    }
  }
  for (const snapshot of input.researchSnapshots ?? []) {
    const task = input.researchTasks?.find(
      (item) =>
        item.id === snapshot.taskId && item.sessionId === input.sessionId,
    );
    const report = task?.reportVersions.find(
      (item) =>
        item.id === snapshot.reportId &&
        item.artifactId === snapshot.artifactId &&
        item.researchRunId === snapshot.runId,
    );
    if (!task || !report || snapshot.sessionId !== input.sessionId) continue;
    materials.push(
      ...(await createResearchSourceMaterials(task, report, snapshot)),
    );
  }
  return createUiSourceContext(input.sessionId, materials);
}

/** Published report and evidence stay bound to the requested snapshot, never latest. */
export async function createResearchSourceMaterials(
  task: ResearchTask,
  report: ResearchReportVersion,
  snapshot: ResearchEvidenceSnapshot,
): Promise<UiSourceMaterial[]> {
  if (
    task.sessionId !== snapshot.sessionId ||
    task.id !== snapshot.taskId ||
    report.id !== snapshot.reportId ||
    report.artifactId !== snapshot.artifactId ||
    report.researchRunId !== snapshot.runId ||
    !task.reportVersions.some(
      (candidate) =>
        candidate.id === report.id &&
        candidate.artifactId === report.artifactId &&
        candidate.version === report.version,
    ) ||
    !["completed", "partial_completed"].includes(task.status)
  )
    return [];
  const contentHash = await hashUiSourceContent(snapshot.reportMarkdown);
  const base: UiSourceMaterial = {
    sessionId: task.sessionId,
    sourceRef: `report:${task.id}:${report.id}`,
    kind: "report",
    title: task.goal,
    version: String(report.version),
    contentHash,
    content: snapshot.reportMarkdown,
    capturedAt: report.createdAt,
    locator: `report:${report.version}`,
    access: "allowed",
    availability: "available",
    retentionPolicy: "session",
  };
  return [
    base,
    ...snapshot.evidence.map((evidence): UiSourceMaterial => ({
      sessionId: task.sessionId,
      sourceRef: `evidence:${snapshot.id}:${evidence.id}`,
      kind: "evidence",
      title: evidence.title ?? task.goal,
      version: `${report.version}:${evidence.contentHash}`,
      contentHash: evidence.contentHash,
      capturedAt: evidence.retrievedAt,
      locator: evidence.locator,
      access: "allowed",
      availability:
        evidence.availability === "unavailable" ? "unavailable" : "available",
      retentionPolicy: "session",
    })),
  ];
}
