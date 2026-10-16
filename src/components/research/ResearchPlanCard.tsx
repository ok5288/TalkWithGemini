"use client";

import React from "react";
import { ArrowUpRight, LoaderCircle, Check, Circle } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button, InlineStatus } from "@/components/ui/primitives";

import { openSettingsTab } from "@/lib/settings/navigation";
import { ThoroughnessPicker } from "./ui/ThoroughnessPicker";
import { PlanSteps, StatusLabel, TaskActions } from "./ui";
import type { ResearchTaskActions, ResearchTaskViewModel } from "./types";

export interface ResearchPlanCardProps extends ResearchTaskActions {
  task: ResearchTaskViewModel;
  onOpenWorkbench: () => void;
}

/**
 * The stages the planning pipeline moves through before a plan is reviewable.
 * Planning takes minutes and emits nothing the user can read, so the card
 * shows where it is rather than a bare pulsing label.
 */
const PREPARING_STEPS = ["scope", "sources", "review"] as const;

function PreparingChecklist({ activeIndex }: { activeIndex: number }) {
  const t = useTranslations("Research");
  return (
    <ol className="space-y-2.5" aria-live="polite">
      {PREPARING_STEPS.map((step, index) => (
        <li key={step} className="flex items-start gap-2 text-sm leading-5">
          <span className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center">
            {index < activeIndex ? (
              <Check
                size={14}
                className="text-emerald-600 dark:text-emerald-400"
                aria-hidden="true"
              />
            ) : index === activeIndex ? (
              <LoaderCircle
                size={14}
                className="animate-spin text-research-accent motion-reduce:animate-none"
                aria-hidden="true"
              />
            ) : (
              <Circle
                size={13}
                className="text-muted-foreground"
                aria-hidden="true"
              />
            )}
          </span>
          <span
            className={
              index < activeIndex
                ? "text-muted-foreground"
                : "text-foreground/90"
            }
          >
            {t(`card.preparingSteps.${step}`)}
          </span>
        </li>
      ))}
    </ol>
  );
}

/**
 * The pre-run half of a research task: the plan is drafted, reviewed and
 * approved here. Once the run starts, `ResearchProgressCard` takes over.
 */
export default function ResearchPlanCard({
  task,
  onOpenWorkbench,
  ...actions
}: ResearchPlanCardProps) {
  const t = useTranslations("Research");
  const plan = task.plan;
  const isPreparing = task.status === "draft" || task.status === "clarifying";
  const preparingIndex = !plan ? 0 : plan.recon ? 2 : 1;
  return (
    <section
      className="my-3 overflow-hidden rounded-xl border border-border bg-muted/20"
      aria-labelledby={`research-plan-${task.id}`}
    >
      <header className="flex items-start gap-3 px-4 pt-4">
        <div className="min-w-0 flex-1">
          <div aria-live="polite" aria-atomic="true">
            <StatusLabel status={task.status} />
          </div>
          <h2
            id={`research-plan-${task.id}`}
            className="mt-1 wrap-break-word text-sm font-semibold leading-6 text-foreground"
          >
            {task.title}
          </h2>
        </div>
        {plan ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={onOpenWorkbench}
            aria-label={t("actions.viewProgress")}
          >
            <ArrowUpRight size={14} aria-hidden="true" />
          </Button>
        ) : null}
      </header>
      <div className="space-y-4 px-4 py-4">
        {task.error ? (
          <InlineStatus tone="danger" live>
            {task.error.message}
          </InlineStatus>
        ) : null}
        {isPreparing && !task.error ? (
          <PreparingChecklist activeIndex={preparingIndex} />
        ) : null}
        {task.status === "plan_ready" && plan ? (
          <>
            {plan.isStarter ? (
              <InlineStatus tone="neutral">
                {t("card.starterNotice")}
              </InlineStatus>
            ) : null}
            <div>
              <h3 className="mb-3 text-xs font-medium text-muted-foreground">
                {t("plan.steps")}
              </h3>
              <PlanSteps plan={plan} />
            </div>
            <ThoroughnessPicker
              value={task.budgetPreset || "standard"}
              onChange={(preset) => actions.onUpdatePlanPreset?.(preset)}
              disabled={!actions.onUpdatePlanPreset}
            />
            {task.sourceScope && !task.sourceScope.searchEnabled ? (
              <InlineStatus tone="warning">
                <span className="block">{t("sourceScope.searchWarning")}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-1"
                  onClick={() => openSettingsTab("search")}
                >
                  {t("actions.openSearchSettings")}
                </Button>
              </InlineStatus>
            ) : null}
          </>
        ) : null}
        <TaskActions task={task} actions={actions} />
      </div>
    </section>
  );
}
