"use client";

import dynamic from "next/dynamic";
import React, { useState } from "react";
import { Check, ChevronDown, ArrowUpRight, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button, InlineStatus } from "@/components/ui/primitives";
import { PlanSteps, formatDuration } from "./ui";
import type { ResearchTaskActions, ResearchTaskViewModel } from "./types";

const ResearchFollowupDialog = dynamic(
  () =>
    import("./workbench/ResearchFollowupDialog").then(
      (module) => module.ResearchFollowupDialog,
    ),
  { ssr: false },
);

export default function ResearchSummaryRow({
  task,
  onOpenWorkbench,
  onContinueResearch,
  onUpdateLatest,
  onNewFollowUp,
}: ResearchTaskActions & {
  task: ResearchTaskViewModel;
  onOpenWorkbench: () => void;
}) {
  const t = useTranslations("Research");
  const [followupOpen, setFollowupOpen] = useState(false);
  return (
    <>
      <details className="group rounded-xl border border-border bg-muted/20">
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-4 py-3 text-xs font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
          <Check
            size={14}
            className="shrink-0 text-emerald-600 dark:text-emerald-400"
            aria-hidden="true"
          />
          <span className="min-w-0 flex-1">
            {t(
              task.status === "partial_completed"
                ? "card.partialSummary"
                : "card.completeSummary",
              {
                sources: task.evidence.length,
                duration: formatDuration(task.usage.elapsedMs),
              },
            )}
          </span>
          <ChevronDown
            size={14}
            className="shrink-0 text-muted-foreground transition-transform group-open:rotate-180 motion-reduce:transition-none"
            aria-hidden="true"
          />
        </summary>
        <div className="space-y-3 border-t border-border px-4 py-3">
          {task.plan ? <PlanSteps plan={task.plan} /> : null}
          {task.gapSummary ? (
            <InlineStatus tone="warning">{task.gapSummary}</InlineStatus>
          ) : null}
          <div className="flex flex-wrap justify-end gap-2">
            <Button size="sm" onClick={onOpenWorkbench}>
              <ArrowUpRight size={14} aria-hidden="true" />
              {t("actions.openWorkbench")}
            </Button>
            {onContinueResearch || onNewFollowUp ? (
              <Button
                size="sm"
                onClick={() =>
                  onContinueResearch ? setFollowupOpen(true) : onNewFollowUp?.()
                }
              >
                <Plus size={14} aria-hidden="true" />
                {t("actions.newFollowUp")}
              </Button>
            ) : null}
          </div>
        </div>
      </details>
      {followupOpen && onContinueResearch ? (
        <ResearchFollowupDialog
          open
          onClose={() => setFollowupOpen(false)}
          onSubmit={onContinueResearch}
          onUpdateLatest={onUpdateLatest}
        />
      ) : null}
    </>
  );
}
