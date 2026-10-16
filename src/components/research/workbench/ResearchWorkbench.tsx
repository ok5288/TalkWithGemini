"use client";

import dynamic from "next/dynamic";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { FileText, X } from "lucide-react";
import { useTranslations } from "next-intl";

import {
  Button,
  Dialog,
  IconButton,
  InlineStatus,
} from "@/components/ui/primitives";
import { cn } from "@/lib/utils/cn";
import { createReportSectionLabels } from "@/lib/research/reportSectionLabels";

import { StatusLabel, TaskActions, formatDuration } from "../ui";
import type { ResearchTaskActions, ResearchTaskViewModel } from "../types";

import { EvidencePanel } from "./EvidencePanel";
import { ProcessPanel } from "./ProcessPanel";
import { ReportPanel } from "./ReportPanel";
import {
  WORKBENCH_TABS,
  type WorkbenchTab,
  createReportPresentation,
  handleTabKeyDown,
} from "./workbenchUtils";

const EvidenceQuestionsPanel = dynamic(
  () => import("./EvidenceQuestionsPanel"),
  { ssr: false, loading: EvidenceQuestionsLoading },
);
const ResearchFollowupDialog = dynamic(
  () =>
    import("./ResearchFollowupDialog").then(
      (module) => module.ResearchFollowupDialog,
    ),
  { ssr: false },
);

function EvidenceQuestionsLoading() {
  const t = useTranslations("EvidenceQuestions");
  return (
    <div
      role="status"
      aria-label={t("loading")}
      className="min-h-32 p-4 text-sm text-muted-foreground sm:p-6"
    >
      {t("loading")}
    </div>
  );
}

export interface ResearchWorkbenchProps extends ResearchTaskActions {
  task: ResearchTaskViewModel;
  onClose: () => void;
  onSelectReportVersion?: (versionId: string) => void;
  onSelectEvidence?: (evidenceId: string) => void;
  onDownloadMarkdown?: (versionId: string) => void;
  onPrintPdf?: (versionId: string) => void;
  onInteractiveExplanation?: (versionId: string) => void;
  onContinueResearch?: (instruction: string) => void | Promise<void>;
  onUpdateLatest?: () => void | Promise<void>;
}

