"use client";

import React, { useId, useState } from "react";
import { useTranslations } from "next-intl";

import { InlineStatus } from "@/components/ui/primitives";
import { RESEARCH_BUDGET_PRESETS } from "@/lib/research/task";
import type { ResearchBudgetPreset } from "@/lib/research/types";

const PRESETS: ResearchBudgetPreset[] = ["quick", "standard", "deep"];

export function ThoroughnessPicker({
  value,
  onChange,
  disabled = false,
}: {
  value: ResearchBudgetPreset;
  onChange: (preset: ResearchBudgetPreset) => void | Promise<void>;
  disabled?: boolean;
}) {
  const t = useTranslations("Research");
  const id = useId();
  const [pending, setPending] = useState<ResearchBudgetPreset | null>(null);
  const selectedPreset = pending ?? value;
  const [error, setError] = useState(false);
  return (
    <fieldset
      disabled={disabled || pending !== null}
      className="min-w-0 space-y-2"
      aria-busy={pending !== null}
    >
      <legend className="text-sm font-medium text-foreground">
        {t("settings.budgetTitle")}
      </legend>
      <div
        className="flex flex-wrap gap-2"
        role="radiogroup"
        aria-label={t("settings.budgetTitle")}
      >
        {PRESETS.map((preset) => (
          <label
            key={preset}
            className={`flex min-h-10 cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring ${selectedPreset === preset ? "border-research-accent/60 bg-research-soft" : "border-border hover:bg-muted/50"} ${disabled || pending ? "cursor-not-allowed opacity-60" : ""}`}
          >
            <input
              type="radio"
              name={id}
              value={preset}
              checked={selectedPreset === preset}
              className="accent-research-accent"
              onChange={async () => {
                if (selectedPreset === preset) return;
                setPending(preset);
                setError(false);
                try {
                  await onChange(preset);
                } catch {
                  setError(true);
                } finally {
                  setPending(null);
                }
              }}
            />
            {t(`budget.${preset}`)}
          </label>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        {t("settings.estimatedTime", {
          minutes: Math.round(
            RESEARCH_BUDGET_PRESETS[selectedPreset].maxDurationMs / 60_000,
          ),
        })}
      </p>
      {error ? (
        <InlineStatus tone="danger" live>
          {t("adjust.error")}
        </InlineStatus>
      ) : null}
    </fieldset>
  );
}
