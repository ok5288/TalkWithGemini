import type { Message } from "@/types";
import { useResearchStore } from "@/store/core/researchStore";
import { resolveOPFSBlob } from "@/utils/opfs";
import { projectResearchReportContext } from "../reportContext";

/** Only cards present in the caller's branch may contribute completed reports. */
export async function resolveResearchReportHistory(
  history: Message[],
  sessionId: string,
): Promise<Message[]> {
  const ids = new Set(
    history.flatMap(
      (message) =>
        message.outputBlocks?.flatMap((block) =>
          block.type === "research_task" ? [block.taskId] : [],
        ) ?? [],
    ),
  );
  if (!ids.size) return history;
  await useResearchStore.getState().loadSessionTasks(sessionId);
  const contexts = new Map<string, string>();
  for (const id of ids) {
    const task = useResearchStore.getState().tasksById[id];
    if (
      !task ||
      task.sessionId !== sessionId ||
      !["completed", "partial_completed"].includes(task.status)
    )
      continue;
    const report =
      task.reportVersions.find(
        (item) => item.version === task.activeReportVersion,
      ) ?? task.reportVersions.at(-1);
    if (!report) continue;
    const markdown = await resolveOPFSBlob(report.artifactId)
      .then((blob) => blob?.text() ?? "")
      .catch(() => "");
    // Recheck after storage I/O: a deliberate continuation may have started.
    const latest = useResearchStore.getState().tasksById[id];
    if (
      !latest ||
      latest.sessionId !== sessionId ||
      latest.status !== task.status ||
      latest.activeReportVersion !== task.activeReportVersion
    )
      continue;
    contexts.set(id, projectResearchReportContext(markdown, report));
  }
  return history.map((message) => {
    const reports =
      message.outputBlocks?.flatMap((block) => {
        if (block.type !== "research_task") return [];
        const content = contexts.get(block.taskId);
        contexts.delete(block.taskId);
        return content ? [`Research report context:\n${content}`] : [];
      }) ?? [];
    return reports.length
      ? {
          ...message,
          content: [message.content, ...reports].filter(Boolean).join("\n\n"),
        }
      : message;
  });
}
