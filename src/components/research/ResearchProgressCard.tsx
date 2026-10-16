"use client";

import React from "react";
import { ArrowUpRight } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button, InlineStatus } from "@/components/ui/primitives";
import {
  ACTIVE_RESEARCH_STATUSES,
  ActivityList,
  PlanSteps,
  StatusLabel,
  TaskActions,
  formatDuration,
  useElapsedMs,
} from "./ui";
import type { ResearchTaskActions, ResearchTaskViewModel } from "./types";

export interface ResearchProgressCardProps extends ResearchTaskActions {
  task: ResearchTaskViewModel;
  onOpenWorkbench: () => void;
}

export default function ResearchProgressCard({
  task,
  onOpenWorkbench,
  ...actions
}: ResearchProgressCardProps) {
  const t = useTranslations("Research");
  const running = ACTIVE_RESEARCH_STATUSES.has(task.status);
  const elapsed = useElapsedMs(task.run?.startedAt, task.run?.endedAt, running);
  const activeStep =
    task.plan?.steps.findIndex((step) => step.status === "in_progress") ?? -1;
  const scopePause =
    task.status === "paused" &&
    task.error?.code === "RESEARCH_SCOPE_APPROVAL_REQUIRED";
  return (
    <section
      className="my-3 overflow-hidden rounded-xl border border-border bg-muted/20"
      aria-labelledby={`research-progress-${task.id}`}
    >
      <header className="flex items-start gap-3 px-4 pt-4">
        <div className="min-w-0 flex-1">
          <div
            className="flex flex-wrap items-center gap-x-2 gap-y-1"
            aria-live="polite"
            aria-atomic="true"
          >
            <StatusLabel status={task.status} />
            {running && activeStep >= 0 ? (
              <span className="text-xs text-muted-foreground">
                {t("card.stepProgress", {
                  current: activeStep + 1,
                  total: task.plan?.steps.length || 0,
                })}
              </span>
            ) : null}
            {task.run ? (
              <span className="text-xs tabular-nums text-muted-foreground">
                {formatDuration(elapsed || task.usage.elapsedMs)}
              </span>
            ) : null}
          </div>
          <h2
            id={`research-progress-${task.id}`}
            className="mt-1 wrap-break-word text-sm font-semibold leading-6 text-foreground"
          >
            {task.title}
          </h2>
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={onOpenWorkbench}
          aria-label={t("actions.viewProgress")}
        >
          <ArrowUpRight size={14} aria-hidden="true" />
        </Button>
      </header>
      <div className="space-y-4 px-4 py-4">
        {task.error ? (
          <InlineStatus
            tone={task.status === "paused" ? "warning" : "danger"}
            live
          >
            {scopePause ? t("run.scopeResume") : task.error.message}
          </InlineStatus>
        ) : task.status === "paused" ? (
          <InlineStatus tone="neutral">{t("card.pausedNotice")}</InlineStatus>
        ) : null}
        {task.plan ? <PlanSteps plan={task.plan} /> : null}
        {task.activities.length ? (
          <ActivityList activities={task.activities} limit={1} />
        ) : null}
        <TaskActions task={task} actions={actions} />
      </div>
    </section>
  );
}
