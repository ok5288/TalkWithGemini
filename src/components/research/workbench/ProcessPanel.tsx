"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";
import ResearchDisclosure from "../ResearchDisclosure";
import SaveResearchTemplateButton from "../SaveResearchTemplateButton";
import { ResearchClaimNotice, ResearchPlanContract } from "../topology";
import { ThoroughnessPicker } from "../ui/ThoroughnessPicker";
import type { ResearchTaskActions, ResearchTaskViewModel } from "../types";
import { PlanBoundary, PlanStepLedger } from "./PlanPanel";
import { ActivityLog, RunDetails } from "./ReportPanel";
import { ClaimPanel } from "./ClaimPanel";

export function ProcessPanel({
  task,
  claims,
  onInspectEvidence,
  onUpdatePlanPreset,
}: {
  task: ResearchTaskViewModel;
  onUpdatePlanPreset?: ResearchTaskActions["onUpdatePlanPreset"];
  claims: NonNullable<ResearchTaskViewModel["claims"]>;
  onInspectEvidence: (id: string) => void;
}) {
  const t = useTranslations("Research");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 p-4 sm:p-6">
      <PlanStepLedger task={task} />
      {task.status === "plan_ready" && onUpdatePlanPreset ? (
        <ThoroughnessPicker
          value={task.budgetPreset ?? "standard"}
          onChange={onUpdatePlanPreset}
        />
      ) : null}
      <ActivityLog task={task} />
      <ResearchDisclosure
        open={advancedOpen}
        onOpenChange={setAdvancedOpen}
        className="border-t border-border"
        triggerClassName="flex min-h-11 w-full items-center gap-2 py-3 text-left text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        summary={(open) => (
          <>
            <ChevronDown
              size={16}
              aria-hidden="true"
              className={open ? "rotate-180" : ""}
            />
            {t("process.advancedDetails")}
          </>
        )}
      >
        <div className="space-y-6">
          <RunDetails task={task} />
          {task.run ? <ResearchClaimNotice run={task.run} /> : null}
          <ClaimPanel
            task={task}
            claims={claims}
            onInspectEvidence={onInspectEvidence}
          />
          {task.plan ? (
            <>
              <ResearchPlanContract plan={task.plan} advancedOnly />
              <PlanBoundary task={task} />
              <SaveResearchTemplateButton plan={task.plan} />
            </>
          ) : null}
        </div>
      </ResearchDisclosure>
    </div>
  );
}
