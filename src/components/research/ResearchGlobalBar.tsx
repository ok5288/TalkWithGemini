"use client";

import React from "react";
import { ArrowUpRight, Pause, Play } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/primitives";

import {
  ACTIVE_RESEARCH_STATUSES,
  StatusLabel,
  formatDuration,
  useElapsedMs,
} from "./ui";
import type { ResearchTaskViewModel } from "./types";

export interface ResearchGlobalBarProps {
  task: ResearchTaskViewModel;
  onOpenWorkbench: () => void;
  onPause?: () => void;
  onResume?: () => void;
}

export default function ResearchGlobalBar({
  task,
  onOpenWorkbench,
  onPause,
  onResume,
}: ResearchGlobalBarProps) {
  const t = useTranslations("Research");
  const isRunning = ACTIVE_RESEARCH_STATUSES.has(task.status);
  const elapsedMs = useElapsedMs(
    task.run?.startedAt,
    task.run?.endedAt,
    isRunning,
  );
  // The bar is the only research affordance once the card scrolls away. Pick
  // the latest explicitly active operation; list position is not a lifecycle
  // signal because a completed or failed entry can be appended afterwards.
  const runningActivity = [...task.activities]
    .reverse()
    .find(
      (activity) =>
        activity.status === "prepared" || activity.status === "running",
    );
  const phaseLabel = task.run
    ? t(`run.phase.${task.run.phase}`)
    : t(`status.${task.status}`);

  return (
    <aside
      className="border-b border-border bg-background/95 px-3 py-2 backdrop-blur supports-backdrop-filter:bg-background/85"
      aria-label={
        task.status === "paused"
          ? t("global.resumableLabel")
          : t("global.label")
      }
    >
      <div className="mx-auto flex min-h-10 max-w-3xl items-center gap-3">
        <div className="min-w-0 flex-1">
          <div
            className="flex flex-wrap items-center gap-x-2"
            aria-live="polite"
            aria-atomic="true"
          >
            <StatusLabel status={task.status} />
            {task.run ? (
              <span className="text-xs tabular-nums text-muted-foreground">
                {formatDuration(elapsedMs || task.usage.elapsedMs)}
              </span>
            ) : null}
          </div>

          <p className="truncate text-[11px] text-muted-foreground">
            {task.title} · {runningActivity?.title ?? phaseLabel}
          </p>
        </div>
        {onPause ? (
          <Button
            size="sm"
            onClick={onPause}
            aria-label={t("actions.pause")}
            className="h-9 sm:h-8"
          >
            <Pause size={14} aria-hidden="true" />
            <span className="hidden sm:inline">{t("actions.pause")}</span>
          </Button>
        ) : null}
        {onResume ? (
          <Button
            size="sm"
            variant="research"
            onClick={onResume}
            aria-label={t("actions.resume")}
            className="h-9 sm:h-8"
          >
            <Play size={14} aria-hidden="true" />
            <span>{t("actions.resume")}</span>
          </Button>
        ) : null}
        <Button
          size="sm"
          onClick={onOpenWorkbench}
          aria-label={t("actions.viewProgress")}
          className="h-9 sm:h-8"
        >
          <ArrowUpRight size={14} aria-hidden="true" />
          <span className="hidden sm:inline">{t("actions.viewProgress")}</span>
          <span className="sm:hidden">{t("actions.open")}</span>
        </Button>
      </div>
    </aside>
  );
}
