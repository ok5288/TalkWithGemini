import type { ResearchTask } from "@/lib/research/types";
import { restoreResearchTaskAfterPlanning } from "@/lib/research/task";
import {
  withResearchTaskExecutionLock,
  type ResearchTaskExecutionLease,
} from "@/services/research/taskExecutionLock";
import { useResearchStore } from "@/store/core/researchStore";
import { useCallback } from "react";

import type { ToolConfirmationController } from "@/types";

import type {
  ResearchRuntimeErrorText,
  ResearchTranslate,
} from "@/lib/research/runtime/executionContext";
import type { RunResearchOperation } from "@/lib/research/runtime/operations";
import { recordResearchModuleLoadFailure } from "@/lib/research/runtime/moduleLoadFailure";

/**
 * Binds the planning stage to the operation registry so a task can only have
 * one planning round in flight at a time.
 */
export function usePreparePlan({
  runOperation,
  toolConfirmationController,
  t,
  localizedRuntimeError,
  locale,
  onError,
  onNotice,
}: {
  runOperation: RunResearchOperation;
  toolConfirmationController?: ToolConfirmationController;
  t: ResearchTranslate;
  localizedRuntimeError: ResearchRuntimeErrorText;
  locale?: string;
  onError?: (message: string) => void;
  onNotice?: (message: string) => void;
}) {
  return useCallback(
    async (
      taskId: string,
      adjustment?: string,
      requestModel?: string,
      lease?: ResearchTaskExecutionLease,
      previousTask?: ResearchTask,
    ) => {
      const result = await withResearchTaskExecutionLock(
        taskId,
        async (planningLease) => {
          const task = await useResearchStore.getState().refreshTask(taskId);
          if (
            !task ||
            !["draft", "clarifying", "plan_ready", "paused", "failed"].includes(
              task.status,
            )
          )
            return;
          const beforePlanning = previousTask || task;
          await runOperation(taskId, "planning", async (controller) => {
            const restore = async (error: unknown) => {
              const message = t("runtime.error.adjustFailed");
              await useResearchStore.getState().updateTask(
                taskId,
                (current) =>
                  restoreResearchTaskAfterPlanning(current, beforePlanning, {
                    code: "RESEARCH_PLAN_FAILED",
                    message,
                    recoverable: true,
                  }),
                { persistence: "best-effort" },
              );
              throw new Error(message, { cause: error });
            };
            const runtime =
              await import("@/lib/research/runtime/preparePlan").catch(
                async (error) => {
                  if (beforePlanning.planVersions.length) return restore(error);
                  const failed = await recordResearchModuleLoadFailure({
                    taskId,
                    phase: "planning",
                    lease: planningLease,
                    signal: controller.signal,
                    message: localizedRuntimeError(error, "planFallback"),
                    error,
                  });
                  if (failed) onError?.(t("runtime.error.plan"));
                  return null;
                },
              );
            if (!runtime) return;
            if (controller.signal.aborted) {
              if (beforePlanning.planVersions.length)
                await restore(controller.signal.reason);
              return;
            }
            await runtime.prepareResearchPlan({
              taskId,
              previousTask: beforePlanning,
              adjustment,
              requestModel,
              controller,
              toolConfirmationController,
              t,
              localizedRuntimeError,
              locale,
              onError,
              onNotice,
            });
          });
        },
        lease,
      );
      if (!result.acquired) {
        const message = t("runtime.dependency.leaseConflict");
        onNotice?.(message);
        throw new Error(message);
      }
    },
    [
      onError,
      onNotice,
      localizedRuntimeError,
      locale,
      runOperation,
      t,
      toolConfirmationController,
    ],
  );
}
