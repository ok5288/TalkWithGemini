import { useChatStore } from "@/store/core/chatStore";
import { isTemporarySession } from "@/lib/chat/sessionRetention";
import { normalizeChatMode } from "@/lib/chat/mode";
import { selectVisibleResearchTaskId } from "@/lib/research/pendingTask";
import {
  createReportSectionLabels,
  projectResearchReport,
} from "@/lib/research/reportSections";
import { createReportFallbackText } from "@/lib/research/reportFallbackText";
import {
  auditResearchReport,
  buildDeterministicSalvageReport,
  normalizeResearchReportMarkdown,
} from "@/lib/research";
import { getUnansweredSteeringQuestions } from "@/lib/research/steering";

import type { ResearchExecutionContext } from "./executionContext";
import { publishResearchReportVersion } from "./reportPublication";
import { isAbortError } from "./operations";

/** Publication failures must not start another report or masquerade as success. */
export class ResearchReportDeliveryError extends Error {
  constructor(cause: unknown) {
    super(
      cause instanceof Error ? cause.message : "Report publication failed.",
      { cause },
    );
    this.name = "ResearchReportDeliveryError";
  }
}

/** Both normal completion and recovery preserve the best available report. */
export async function deliverResearchReport(
  ctx: ResearchExecutionContext,
  {
    markdown,
    interruption,
  }: { markdown?: string; interruption?: unknown } = {},
) {
  ctx.controller.signal.throwIfAborted();
  const current = ctx.store.tasksById[ctx.taskId];
  if (!current || current.status === "cancelled") return;
  const extraGaps = [
    ...(interruption !== undefined
      ? [
          ctx.t("runtime.gaps.executionInterrupted"),
          ctx.localizedRuntimeError(interruption, "executionFallback"),
        ]
      : []),
    ...getUnansweredSteeringQuestions(ctx.run, ctx.steeringRecord),
  ];
  const sectionLabels = createReportSectionLabels((key) => ctx.t(key));
  const generatedBody =
    normalizeResearchReportMarkdown(markdown ?? ctx.reportDraft ?? "") ||
    buildDeterministicSalvageReport({
      task: current,
      plan: ctx.plan,
      run: ctx.run,
      evidence: ctx.evidence,
      reason: ctx.t("runtime.gaps.executionInterrupted"),
      sectionLabels,
      text: createReportFallbackText((key) => ctx.t(key)),
    });
  const body = projectResearchReport(generatedBody, sectionLabels).markdown;
  ctx.reportDraft = body;
  const audit = auditResearchReport({
    markdown: body,
    plan: ctx.plan,
    run: ctx.run,
    evidence: ctx.evidence,
    imageSources: ctx.imageSources,
  });
  let gaps: string[];
  try {
    gaps = await publishResearchReportVersion({
      taskId: ctx.taskId,
      plan: ctx.plan,
      run: {
        ...ctx.run,
        phase: "synthesizing",
        ...(interruption !== undefined && !ctx.run.stopReason
          ? {
              stopReason: {
                code: "dependency_unavailable" as const,
                at: Date.now(),
              },
            }
          : {}),
      },
      markdown: body,
      sectionLabels,
      evidence: ctx.evidence,
      extraGaps,
      audit,
      agentRunId: ctx.lastAgentRunId,
      noEvidenceGap: ctx.t("runtime.gaps.noEvidence"),
      noKeyFindingsGap: ctx.t("runtime.gaps.noKeyFindings"),
      incompleteQuestionsGap: (count) =>
        ctx.t("runtime.gaps.incompleteQuestions", { count }),
      singleSourceNote: (count, total) =>
        ctx.t("report.singleSourceNote", { count, total }),
      publicationNotice: ctx.t("report.knowledgeNotice"),
      noEvidenceNotice: ctx.t("report.noEvidenceNotice"),
      auditWarning: (count) => ctx.t("runtime.gaps.auditWarning", { count }),
      snapshotUnavailableWarning: ctx.t("runtime.gaps.snapshotUnavailable"),
      signal: ctx.controller.signal,
      persistenceError: ctx.t("runtime.error.persistence"),
    });
  } catch (error) {
    if (isAbortError(error) || ctx.controller.signal.aborted) throw error;
    throw new ResearchReportDeliveryError(error);
  }
  const deliveredTask = ctx.store.tasksById[ctx.taskId];
  const chat = useChatStore.getState();
  const session = chat.sessions.find((item) => item.id === ctx.task.sessionId);
  const otherTasks = Object.fromEntries(
    Object.entries(ctx.store.tasksById).filter(([id]) => id !== ctx.taskId),
  );
  if (
    session &&
    deliveredTask &&
    ["completed", "partial_completed"].includes(deliveredTask.status) &&
    !ctx.controller.signal.aborted &&
    !isTemporarySession(session) &&
    normalizeChatMode(
      session.config?.chatMode,
      session.config?.useAgentMode,
      session.config?.useDeepResearch,
    ) === "research" &&
    !selectVisibleResearchTaskId(
      { tasksById: otherTasks, activeTaskId: null },
      session.id,
    )
  ) {
    chat.setSessionChatMode(session.id, "auto");
  }
  ctx.reportDraft = undefined;
  if (ctx.store.activeTaskId === ctx.taskId) ctx.store.setActiveTask(null);
  ctx.onNotice?.(
    gaps.length > 0
      ? ctx.t("runtime.notice.reportPartial")
      : ctx.t("runtime.notice.reportReady"),
  );
}
