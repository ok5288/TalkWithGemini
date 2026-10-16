// @vitest-environment jsdom

import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ResearchGlobalBar,
  ResearchTaskCard,
  ResearchWorkbench,
  type ResearchTaskViewModel,
} from "@/components/research";
import messageMessages from "@/i18n/locales/en/Message.json";
import researchMessages from "@/i18n/locales/en/Research.json";
import evidenceQuestionMessages from "@/i18n/locales/en/EvidenceQuestions.json";
import templateMessages from "@/i18n/locales/en/ResearchTemplates.json";
import japaneseResearchMessages from "@/i18n/locales/ja/Research.json";
import chineseResearchMessages from "@/i18n/locales/zh/Research.json";

vi.mock("@/components/content/MarkdownRenderer", () => ({
  default: ({ content }: { content: string }) => (
    <article data-testid="research-report-markdown">{content}</article>
  ),
}));

vi.mock("@/components/research/workbench/EvidenceQuestionsPanel", () => ({
  default: ({ reportId }: { reportId?: string }) => (
    <div data-testid="evidence-topic-panel" data-report-id={reportId} />
  ),
}));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const baseTask: ResearchTaskViewModel = {
  id: "research-1",
  title: "Compare evidence-backed research systems",
  status: "plan_ready",
  budgetPreset: "standard",
  plan: {
    id: "plan-1",
    version: 2,
    summary: "Compare the systems using primary documentation.",
    steps: [
      { id: "step-1", title: "Collect sources", status: "completed" },
      { id: "step-2", title: "Verify claims", status: "in_progress" },
      { id: "step-3", title: "Write report", status: "pending" },
      { id: "step-4", title: "Audit citations", status: "pending" },
    ],
  },
  completedQuestions: 1,
  totalQuestions: 4,
  summary: "A concise card summary.",
  findings: ["Finding one", "Finding two", "Finding three", "Finding four"],
  evidence: [
    {
      id: "evidence-1",
      title: "Primary product documentation",
      sourceType: "web",
      url: "https://example.com/research",
      retrievedAt: Date.UTC(2026, 7, 24),
      stance: "supports",
      freshness: "current",
      excerpt: "This evidence supports the first claim.",
      linkedClaims: [
        {
          id: "claim-1",
          text: "The documented workflow separates discovery from verification.",
          importance: "major",
          verificationStatus: "verified",
        },
      ],
      questionIndexes: [0],
      domain: "example.com",
    },
  ],
  claims: [
    {
      id: "claim-1",
      text: "The documented workflow separates discovery from verification.",
      importance: "major",
      verificationStatus: "verified",
      independentPublisherCount: 2,
      supportingEvidenceIds: ["evidence-1"],
      contradictingEvidenceIds: [],
      stepId: "step-1",
    },
  ],
  activities: [
    {
      id: "activity-1",
      createdAt: Date.UTC(2026, 7, 24),
      phase: "researching",
      status: "committed",
      title: "Collected primary documentation",
      detail: "One source was committed to the evidence index.",
    },
  ],
  reportVersions: [],
  sourceScope: {
    searchEnabled: true,
    toolIds: ["fetch_url"],
    knowledgeCount: 2,
    attachmentCount: 0,
    workspaceCount: 0,
    pluginCount: 0,
  },
  usage: {
    toolRounds: 2,
    maxToolRounds: 12,
    toolCalls: 4,
    maxToolCalls: 50,
    elapsedMs: 90_000,
    maxWallTimeMs: 900_000,
  },
};

