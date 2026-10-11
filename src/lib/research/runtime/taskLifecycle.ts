import {
  isTerminalResearchStatus,
  transitionResearchTask,
} from "@/lib/research/task";
import { ResearchPersistenceError } from "@/services/research/taskRepository/errors";
import { getResearchTaskRepository } from "@/services/research";
import type { ResearchTask } from "@/lib/research/types";
import { useResearchStore } from "@/store/core/researchStore";
import { logDevError } from "@/lib/utils/devLogger";
import {
  withResearchTaskExecutionLock,
  type ResearchTaskExecutionLease,
} from "@/services/research/taskExecutionLock";

export type LaunchResearch = (
  taskId: string,
  lease?: ResearchTaskExecutionLease,
) => Promise<void>;
export type PrepareResearchPlanAction = (
  taskId: string,
  adjustment?: string,
  requestModel?: string,
  lease?: ResearchTaskExecutionLease,
) => Promise<void>;
export interface ResearchTaskContinuation {
  run: (lease: ResearchTaskExecutionLease) => Promise<void>;
  /** Return the UI/tool action after startup, while retaining its execution lease. */
  background?: boolean;
}

/** Read, validate and mutate the latest persisted task under a single lease. */
export function runResearchTaskAction(
  taskId: string,
  action: (
    task: ResearchTask,
    lease: ResearchTaskExecutionLease,
  ) => Promise<ResearchTaskContinuation | void>,
  onConflict?: () => void,
  options?: { requirePersistence: false },
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    void withResearchTaskExecutionLock(taskId, async (lease) => {
      try {
        const local = useResearchStore.getState().tasksById[taskId];
        const repository = getResearchTaskRepository();
        if (local && options?.requirePersistence !== false)
          await repository.recover?.(local);
        const task =
          options?.requirePersistence === false &&
          !repository.getStatus().durable
            ? local
            : await useResearchStore.getState().refreshTask(taskId);
        if (!task) return;
        const continuation = await action(task, lease);
        if (!continuation) return;
        const running = continuation.run(lease);
        if (continuation.background) resolve();
        await running;
      } catch (error) {
        if (error instanceof ResearchPersistenceError) {
          // Recovery conflicts must never write the local snapshot back to IDB.
          useResearchStore.setState((state) => {
            const task = state.tasksById[taskId];
            return task
              ? {
                  ...(state.activeTaskId === taskId
                    ? { activeTaskId: null }
                    : {}),
                  tasksById: {
                    ...state.tasksById,
                    [taskId]: {
                      ...(isTerminalResearchStatus(task.status)
                        ? task
                        : transitionResearchTask(task, "paused", {
                            checkpoint: task.checkpoint,
                          })),
                      error: {
                        code: `RESEARCH_STORAGE_${error.reason}`,
                        message:
                          "Research progress could not be saved. Please retry or reload the task.",
                        recoverable: true,
                      },
                    },
                  },
                }
              : {};
          });
        }
        throw error;
      }
    }).then(
      (result) => {
        if (!result.acquired) onConflict?.();
        resolve();
      },
      (error) => {
        logDevError("Research task action failed", error);
        reject(error);
      },
    );
  });
}
