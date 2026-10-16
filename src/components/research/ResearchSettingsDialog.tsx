"use client";

import React, { useId, useState } from "react";
import { Archive, SlidersHorizontal, X } from "lucide-react";
import { useTranslations } from "next-intl";

import AgentArtifactWorkspace from "@/components/agent/AgentArtifactDrawer";
import { Button, Dialog, IconButton } from "@/components/ui/primitives";
import { RESEARCH_STRATEGY_PRESETS } from "@/lib/research/orchestration/strategy";
import type {
  ResearchBudgetPreset,
  ResearchStrategy,
} from "@/lib/research/types";
import { ThoroughnessPicker } from "./ui/ThoroughnessPicker";
import ResearchTemplatePicker, {
  type ResearchTemplatePickerLabels,
} from "./ResearchTemplatePicker";
import type {
  ResearchTemplate,
  ResearchTemplateSelection,
} from "@/lib/research/templates";

interface ResearchSettingsDialogProps {
  open: boolean;
  sessionId?: string | null;
  budgetPreset: ResearchBudgetPreset;
  /** undefined inherits workspace/profile defaults; null explicitly disables templates. */
  template?: ResearchTemplateSelection;
  onChange: (
    budgetPreset: ResearchBudgetPreset,
    strategy: ResearchStrategy,
  ) => void;
  onTemplateChange?: (template: ResearchTemplateSelection) => void;
  onClose: () => void;
}

type SettingsTab = "research" | "workspace";
const SETTINGS_TABS: SettingsTab[] = ["research", "workspace"];

function handleTabKeyDown({
  event,
  index,
  select,
}: {
  event: React.KeyboardEvent<HTMLButtonElement>;
  index: number;
  select: (tab: SettingsTab) => void;
}) {
  let nextIndex = index;
  if (event.key === "ArrowRight") {
    nextIndex = (index + 1) % SETTINGS_TABS.length;
  } else if (event.key === "ArrowLeft") {
    nextIndex = (index - 1 + SETTINGS_TABS.length) % SETTINGS_TABS.length;
  } else if (event.key === "Home") {
    nextIndex = 0;
  } else if (event.key === "End") {
    nextIndex = SETTINGS_TABS.length - 1;
  } else {
    return;
  }

  event.preventDefault();
  select(SETTINGS_TABS[nextIndex]);
  event.currentTarget.parentElement
    ?.querySelectorAll<HTMLElement>('[role="tab"]')
    [nextIndex]?.focus();
}