const partialTask: ResearchTaskViewModel = {
  ...baseTask,
  status: "partial_completed",
  gapSummary: "One source could not be independently verified.",
  activeReportVersionId: "report-2",
  reportVersions: [
    {
      id: "report-1",
      version: 1,
      createdAt: Date.UTC(2026, 7, 23),
      title: "Research systems report",
      markdown: "# Research systems report\n\nOlder full report body",
      kind: "initial",
      gaps: [],
      coveredStepIds: ["step-1", "step-2", "step-3", "step-4"],
      planStepCount: 4,
      claims: [
        {
          id: "claim-1",
          text: "The documented workflow separates discovery from verification.",
          importance: "major",
          verificationStatus: "verified",
          independentPublisherCount: 2,
          supportingEvidenceIds: ["evidence-1"],
          contradictingEvidenceIds: [],
          stepId: "step-1",
        },
      ],
    },
    {
      id: "report-2",
      version: 2,
      createdAt: Date.UTC(2026, 7, 24),
      title: "Updated research systems report",
      markdown: "# Updated research systems report\n\nFull report body",
      kind: "update",
      gaps: ["One source could not be independently verified."],
      coveredStepIds: ["step-1", "step-2", "step-3"],
      planStepCount: 4,
      stopReason: { code: "max_queries" },
      diff: {
        addedEvidenceIds: ["evidence-1"],
        changedSourceIds: ["source-1"],
        unchangedSourceIds: [],
      },
      audit: {
        blocking: [],
        advisory: ["One finding needs a stronger citation."],
        unknownCitationCount: 0,
        unsupportedFindingCount: 1,
        missingSectionCount: 0,
      },
      claims: [...(baseTask.claims ?? [])],
    },
  ],
};

const completedTask: ResearchTaskViewModel = {
  ...partialTask,
  status: "completed",
  gapSummary: undefined,
};

const v2Plan: NonNullable<ResearchTaskViewModel["plan"]> = {
  ...baseTask.plan!,
  objective: "Recommend a research workflow using verifiable evidence.",
  scope: {
    audience: "Product and engineering leads",
    timeRange: "2024-2026",
    allowedSourceTypes: ["web", "knowledge"],
    includes: ["Primary product documentation", "Independent benchmarks"],
    excludes: ["Anonymous social posts"],
    preferredDomains: ["docs.example.com"],
    excludedDomains: ["archive.example.com"],
  },
  assumptions: ["Public documentation is sufficient for this decision."],
  deliverable: {
    kind: "decision_memo",
    description: "A decision-ready recommendation.",
  },
  strategy: {
    initialBreadth: 4,
    maxDepth: 2,
    queryLimit: 16,
    resultsPerQuery: 5,
    reservedValidationQueries: 3,
    sourceContentLimit: 32,
  },
  recon: {
    status: "completed",
    queryCount: 2,
    maxQueries: 2,
    resultsPerQuery: 5,
    durationMs: 2_400,
    queries: [
      {
        id: "recon-1",
        query: "research workflow primary documentation",
        status: "completed",
        resultCount: 5,
        domains: ["example.com", "standards.example"],
      },
      {
        id: "recon-2",
        query: "research workflow independent benchmark",
        status: "completed",
        resultCount: 4,
        domains: ["benchmark.example"],
      },
    ],
  },
  completionCriteria: [
    "Every major recommendation is backed by verified evidence.",
  ],
  steps: baseTask.plan!.steps.map((step) => ({
    ...step,
    objective: `Evidence objective for ${step.title}`,
    queryTopics: [`${step.title} primary sources`],
    sourcePriorities: ["web:high - Prefer primary documentation"],
    evidenceStandard: "Major claims require independent support.",
  })),
};

const approvalTask: ResearchTaskViewModel = {
  ...baseTask,
  plan: v2Plan,
};