export default function ResearchWorkbench({
  task,
  onClose,
  onConfirmPlan,
  onAdjustPlan,
  onUpdatePlanPreset,
  onPause,
  onResume,
  onCancel,
  onRetry,
  onDismiss,
  onNewFollowUp,
  onSelectReportVersion,
  onSelectEvidence,
  onDownloadMarkdown,
  onPrintPdf,
  onInteractiveExplanation,
  onContinueResearch,
  onUpdateLatest,
}: ResearchWorkbenchProps) {
  const t = useTranslations("Research");
  const questionText = useTranslations("EvidenceQuestions");
  const [selectedTab, setTab] = useState<WorkbenchTab | null>(null);
  const tab =
    selectedTab ?? (task.reportVersions.length > 0 ? "report" : "process");
  const [followupOpen, setFollowupOpen] = useState(false);
  const [questionsOpen, setQuestionsOpen] = useState(false);
  const [selectedVersionId, setSelectedVersionId] = useState(
    task.activeReportVersionId ?? task.reportVersions.at(-1)?.id,
  );
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, [task.id]);

  const effectiveVersionId = task.reportVersions.some(
    (version) => version.id === selectedVersionId,
  )
    ? selectedVersionId
    : (task.activeReportVersionId ?? task.reportVersions.at(-1)?.id);
  const report = useMemo(
    () =>
      task.reportVersions.find((version) => version.id === effectiveVersionId),
    [effectiveVersionId, task.reportVersions],
  );
  const reportPresentation = useMemo(() => {
    if (!report) {
      return {
        markdown: "",
        bodyMarkdown: "",
        notesMarkdown: "",
        sourcesMarkdown: "",
        sources: [],
      };
    }
    const labels = createReportSectionLabels((key) => t(key));
    return createReportPresentation(report.markdown, task.evidence, labels);
  }, [report, t, task.evidence]);

  const selectVersion = (versionId: string) => {
    setSelectedVersionId(versionId);
    onSelectReportVersion?.(versionId);
  };
  const inspectEvidence = (evidenceId: string) => {
    onSelectEvidence?.(evidenceId);
    setTab("sources");
    window.requestAnimationFrame(() => {
      document.getElementById(`research-evidence-${evidenceId}`)?.focus();
    });
  };
  const tabLabel = (item: WorkbenchTab) => t(`tabs.${item}`);

  return (
    <section
      className="flex h-full min-h-0 flex-col bg-background text-foreground"
      aria-labelledby={`research-workbench-${task.id}`}
    >
      <header className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-3 sm:px-6">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted ring-1 ring-border">
          <FileText size={18} aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <h1
            ref={headingRef}
            id={`research-workbench-${task.id}`}
            tabIndex={-1}
            className="truncate text-base font-semibold"
          >
            {task.title}
          </h1>
          <div
            className="flex items-center gap-2 text-xs text-muted-foreground"
            aria-live="polite"
            aria-atomic="true"
          >
            <StatusLabel status={task.status} />
            <span aria-hidden="true">·</span>
            <span className="tabular-nums">
              {formatDuration(task.usage.elapsedMs)}
            </span>
          </div>
        </div>
        <IconButton
          label={t("actions.closeWorkbench")}
          icon={<X size={18} />}
          onClick={onClose}
        />
      </header>

      {task.error ? (
        <div className="shrink-0 border-b border-border px-4 py-3">
          <div className="mx-auto max-w-3xl">
            <InlineStatus tone="danger" live>
              {task.error.message}
            </InlineStatus>
          </div>
        </div>
      ) : null}

      <nav
        className="shrink-0 overflow-x-auto border-b border-border"
        aria-label={t("workbench.contentTabs")}
        role="tablist"
      >
        <div className="mx-auto flex min-w-max max-w-3xl px-2 sm:px-4">
          {WORKBENCH_TABS.map((item, index) => (
            <Button
              key={item}
              variant="bare"
              id={`research-tab-${task.id}-${item}`}
              role="tab"
              tabIndex={tab === item ? 0 : -1}
              aria-selected={tab === item}
              aria-controls={`research-panel-${task.id}-${item}`}
              className={cn(
                "h-11 shrink-0 border-b-2 px-3 text-sm font-medium md:h-9",
                tab === item
                  ? "border-research-accent text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
              onClick={() => setTab(item)}
              onKeyDown={(event) =>
                handleTabKeyDown({ event, index, select: setTab })
              }
            >
              {tabLabel(item)}
              {item === "sources" ? ` (${task.evidence.length})` : ""}
            </Button>
          ))}
        </div>
      </nav>

      <main
        id={`research-panel-${task.id}-${tab}`}
        role="tabpanel"
        aria-labelledby={`research-tab-${task.id}-${tab}`}
        aria-label={tabLabel(tab)}
        className="min-h-0 flex-1 overflow-y-auto"
      >
        {tab === "sources" ? (
          <EvidencePanel
            task={task}
            sourcesMarkdown={reportPresentation.sourcesMarkdown}
            reportSources={reportPresentation.sources}
            onInspectEvidence={inspectEvidence}
          />
        ) : null}
        {tab === "process" ? (
          <ProcessPanel
            task={task}
            claims={report?.claims ?? task.claims ?? []}
            onUpdatePlanPreset={onUpdatePlanPreset}
            onInspectEvidence={inspectEvidence}
          />
        ) : null}
        {tab === "report" ? (
          <ReportPanel
            task={task}
            report={report}
            reportMarkdown={reportPresentation.bodyMarkdown}
            reportSources={reportPresentation.sources}
            imageSources={report?.imageSources ?? []}
            onSelectVersion={selectVersion}
            onInspectEvidence={inspectEvidence}
            onDownloadMarkdown={onDownloadMarkdown}
            onPrintPdf={onPrintPdf}
            onInteractiveExplanation={onInteractiveExplanation}
            notesMarkdown={reportPresentation.notesMarkdown}
          />
        ) : null}
      </main>

      <footer className="shrink-0 border-t border-research-border bg-background/95 px-3 py-3 shadow-[0_-8px_24px_-20px_rgba(0,0,0,0.45)] backdrop-blur sm:px-4">
        <div className="mx-auto flex max-w-3xl flex-wrap justify-end gap-2">
          {report ? (
            <Button onClick={() => setQuestionsOpen(true)}>
              {t("actions.askEvidence")}
            </Button>
          ) : null}
          {(task.status === "completed" ||
            task.status === "partial_completed") &&
          (onContinueResearch || onNewFollowUp) ? (
            <Button
              variant="research"
              onClick={() =>
                onContinueResearch ? setFollowupOpen(true) : onNewFollowUp?.()
              }
            >
              {t("actions.newFollowUp")}
            </Button>
          ) : null}
          <TaskActions
            layout="footer"
            task={task}
            actions={{
              onConfirmPlan,
              onAdjustPlan,
              onUpdatePlanPreset,
              onPause,
              onResume,
              onCancel,
              onRetry,
              onDismiss,
              onNewFollowUp:
                onNewFollowUp ??
                (onContinueResearch ? () => setFollowupOpen(true) : undefined),
            }}
          />
        </div>
      </footer>

      <Dialog
        open={questionsOpen}
        onClose={() => setQuestionsOpen(false)}
        title={questionText("title")}
        placement="responsive-sheet"
        className="sm:max-w-3xl"
        headerAction={
          <IconButton
            label={t("actions.closeWorkbench")}
            icon={<X size={18} />}
            onClick={() => setQuestionsOpen(false)}
          />
        }
      >
        <div className="max-h-[calc(92dvh-3.25rem)] min-h-0 overflow-y-auto">
          <EvidenceQuestionsPanel
            key={effectiveVersionId}
            embedded
            taskId={task.id}
            reportId={effectiveVersionId}
            reportVersions={task.reportVersions}
            onSelectVersion={selectVersion}
          />
        </div>
      </Dialog>
      {followupOpen ? (
        <ResearchFollowupDialog
          open
          onClose={() => setFollowupOpen(false)}
          onSubmit={(value) => onContinueResearch?.(value)}
          onUpdateLatest={onUpdateLatest}
        />
      ) : null}
    </section>
  );
}
