import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import type { ResearchTaskViewModel } from "@/components/research";
import {
  formatToolDisplayName,
  getBuiltinToolLabelKey,
} from "@/lib/utils/toolDisplay";
import { useAgentRunStore } from "@/store/core/agentRunStore";
import { useResearchStore } from "@/store/core/researchStore";

import {
  createResearchTaskViewModel,
  type ResearchViewModelText,
} from "@/components/research/viewModel";

/**
 * Rebuilds the presentation model whenever the task or its agent runs change,
 * with every string resolved through the Research and Content namespaces.
 */
export function useResearchTaskViewModel(taskId: string | null) {
  const t = useTranslations("Research");
  const contentT = useTranslations("Content");
  const task = useResearchStore((state) =>
    taskId ? state.tasksById[taskId] : undefined,
  );
  const runsById = useAgentRunStore((state) => state.runsById);
  const [viewModel, setViewModel] = useState<ResearchTaskViewModel>();
  const text = useMemo<ResearchViewModelText>(() => {
    const getToolDisplayName = (tool: string) => {
      const labelKey = getBuiltinToolLabelKey(tool);
      return labelKey ? contentT(labelKey) : formatToolDisplayName(tool);
    };
    return {
      artifactUnavailable: t("report.artifactUnavailable"),
      fallbackReportTitle: (version) => t("report.fallbackTitle", { version }),
      taskCreatedTitle: t("activity.taskCreated"),
      taskCreatedDetail: t("activity.noSourceBeforeApproval"),
      planPreparedTitle: (version) => t("activity.planPrepared", { version }),
      planAdjustedDetail: t("activity.planAdjusted"),
      planApprovalDetail: t("activity.planAwaitingApproval"),
      reportPublishedTitle: (version) =>
        t("activity.reportPublished", { version }),
      toolRunningTitle: (tool) =>
        t("activity.toolRunning", { tool: getToolDisplayName(tool) }),
      toolCommittedTitle: (tool) =>
        t("activity.toolCommitted", { tool: getToolDisplayName(tool) }),
      toolFailedTitle: (tool) =>
        t("activity.toolFailed", { tool: getToolDisplayName(tool) }),
      toolSkippedTitle: (tool: string) =>
        t("activity.toolSkipped", { tool: getToolDisplayName(tool) }),
      duplicateSkippedDetail: t("activity.duplicateSkippedDetail"),
      toolEffectUnknownTitle: (tool) =>
        t("activity.toolEffectUnknown", { tool: getToolDisplayName(tool) }),
      toolInterruptedTitle: (tool) =>
        t("activity.toolInterrupted", { tool: getToolDisplayName(tool) }),
      toolSourceDetail: (source) => t("activity.toolSource", { source }),
      internalToolResultSource: t("evidence.internalResult"),
      toolSafeDetail: t("activity.toolSafeDetail"),
      storageErrorDetails: {
        RESEARCH_STORAGE_checkpoint: t("runtime.error.storage.checkpoint"),
        RESEARCH_STORAGE_indexeddb_unavailable: t(
          "runtime.error.storage.indexeddb_unavailable",
        ),
        RESEARCH_STORAGE_indexeddb_operation_failed: t(
          "runtime.error.storage.indexeddb_operation_failed",
        ),
        RESEARCH_STORAGE_quota: t("runtime.error.storage.quota"),
        RESEARCH_STORAGE_blocked: t("runtime.error.storage.blocked"),
        RESEARCH_STORAGE_validation: t("runtime.error.storage.validation"),
        RESEARCH_STORAGE_conflict: t("runtime.error.storage.conflict"),
        RESEARCH_STORAGE_report_verification: t(
          "runtime.error.storage.report_verification",
        ),
      },
      searchFailedDetail: t("activity.searchFailedDetail"),
      searchErrorDetails: {
        SEARCH_RATE_LIMITED: t("activity.searchErrors.rateLimited"),
        RESEARCH_SEARCH_TIMEOUT: t("activity.searchErrors.requestTimeout"),
        RESPONSE_TIMEOUT: t("activity.searchErrors.requestTimeout"),
        RESEARCH_RECON_TIMEOUT: t("activity.searchErrors.deadlineExceeded"),
        RESEARCH_QUERY_BUDGET_EXHAUSTED: t(
          "activity.searchErrors.budgetExhausted",
        ),
        RESEARCH_QUERY_NOT_ALLOWED: t("activity.searchErrors.outOfScope"),
        RESEARCH_SEARCH_SCOPE_CONFLICT: t(
          "activity.searchErrors.scopeConflict",
        ),
        SEARCH_UPSTREAM_ERROR: t("activity.searchErrors.upstream"),
        WEB_SEARCH_INVALID_QUERY: t("activity.searchErrors.invalidQuery"),
      },
      degradedWaveTitle: (wave) => t("activity.degradedWaveTitle", { wave }),
      degradedWaveDetail: (count) =>
        t("activity.degradedWaveDetail", { count }),
      scopeExpansionTitle: t("activity.scopeExpansionTitle"),
      scopeExpansionDetail: (count) =>
        t("activity.scopeExpansionDetail", { count }),
      scopeExpansionLimitedDetail: (count) =>
        t("activity.scopeExpansionLimitedDetail", { count }),
      reportKind: {
        initial: t("activity.reportKind.initial"),
        continue: t("activity.reportKind.continue"),
        update: t("activity.reportKind.update"),
      },
      statusTitle: (status) =>
        t("activity.status", { status: t(`status.${status}`) }),
    };
  }, [contentT, t]);

  useEffect(() => {
    let cancelled = false;
    if (!task) {
      setViewModel(undefined);
      return;
    }
    setViewModel((current) => (current?.id === task.id ? current : undefined));
    void useAgentRunStore.getState().loadSessionRuns(task.sessionId);
    void createResearchTaskViewModel(task, runsById, text).then((next) => {
      if (!cancelled) setViewModel(next);
    });
    return () => {
      cancelled = true;
    };
  }, [runsById, task, text]);

  return { task, viewModel };
}
