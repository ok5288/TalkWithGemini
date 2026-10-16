import { getResearchModelErrorCode } from "@/lib/chat/providerErrors";
import { isResearchConnectionError } from "../connectionErrors";
import { ResearchPersistenceError } from "@/services/research/taskRepository/errors";
import {
  applyResearchRunUserStop,
  finalizeResearchReportRun,
  getActiveResearchReportRun,
  transitionResearchTask,
  upsertResearchReportRun,
  type ResearchCheckpoint,
} from "@/lib/research";
import { logDevError } from "@/lib/utils/devLogger";

import type { ResearchExecutionContext } from "../executionContext";
import {
  ResearchCheckpointUnavailableError,
  ResearchWorkspaceUnavailableError,
} from "../dependencyErrors";
import { isAbortError } from "../operations";
import {
  deliverResearchReport,
  ResearchReportDeliveryError,
} from "../reportDelivery";
import { aggregateTaskUsage } from "../usage";

/**
 * Terminal handling for a run that threw: a user abort pauses resumably, and
 * anything else still tries to publish a deterministic salvage report before
 * the task is reported as failed.
 */
export async function handleExecutionFailure(
  ctx: ResearchExecutionContext,
  error: unknown,
  onError?: (message: string) => void,
): Promise<void> {
  const current = ctx.store.tasksById[ctx.taskId];
  if (!current || current.status === "cancelled") return;
  if (
    error instanceof ResearchWorkspaceUnavailableError ||
    error instanceof ResearchCheckpointUnavailableError
  ) {
    const dependencyCode = error.code;
    const pausedAt = Date.now();
    const pausedRun = {
      ...applyResearchRunUserStop(ctx.run, "pause", pausedAt),
      stopReason: {
        code: "dependency_unavailable" as const,
        at: pausedAt,
        detail: error.message,
      },
    };
    const checkpoint: ResearchCheckpoint = current.checkpoint
      ? { ...current.checkpoint }
      : {
          createdAt: pausedAt,
          resumeStatus: "researching",
          committedEvidenceIds: ctx.evidence.map((item) => item.id),
          committedToolExecutionIds:
            pausedRun.checkpoint?.committedToolExecutionIds || [],
          ...(ctx.imageSources?.length
            ? {
                committedImageSourceIds: ctx.imageSources.map(
                  (image) => image.id,
                ),
              }
            : {}),
          researchRunId: pausedRun.id,
        };
    const message =
      error instanceof ResearchCheckpointUnavailableError
        ? error.message
        : ctx.dependencyText.sourceUnavailable("workspace");
    await ctx.store.updateTask(
      ctx.taskId,
      (latest) => ({
        ...transitionResearchTask(
          upsertResearchReportRun(latest, pausedRun),
          "paused",
          { checkpoint },
        ),
        checkpoint,
        error: {
          code: dependencyCode,
          message,
          recoverable: true,
        },
      }),
      { persistence: "best-effort" },
    );
    ctx.store.setActiveTask(null);
    ctx.onNotice?.(message);
    return;
  }
  const connectionLost =
    !isAbortError(error) &&
    !ctx.controller.signal.aborted &&
    !(error instanceof ResearchPersistenceError) &&
    !(error instanceof ResearchReportDeliveryError) &&
    isResearchConnectionError(error);
  if (
    !(error instanceof ResearchPersistenceError) &&
    !(error instanceof ResearchReportDeliveryError) &&
    (isAbortError(error) || ctx.controller.signal.aborted || connectionLost)
  ) {
    if (
      current.status === "completed" ||
      current.status === "partial_completed"
    ) {
      ctx.store.setActiveTask(null);
      return;
    }
    const pausedRun = applyResearchRunUserStop(ctx.run, "pause");
    const checkpoint: ResearchCheckpoint = current.checkpoint
      ? { ...current.checkpoint }
      : {
          createdAt: Date.now(),
          resumeStatus:
            current.status === "synthesizing"
              ? "synthesizing"
              : current.status === "verifying"
                ? "verifying"
                : "researching",
          committedEvidenceIds: ctx.evidence.map((item) => item.id),
          committedToolExecutionIds:
            pausedRun.checkpoint?.committedToolExecutionIds || [],
          ...(ctx.imageSources?.length
            ? {
                committedImageSourceIds: (ctx.imageSources ?? []).map(
                  (image) => image.id,
                ),
              }
            : {}),
          researchRunId: pausedRun.id,
        };
    await ctx.store.updateTask(
      ctx.taskId,
      (latest) => {
        if (latest.status === "cancelled") return latest;
        const withRun = upsertResearchReportRun(latest, pausedRun);
        const paused =
          latest.status === "paused"
            ? { ...withRun, checkpoint }
            : transitionResearchTask(withRun, "paused", { checkpoint });
        return connectionLost
          ? {
              ...paused,
              error: {
                code: "RESEARCH_CONNECTION_LOST",
                message: ctx.t("runtime.error.connectionLost"),
                recoverable: true,
              },
            }
          : paused;
      },
      { persistence: "best-effort" },
    );
    ctx.store.setActiveTask(null);
    return;
  }
  if (
    !(error instanceof ResearchReportDeliveryError) &&
    !(error instanceof ResearchPersistenceError)
  ) {
    try {
      await deliverResearchReport(ctx, { interruption: error });
      return;
    } catch (salvageError) {
      if (
        !(salvageError instanceof ResearchPersistenceError) &&
        !(salvageError instanceof ResearchReportDeliveryError) &&
        (isAbortError(salvageError) || ctx.controller.signal.aborted)
      ) {
        return handleExecutionFailure(ctx, salvageError, onError);
      }
      logDevError("Failed to salvage Deep Research report", salvageError);
      if (
        salvageError instanceof ResearchPersistenceError ||
        salvageError instanceof ResearchReportDeliveryError
      )
        error = salvageError;
    }
  }
  const failedAt = Date.now();
  await ctx.store.updateTask(
    ctx.taskId,
    (latest) => {
      const activeRun = getActiveResearchReportRun(latest) ?? ctx.run;
      const withRun = upsertResearchReportRun(
        latest,
        finalizeResearchReportRun(activeRun, "failed", failedAt),
      );
      return {
        ...transitionResearchTask(withRun, "failed", { now: failedAt }),
        usage: aggregateTaskUsage(withRun),
        error: {
          code:
            error instanceof ResearchPersistenceError ||
            error instanceof ResearchReportDeliveryError
              ? "RESEARCH_EXECUTION_FAILED"
              : getResearchModelErrorCode(error),
          message: ctx.localizedRuntimeError(error, "executionFallback"),
          recoverable: true,
        },
      };
    },
    { persistence: "best-effort" },
  );
  ctx.store.setActiveTask(null);
  onError?.(ctx.t("runtime.error.report"));
}