const orchestratedTask: ResearchTaskViewModel = {
  ...baseTask,
  status: "researching",
  plan: v2Plan,
  evidence: [
    {
      ...baseTask.evidence[0],
      stepId: "step-1",
      nodeId: "node-1",
      claimIds: ["claim-1"],
      verificationStatus: "verified",
    },
  ],
  run: {
    id: "run-1",
    phase: "exploring",
    startedAt: 1_000,
    currentWave: 2,
    currentDepth: 2,
    maxDepth: 2,
    queryUsage: {
      used: 9,
      limit: 16,
      reservedForValidation: 3,
      planningUsed: 2,
    },
    claimCounts: {
      total: 4,
      verified: 2,
      conflicting: 1,
      unresolved: 1,
    },
    coverage: {
      coveredStepCount: 1,
      requiredStepCount: 4,
      ratio: 0.25,
    },
    waves: [
      {
        id: "wave-1",
        index: 1,
        depth: 1,
        status: "completed",
        nodeIds: ["node-1"],
        queryCount: 4,
        sourceCount: 3,
        verifiedClaimCount: 1,
      },
      {
        id: "wave-2",
        index: 2,
        depth: 2,
        status: "in_progress",
        nodeIds: ["node-2", "node-3"],
        queryCount: 2,
        sourceCount: 1,
        verifiedClaimCount: 1,
      },
    ],
    nodes: [
      {
        id: "node-1",
        waveId: "wave-1",
        stepId: "step-1",
        depth: 1,
        objective: "Map the primary workflow",
        query: "primary research workflow documentation",
        status: "completed",
        evidenceIds: ["evidence-1"],
        claimIds: ["claim-1"],
        verifiedClaimCount: 1,
        conflictingClaimCount: 0,
        learnings: ["The workflow separates discovery from verification."],
        followUps: ["Check how the workflow handles source conflicts."],
      },
      {
        id: "node-2",
        parentId: "node-1",
        waveId: "wave-2",
        stepId: "step-2",
        depth: 2,
        objective: "Verify the conflict-handling model",
        query: "research workflow conflicting evidence",
        status: "in_progress",
        evidenceIds: [],
        claimIds: ["claim-2", "claim-3"],
        verifiedClaimCount: 1,
        conflictingClaimCount: 1,
        learnings: ["Independent publishers disagree on one boundary."],
        followUps: ["Check the relevant primary policy."],
      },
      {
        id: "node-3",
        parentId: "node-1",
        waveId: "wave-2",
        stepId: "step-2",
        depth: 2,
        objective: "Check regional deployment variants",
        status: "pending",
        evidenceIds: [],
        claimIds: [],
        verifiedClaimCount: 0,
        conflictingClaimCount: 0,
        learnings: [],
        followUps: ["Inspect a source outside the approved scope."],
        scopeImpact: "source_expansion",
      },
    ],
  },
};

function renderWithResearchMessages(node: React.ReactNode) {
  return render(
    <NextIntlClientProvider
      locale="en"
      messages={{
        EvidenceQuestions: evidenceQuestionMessages,
        ResearchTemplates: templateMessages,
        Message: messageMessages,
        Research: researchMessages,
      }}
    >
      {node}
    </NextIntlClientProvider>,
  );
}

async function flushDialogFocus() {
  await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
}