export default function ResearchSettingsDialog({
  open,
  sessionId,
  budgetPreset,
  template,
  onChange,
  onTemplateChange,
  onClose,
}: ResearchSettingsDialogProps) {
  const t = useTranslations("Research");
  const tTemplate = useTranslations("ResearchTemplates");
  const [activeTab, setActiveTab] = useState<SettingsTab>("research");
  const [artifactVisited, setArtifactVisited] = useState(false);
  const dialogId = useId();

  const templateText = (key: string, fallback: string): string => {
    try {
      return tTemplate.has(key) ? tTemplate(key as never) : fallback;
    } catch {
      return fallback;
    }
  };
  const templateLabels: ResearchTemplatePickerLabels = {
    title: templateText("title", "Research template"),
    description: templateText(
      "description",
      "Choose a reusable deliverable shape. Templates set starting defaults and never change permissions or budget.",
    ),
    inherit: templateText("inherit", "Inherit workspace or profile"),
    disabled: templateText("disabled", "No template"),
    loading: templateText("loading", "Loading templates..."),
    unavailable: templateText(
      "unavailable",
      "Saved templates are unavailable. Built-in templates remain available.",
    ),
    duplicate: templateText("duplicate", "Duplicate template"),
    remove: templateText("remove", "Delete template"),
    builtIn: templateText("builtIn", "Built-in"),
    custom: templateText("custom", "Custom"),
    selectAria: templateText("selectAria", "Research template"),
    duplicateAria: templateText(
      "duplicateAria",
      "Duplicate selected research template",
    ),
    removeAria: templateText("removeAria", "Delete selected research template"),
    newTemplate: templateText("newTemplate", "New template"),
    editTemplate: templateText("editTemplate", "Edit template"),
    editAria: templateText("editAria", "Edit selected research template"),
    snapshot: templateText("snapshot", "Saved snapshot"),
    preview: templateText("preview", "Template preview"),
    deliverable: templateText("deliverable", "Deliverable"),
    sections: templateText("sections", "Required sections"),
    sources: templateText("sources", "Source priorities"),
    templateEditor: {
      title: templateText("editor.title", "Template details"),
      name: templateText("editor.name", "Name"),
      namePlaceholder: templateText(
        "editor.namePlaceholder",
        "e.g. Product evaluation",
      ),
      description: templateText("editor.description", "Description"),
      descriptionPlaceholder: templateText(
        "editor.descriptionPlaceholder",
        "What this template helps you deliver",
      ),
      deliverable: templateText("editor.deliverable", "Deliverable type"),
      sections: templateText("editor.sections", "Required sections"),
      sectionsHint: templateText(
        "editor.sectionsHint",
        "One section per line. Standard audit sections are added automatically.",
      ),
      sources: templateText("editor.sources", "Source priorities"),
      sourceType: templateText("editor.sourceType", "Source type"),
      priority: templateText("editor.priority", "Priority"),
      rationale: templateText("editor.rationale", "Rationale"),
      rationalePlaceholder: templateText(
        "editor.rationalePlaceholder",
        "Why this source is useful",
      ),
      addSource: templateText("editor.addSource", "Add source priority"),
      cancel: templateText("editor.cancel", "Cancel"),
      save: templateText("editor.save", "Save template"),
      required: templateText(
        "editor.required",
        "Complete the required fields before saving.",
      ),
      removeSourceAria: templateText(
        "editor.removeSourceAria",
        "Remove source priority",
      ),
    },
    templateName: (researchTemplate: ResearchTemplate) =>
      templateText(
        `templates.${researchTemplate.id}.name`,
        researchTemplate.name,
      ),
    templateDescription: (researchTemplate: ResearchTemplate) =>
      templateText(
        `templates.${researchTemplate.id}.description`,
        researchTemplate.description,
      ),
  };

  const selectTab = (tab: SettingsTab) => {
    setActiveTab(tab);
    if (tab === "workspace") setArtifactVisited(true);
  };

  const handleClose = () => {
    setActiveTab("research");
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      title={t("settings.title")}
      headerAction={
        <IconButton
          size="sm"
          label={t("settings.close")}
          icon={<X size={16} aria-hidden="true" />}
          onClick={handleClose}
        />
      }
      placement="responsive-sheet"
      closeOnBackdropClick
      className="sm:max-w-3xl"
    >
      <div className="flex max-h-[calc(92dvh-3.25rem)] min-h-0 flex-col">
        <div
          className="flex shrink-0 overflow-x-auto border-b border-border px-2 sm:px-4"
          role="tablist"
          aria-label={t("settings.tabsAria")}
        >
          {SETTINGS_TABS.map((tab, index) => (
            <Button
              key={tab}
              variant="bare"
              id={`${dialogId}-${tab}-tab`}
              role="tab"
              tabIndex={activeTab === tab ? 0 : -1}
              aria-selected={activeTab === tab}
              aria-controls={`${dialogId}-${tab}-panel`}
              onClick={() => selectTab(tab)}
              onKeyDown={(event) =>
                handleTabKeyDown({ event, index, select: selectTab })
              }
              className={`inline-flex h-10 shrink-0 items-center gap-2 border-b-2 px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-research-accent/50 ${
                activeTab === tab
                  ? "border-research-accent text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab === "research" ? (
                <SlidersHorizontal size={15} aria-hidden="true" />
              ) : (
                <Archive size={15} aria-hidden="true" />
              )}
              {t(`settings.tab_${tab}`)}
            </Button>
          ))}
        </div>

        <div
          id={`${dialogId}-research-panel`}
          role="tabpanel"
          aria-labelledby={`${dialogId}-research-tab`}
          hidden={activeTab !== "research"}
          className="min-h-0 flex-1 overflow-y-auto p-3 custom-scrollbar sm:p-4"
        >
          <div className="space-y-4">
            <p className="text-xs leading-5 text-muted-foreground">
              {t("settings.futureTasksOnly")}
            </p>

            <ResearchTemplatePicker
              selection={template}
              onChange={(selection) => onTemplateChange?.(selection)}
              disabled={!sessionId || !onTemplateChange}
              labels={templateLabels}
            />

            <ThoroughnessPicker
              value={budgetPreset}
              disabled={!sessionId}
              onChange={(preset) =>
                onChange(preset, { ...RESEARCH_STRATEGY_PRESETS[preset] })
              }
            />
          </div>
        </div>

        <div
          id={`${dialogId}-workspace-panel`}
          role="tabpanel"
          aria-labelledby={`${dialogId}-workspace-tab`}
          hidden={activeTab !== "workspace"}
          className="min-h-0 flex-1"
        >
          {artifactVisited ? (
            <AgentArtifactWorkspace
              key={sessionId || "no-session"}
              active={activeTab === "workspace"}
              sessionId={sessionId}
            />
          ) : null}
        </div>
      </div>
    </Dialog>
  );
}
