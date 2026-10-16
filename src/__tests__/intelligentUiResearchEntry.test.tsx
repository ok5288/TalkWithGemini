// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { ReportPanel } from "@/components/research/workbench/ReportPanel";
import type { ResearchTaskViewModel } from "@/components/research/types";
import researchMessages from "@/i18n/locales/en/Research.json";
vi.mock("@/components/content/MarkdownRenderer", () => ({
  default: ({ content }: { content: string }) => <article>{content}</article>,
}));
afterEach(cleanup);
const report = {
  id: "report-v2",
  version: 2,
  createdAt: 1,
  title: "Original report",
  markdown: "Unchanged evidence",
};
const task: ResearchTaskViewModel = {
  id: "task",
  title: "Study",
  status: "completed",
  completedQuestions: 1,
  totalQuestions: 1,
  evidence: [],
  activities: [],
  reportVersions: [report],
  usage: {
    toolRounds: 0,
    maxToolRounds: 1,
    toolCalls: 0,
    maxToolCalls: 1,
    elapsedMs: 1,
    maxWallTimeMs: 1,
  },
};
describe("interactive report explanation entry", () => {
  it("stages the selected version only after an explicit click and leaves evidence actions independent", () => {
    const explain = vi.fn();
    const download = vi.fn();
    render(
      <NextIntlClientProvider
        locale="en"
        messages={{ Research: researchMessages }}
      >
        <ReportPanel
          task={task}
          report={report}
          reportMarkdown={report.markdown}
          notesMarkdown=""
          reportSources={[]}
          imageSources={[]}
          onSelectVersion={vi.fn()}
          onInspectEvidence={vi.fn()}
          onInteractiveExplanation={explain}
          onDownloadMarkdown={download}
        />
      </NextIntlClientProvider>,
    );
    expect(explain).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "Explain interactively in chat" }),
    );
    expect(explain).toHaveBeenCalledExactlyOnceWith("report-v2");
    expect(download).not.toHaveBeenCalled();
    expect(screen.getByText("Unchanged evidence")).toBeTruthy();
  });
  it("does not offer interactive explanation when no authorized callback exists", () => {
    render(
      <NextIntlClientProvider
        locale="en"
        messages={{ Research: researchMessages }}
      >
        <ReportPanel
          task={task}
          report={report}
          reportMarkdown={report.markdown}
          notesMarkdown=""
          reportSources={[]}
          imageSources={[]}
          onSelectVersion={vi.fn()}
          onInspectEvidence={vi.fn()}
        />
      </NextIntlClientProvider>,
    );
    expect(
      screen.queryByRole("button", { name: "Explain interactively in chat" }),
    ).toBeNull();
  });
});
