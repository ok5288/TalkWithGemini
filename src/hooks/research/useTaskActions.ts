import type { ResearchBudgetPreset } from "@/lib/research/types";
import { useMemo } from "react";

import { useResearchRuntime } from "@/components/research/ResearchRuntimeProvider";

/**
 * Binds the runtime actions to one task id, so the connected views can pass
 * plain callbacks down to the presentational components.
 */
export function useTaskActions(taskId: string) {
  const runtime = useResearchRuntime();
  return useMemo(
    () => ({
      onConfirmPlan: () => void runtime.confirmPlan(taskId),
      onAdjustPlan: (instruction: string) =>
        runtime.adjustPlan(taskId, instruction),
      onUpdatePlanPreset: (preset: ResearchBudgetPreset) =>
        runtime.updatePlanPreset(taskId, preset),
      onPause: () => void runtime.pauseTask(taskId),
      onResume: () => void runtime.resumeTask(taskId),
      onCancel: () => void runtime.cancelTask(taskId),
      onRetry: () => void runtime.retryTask(taskId),
      onDismiss: () => void runtime.cancelTask(taskId),
    }),
    [runtime, taskId],
  );
}
