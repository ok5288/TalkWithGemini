"use client";

import dynamic from "next/dynamic";
import React, { useState } from "react";
import {
  Pause,
  Play,
  RotateCcw,
  Settings2,
  Square,
  Sparkles,
  X,
} from "lucide-react";
import { useTranslations } from "next-intl";

import { Button, DangerAction } from "@/components/ui/primitives";
import { openSettingsTab } from "@/lib/settings/navigation";
import { cn } from "@/lib/utils/cn";

import type { ResearchTaskActions, ResearchTaskViewModel } from "../types";
import { ACTIVE_RESEARCH_STATUSES } from "./status";

const ResearchAdjustmentDialog = dynamic(
  () => import("./ResearchAdjustmentDialog"),
  { ssr: false },
);

export function TaskActions({
  task,
  actions,
  layout = "card",
}: {
  task: ResearchTaskViewModel;
  actions: ResearchTaskActions;
  layout?: "card" | "footer";
}) {
  const t = useTranslations("Research");
  const [adjusting, setAdjusting] = useState(false);
  const running = ACTIVE_RESEARCH_STATUSES.has(task.status);
  const needsModelSettings =
    /RESEARCH_(?:MODEL_(?:AUTH|MODEL_NOT_FOUND)|TOOL_CALLING_REQUIRED)$/.test(
      task.error?.code || "",
    );
  const missingModel =
    task.status === "paused" &&
    task.error?.code === "RESEARCH_MODEL_UNAVAILABLE";
  const canRetry =
    (task.status === "failed" || task.status === "clarifying") &&
    task.error?.recoverable;
  const canEdit = ["plan_ready", "paused"].includes(task.status);
  const canCancel = ![
    "completed",
    "partial_completed",
    "failed",
    "cancelled",
  ].includes(task.status);

  return (
    <>
      <div
        className={cn(
          "flex flex-wrap items-center justify-end gap-2 [&_button]:min-h-9 sm:[&_button]:min-h-8",
          layout === "footer" && "w-full md:w-auto",
        )}
      >
        {task.status === "failed" && actions.onDismiss ? (
          <DangerAction
            onConfirm={actions.onDismiss}
            confirmLabel={t("actions.confirmDiscard")}
          >
            <X size={14} aria-hidden="true" />
            {t("actions.dismiss")}
          </DangerAction>
        ) : null}
        {canCancel && actions.onCancel ? (
          running || task.status === "paused" ? (
            <DangerAction
              onConfirm={actions.onCancel}
              confirmLabel={t("actions.confirmCancel")}
            >
              <Square size={14} aria-hidden="true" />
              {t("actions.stop")}
            </DangerAction>
          ) : (
            <Button size="sm" onClick={actions.onCancel}>
              {t("actions.cancel")}
            </Button>
          )
        ) : null}
        {canEdit && actions.onAdjustPlan ? (
          <Button size="sm" onClick={() => setAdjusting(true)}>
            <Sparkles size={14} aria-hidden="true" />
            {t("actions.adjust")}
          </Button>
        ) : null}
        {running && actions.onPause ? (
          <Button size="sm" onClick={actions.onPause}>
            <Pause size={14} aria-hidden="true" />
            {t("actions.pause")}
          </Button>
        ) : null}
        {needsModelSettings || missingModel ? (
          <Button
            size="sm"
            variant="research"
            onClick={() => openSettingsTab("providers")}
          >
            <Settings2 size={14} aria-hidden="true" />
            {t("actions.openModelSettings")}
          </Button>
        ) : task.status === "paused" && actions.onResume ? (
          <Button size="sm" variant="research" onClick={actions.onResume}>
            <Play size={14} aria-hidden="true" />
            {t("actions.resume")}
          </Button>
        ) : canRetry && actions.onRetry ? (
          <Button size="sm" variant="research" onClick={actions.onRetry}>
            <RotateCcw size={14} aria-hidden="true" />
            {t("actions.retry")}
          </Button>
        ) : null}
        {task.status === "plan_ready" && actions.onConfirmPlan ? (
          <Button size="sm" variant="research" onClick={actions.onConfirmPlan}>
            <Play size={14} aria-hidden="true" />
            {t("actions.start")}
          </Button>
        ) : null}
      </div>
      {adjusting && actions.onAdjustPlan ? (
        <ResearchAdjustmentDialog
          onClose={() => setAdjusting(false)}
          onSubmit={actions.onAdjustPlan}
        />
      ) : null}
    </>
  );
}