describe("ResearchTaskCard", () => {
  it("requires approval and changes real thoroughness through the task action", async () => {
    const start = vi.fn();
    const preset = vi.fn();
    renderWithResearchMessages(
      <ResearchTaskCard
        task={approvalTask}
        onOpenWorkbench={vi.fn()}
        onConfirmPlan={start}
        onUpdatePlanPreset={preset}
      />,
    );
    expect(start).not.toHaveBeenCalled();
    expect(screen.queryByRole("spinbutton")).toBeNull();
    expect(screen.queryByText("Full research contract")).toBeNull();
    await userEvent.click(screen.getByRole("radio", { name: "Quick" }));
    expect(preset).toHaveBeenCalledExactlyOnceWith("quick");
    await userEvent.click(screen.getByRole("button", { name: "Start" }));
    expect(start).toHaveBeenCalledOnce();
  });
  it("edits in a sheet and keeps failed edit text available", async () => {
    const adjust = vi.fn().mockRejectedValue(new Error("network"));
    renderWithResearchMessages(
      <ResearchTaskCard
        task={baseTask}
        onOpenWorkbench={vi.fn()}
        onAdjustPlan={adjust}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Edit plan" }));
    const dialog = await screen.findByRole("dialog");
    await flushDialogFocus();
    const input = within(dialog).getByRole("textbox");
    await userEvent.type(input, "Focus on primary sources");
    await userEvent.click(
      within(dialog).getByRole("button", {
        name: researchMessages.adjust.submit,
      }),
    );
    expect(adjust).toHaveBeenCalledWith("Focus on primary sources");
    expect((input as HTMLTextAreaElement).value).toBe(
      "Focus on primary sources",
    );
    expect(within(dialog).getByRole("alert")).toBeTruthy();
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Edit plan" }));
    const reopened = await screen.findByRole("dialog");
    await flushDialogFocus();
    expect(
      (within(reopened).getByRole("textbox") as HTMLTextAreaElement).value,
    ).toBe("");
    expect(within(reopened).queryByRole("alert")).toBeNull();
  });
  it("labels starter plans and links the frozen search-off scope to settings", async () => {
    const navigate = vi.fn();
    window.addEventListener("neo-chat:settings-tab-navigate", navigate);
    renderWithResearchMessages(
      <ResearchTaskCard
        task={{
          ...baseTask,
          plan: { ...baseTask.plan!, isStarter: true },
          sourceScope: { ...baseTask.sourceScope!, searchEnabled: false },
        }}
        onOpenWorkbench={vi.fn()}
      />,
    );
    expect(screen.getByText(researchMessages.card.starterNotice)).toBeTruthy();
    await userEvent.click(
      screen.getByRole("button", { name: "Open search settings" }),
    );
    expect(navigate.mock.calls[0][0].detail.tab).toBe("search");
    window.removeEventListener("neo-chat:settings-tab-navigate", navigate);
  });
  it("shows only the latest activity without metrics or estimated progress", () => {
    renderWithResearchMessages(
      <ResearchTaskCard
        task={{
          ...orchestratedTask,
          activities: [
            ...baseTask.activities,
            {
              ...baseTask.activities[0],
              id: "latest",
              title: "Reading the latest source",
            },
          ],
        }}
        onOpenWorkbench={vi.fn()}
      />,
    );
    expect(screen.getByText("Reading the latest source")).toBeTruthy();
    expect(screen.queryByText(baseTask.activities[0].title)).toBeNull();
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(screen.queryByText("Queries")).toBeNull();
  });
  it("offers a clear paused reason and resumes committed work", async () => {
    const resume = vi.fn();
    renderWithResearchMessages(
      <ResearchTaskCard
        task={{
          ...orchestratedTask,
          status: "paused",
          error: {
            code: "RESEARCH_CONNECTION_LOST",
            message: "Connection lost; progress saved.",
            recoverable: true,
          },
        }}
        onOpenWorkbench={vi.fn()}
        onResume={resume}
      />,
    );
    expect(screen.getByText("Connection lost; progress saved.")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Resume" }));
    expect(resume).toHaveBeenCalledOnce();
  });
  it("confirms Discard and directs authentication failures to model settings", async () => {
    const discard = vi.fn();
    const navigate = vi.fn();
    window.addEventListener("neo-chat:settings-tab-navigate", navigate);
    renderWithResearchMessages(
      <ResearchTaskCard
        task={{
          ...baseTask,
          status: "failed",
          error: {
            code: "RESEARCH_MODEL_AUTH",
            message: "API key rejected.",
            recoverable: true,
          },
        }}
        onOpenWorkbench={vi.fn()}
        onDismiss={discard}
        onRetry={vi.fn()}
      />,
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Open model settings" }),
    );
    expect(navigate.mock.calls[0][0].detail.tab).toBe("providers");
    await userEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(discard).not.toHaveBeenCalled();
    await userEvent.click(
      screen.getByRole("button", {
        name: researchMessages.actions.confirmDiscard,
      }),
    );
    expect(discard).toHaveBeenCalledOnce();
    window.removeEventListener("neo-chat:settings-tab-navigate", navigate);
  });
  it("collapses finished details, retains the report and opens deliberate follow-up", async () => {
    const more = vi.fn();
    renderWithResearchMessages(
      <ResearchTaskCard
        task={partialTask}
        onOpenWorkbench={vi.fn()}
        onContinueResearch={more}
      />,
    );
    const summary = screen
      .getByText(/Research finished with limits/)
      .closest("summary")!;
    expect(summary.parentElement?.hasAttribute("open")).toBe(false);
    expect(
      screen.getByTestId("research-report-markdown").textContent,
    ).toContain("Full report body");
    await userEvent.click(summary);
    expect(screen.getByText(partialTask.gapSummary!)).toBeTruthy();
    await userEvent.click(
      screen.getByRole("button", { name: "Research more" }),
    );
    const dialog = await screen.findByRole("dialog");
    await flushDialogFocus();
    await userEvent.type(
      within(dialog).getByRole("textbox"),
      "Investigate remaining gaps",
    );
    await userEvent.click(
      within(dialog).getByRole("button", {
        name: researchMessages.followup.continue.submit,
      }),
    );
    expect(more).toHaveBeenCalledWith("Investigate remaining gaps");
    expect(screen.queryByRole("dialog")).toBeNull();
    await userEvent.click(
      screen.getByRole("button", { name: "Research more" }),
    );
    const reopened = await screen.findByRole("dialog");
    await flushDialogFocus();
    expect(
      (within(reopened).getByRole("textbox") as HTMLTextAreaElement).value,
    ).toBe("");
  });
  it("localizes legacy report headings in the chat preview", () => {
    render(
      <NextIntlClientProvider
        locale="zh"
        messages={{
          Research: chineseResearchMessages,
          Message: messageMessages,
        }}
      >
        <ResearchTaskCard
          task={{
            ...completedTask,
            reportVersions: completedTask.reportVersions.map((r) => ({
              ...r,
              markdown: "# Report\n\n## Executive summary\nBody.",
            })),
          }}
          onOpenWorkbench={vi.fn()}
        />
      </NextIntlClientProvider>,
    );
    expect(
      screen.getByTestId("research-report-markdown").textContent,
    ).toContain("## 执行摘要");
  });
});

describe("ResearchGlobalBar", () => {
  it("ticks live elapsed time and freezes stopped runs", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(100_000));
    const task = {
      ...orchestratedTask,
      run: { ...orchestratedTask.run!, startedAt: 90_000, endedAt: undefined },
    };
    const { rerender } = renderWithResearchMessages(
      <ResearchGlobalBar task={task} onOpenWorkbench={vi.fn()} />,
    );
    expect(screen.getByText("10s")).toBeTruthy();
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getByText("11s")).toBeTruthy();
    rerender(
      <NextIntlClientProvider
        locale="en"
        messages={{ Research: researchMessages }}
      >
        <ResearchGlobalBar
          task={{
            ...task,
            status: "paused",
            run: { ...task.run, endedAt: 100_000 },
          }}
          onOpenWorkbench={vi.fn()}
        />
      </NextIntlClientProvider>,
    );
    act(() => vi.advanceTimersByTime(60_000));
    expect(screen.getByText("10s")).toBeTruthy();
  });
  it("exposes view progress and pause/resume actions", async () => {
    const open = vi.fn(),
      pause = vi.fn();
    renderWithResearchMessages(
      <ResearchGlobalBar
        task={orchestratedTask}
        onOpenWorkbench={open}
        onPause={pause}
      />,
    );
    await userEvent.click(
      screen.getByRole("button", { name: "View progress" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Pause" }));
    expect(open).toHaveBeenCalledOnce();
    expect(pause).toHaveBeenCalledOnce();
  });
});

describe("ResearchWorkbench", () => {
  it("opens reports first, has exactly three keyboard-navigable tabs and a 3xl reader", async () => {
    renderWithResearchMessages(
      <ResearchWorkbench task={partialTask} onClose={vi.fn()} />,
    );
    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(3);
    expect(tabs.map((t) => t.textContent)).toEqual([
      "Report",
      "Sources (1)",
      "How it was researched",
    ]);
    expect(tabs[0].getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(tabs[0], { key: "End" });
    expect(tabs[2].getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(tabs[2]);
    expect(screen.getByRole("tabpanel").firstElementChild?.className).toContain(
      "max-w-3xl",
    );
    expect(screen.queryByText("Research topology")).toBeNull();
  });
  it("defaults to process before a report is available and opens editing in a dialog", async () => {
    renderWithResearchMessages(
      <ResearchWorkbench
        task={approvalTask}
        onClose={vi.fn()}
        onAdjustPlan={vi.fn()}
      />,
    );
    expect(
      screen
        .getByRole("tab", { name: "How it was researched" })
        .getAttribute("aria-selected"),
    ).toBe("true");
    await userEvent.click(screen.getByRole("button", { name: "Edit plan" }));
    expect(await screen.findByRole("dialog")).toBeTruthy();
  });
  it("binds version selection to report, notes, Q&A and export", async () => {
    const selected = vi.fn(),
      download = vi.fn();
    renderWithResearchMessages(
      <ResearchWorkbench
        task={partialTask}
        onClose={vi.fn()}
        onSelectReportVersion={selected}
        onDownloadMarkdown={download}
      />,
    );
    await userEvent.click(
      screen.getByRole("combobox", {
        name: researchMessages.report.selectVersion,
      }),
    );
    await userEvent.click(
      await screen.findByRole("option", { name: "Version 1" }),
    );
    expect(selected).toHaveBeenCalledWith("report-1");
    await userEvent.click(
      screen.getByRole("button", { name: "Ask about this report" }),
    );
    expect(
      (await screen.findByTestId("evidence-topic-panel")).getAttribute(
        "data-report-id",
      ),
    ).toBe("report-1");
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await userEvent.click(screen.getByRole("button", { name: "Download" }));
    await userEvent.click(
      await screen.findByRole("menuitem", { name: "Markdown" }),
    );
    expect(download).toHaveBeenCalledWith("report-1");
  });
  it("hides version selection for a single report and separates notes and sources", async () => {
    const report = {
      ...partialTask.reportVersions[1],
      markdown:
        "# Report\n\n## Executive summary\nMain finding.\n\n## Evidence gaps\nA missing primary source.\n\n## Sources\nA report citation.",
    };
    renderWithResearchMessages(
      <ResearchWorkbench
        task={{ ...completedTask, reportVersions: [report] }}
        onClose={vi.fn()}
      />,
    );
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(
      screen.getAllByTestId("research-report-markdown")[0].textContent,
    ).not.toContain("A missing primary source.");
    await userEvent.click(
      screen.getByRole("button", { name: "Notes and limits" }),
    );
    expect(
      screen
        .getAllByTestId("research-report-markdown")
        .some((n) => n.textContent?.includes("A missing primary source.")),
    ).toBe(true);
    await userEvent.click(screen.getByRole("tab", { name: /^Sources/ }));
    expect(screen.getByText("Cited in the report")).toBeTruthy();
    expect(
      screen
        .getAllByTestId("research-report-markdown")
        .some((n) => n.textContent?.includes("A report citation.")),
    ).toBe(true);
  });
  it("keeps source search visible and additional filters collapsed", async () => {
    renderWithResearchMessages(
      <ResearchWorkbench task={partialTask} onClose={vi.fn()} />,
    );
    await userEvent.click(screen.getByRole("tab", { name: /^Sources/ }));
    expect(screen.getByRole("searchbox")).toBeTruthy();
    const filters = screen.getByRole("button", { name: "More filters" });
    expect(filters.getAttribute("aria-expanded")).toBe("false");
    await userEvent.click(filters);
    expect(filters.getAttribute("aria-expanded")).toBe("true");
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "missing source" },
    });
    expect(screen.queryByText("Primary product documentation")).toBeNull();
  });
  it("retains failed continuation text and offers latest-information refresh", async () => {
    const more = vi.fn().mockRejectedValue(new Error("lost")),
      refresh = vi.fn();
    renderWithResearchMessages(
      <ResearchWorkbench
        task={completedTask}
        onClose={vi.fn()}
        onContinueResearch={more}
        onUpdateLatest={refresh}
      />,
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Research more" }),
    );
    const dialog = await screen.findByRole("dialog");
    await flushDialogFocus();
    const text = within(dialog).getByRole("textbox");
    await userEvent.type(text, "Check updates");
    await userEvent.click(
      within(dialog).getByRole("button", {
        name: researchMessages.followup.continue.submit,
      }),
    );
    expect((text as HTMLTextAreaElement).value).toBe("Check updates");
    expect(within(dialog).getByRole("alert")).toBeTruthy();
    await userEvent.click(
      within(dialog).getByRole("button", {
        name: "Refresh with the latest information",
      }),
    );
    expect(refresh).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("keeps new labels available in every locale", () => {
    for (const messages of [
      researchMessages,
      chineseResearchMessages,
      japaneseResearchMessages,
    ]) {
      expect(messages.tabs.sources).toBeTruthy();
      expect(messages.tabs.process).toBeTruthy();
      expect(messages.card.starterNotice).toBeTruthy();
      expect(messages.runtime.error.adjustFailed).toBeTruthy();
    }
  });
  it.each([approvalTask, orchestratedTask, partialTask])(
    "has no automated WCAG A/AA violations for $status",
    async (task) => {
      const { container } = renderWithResearchMessages(
        <ResearchWorkbench
          task={task}
          onClose={vi.fn()}
          onConfirmPlan={vi.fn()}
          onUpdatePlanPreset={vi.fn()}
        />,
      );
      await flushDialogFocus();
      const result = await axe.run(container, {
        runOnly: {
          type: "tag",
          values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"],
        },
        rules: { "color-contrast": { enabled: false } },
      });
      expect(result.violations.map((v) => v.id)).toEqual([]);
    },
  );
});
