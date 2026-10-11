import type { Message } from "@/lib/chat/types";
import type { ResearchTask } from "@/lib/research/types";
import type { ResearchEvidenceSnapshot } from "@/lib/research/evidenceConversations";

async function readPublishedSnapshot(reportId: string) {
  const [{ getResearchExtensionRepository }, { parseEvidenceSnapshot }] =
    await Promise.all([
      import("@/services/research/extensionRepository"),
      import("@/services/research/evidenceConversations"),
    ]);
  return parseEvidenceSnapshot(
    await getResearchExtensionRepository().get("evidence_snapshot", reportId),
  );
}

/** Read only selected, session-owned published snapshots. Never reconstruct or select latest. */
export async function loadUiResearchSnapshots(
  input: {
    sessionId: string;
    messages: readonly Message[];
    researchTasks: readonly ResearchTask[];
  },
  readSnapshot: (
    reportId: string,
  ) => Promise<ResearchEvidenceSnapshot | null> = readPublishedSnapshot,
): Promise<ResearchEvidenceSnapshot[]> {
  const snapshots: ResearchEvidenceSnapshot[] = [];
  const seen = new Set<string>();
  for (const message of input.messages)
    for (const attachment of message.attachments ?? []) {
      const selected = attachment.intelligentUiSource;
      if (
        !selected ||
        selected.kind !== "report" ||
        seen.has(selected.reportId)
      )
        continue;
      const task = input.researchTasks.find(
        (candidate) =>
          candidate.id === selected.taskId &&
          candidate.sessionId === input.sessionId,
      );
      const report = task?.reportVersions.find(
        (candidate) =>
          candidate.id === selected.reportId &&
          candidate.version === selected.version &&
          candidate.artifactId === selected.artifactId &&
          attachment.url === candidate.artifactId,
      );
      if (!task || !report || report.evidenceSnapshotStatus === "unavailable")
        continue;
      seen.add(report.id);
      try {
        const snapshot = await readSnapshot(report.id);
        if (
          snapshot &&
          snapshot.sessionId === input.sessionId &&
          snapshot.taskId === task.id &&
          snapshot.reportId === report.id &&
          snapshot.artifactId === report.artifactId &&
          snapshot.runId === report.researchRunId
        )
          snapshots.push(snapshot);
      } catch {
        /* A missing/revoked snapshot is unavailable, never replaced by newer material. */
      }
    }
  return snapshots;
}
