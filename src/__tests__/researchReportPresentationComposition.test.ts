import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createReportPresentation,
  WORKBENCH_TABS,
} from "@/components/research/workbench/workbenchUtils";
import en from "@/i18n/locales/en/Research.json";
import zh from "@/i18n/locales/zh/Research.json";
import ja from "@/i18n/locales/ja/Research.json";

describe("Research report presentation composition", () => {
  it("keeps supplements out of the report body while exporting one complete version", () => {
    const workbenchDir = resolve(
      process.cwd(),
      "src/components/research/workbench",
    );
    const workbench = readFileSync(
      resolve(workbenchDir, "ResearchWorkbench.tsx"),
      "utf8",
    );
    const reportPanel = readFileSync(
      resolve(workbenchDir, "ReportPanel.tsx"),
      "utf8",
    );
    const connected = readFileSync(
      resolve(
        process.cwd(),
        "src/components/research/ConnectedResearchViews.tsx",
      ),
      "utf8",
    );

    expect(WORKBENCH_TABS).toEqual(["report", "sources", "process"]);
    expect(workbench).toContain('tab === "sources"');
    expect(workbench).toContain('tab === "process"');
    expect(workbench).not.toContain("SupplementPanel");
    expect(workbench).toContain(
      "notesMarkdown={reportPresentation.notesMarkdown}",
    );
    expect(workbench).toContain("createReportPresentation");
    expect(workbench).not.toContain("<ResearchRunRail run={task.run} />");
    expect(reportPanel).toContain("ReportTrustSummary");
    expect(reportPanel).toContain('t("report.gapsTitle")');
    expect(reportPanel).toContain('t("report.changeSummary")');
    expect(reportPanel).toContain("report.diff");
    expect(reportPanel).toContain("report.audit");
    expect(reportPanel).toContain("DropdownMenu");
    expect(reportPanel).toContain('t("actions.downloadReport")');
    expect(reportPanel).toContain("imageSources={imageSources}");
    expect(reportPanel).not.toContain("ResearchImageGallery");
    expect(connected).toContain("createReportPresentation");
    expect(connected).toContain("report.markdown");
    expect(connected).toContain("imageSources={printReport.imageSources}");
    expect(connected).not.toContain("appendResearchImageMaterialsMarkdown");
    expect(connected).not.toContain('t("export.metadata")');
    expect(connected).not.toContain('t("export.taskId")');
    expect(connected).not.toContain('t("export.evidenceCount")');
  });
});

it.each([en, zh, ja])(
  "partitions notes and cited sources while preserving complete exports and reference definitions",
  (messages) => {
    const markdown = `# Report

## Executive summary
A finding [x][ref].

## Sources
[Source 1] Local archive

[ref]: https://example.com

## Evidence gaps
Unknown date.

## Research plan coverage
- step-1: answered`;
    const view = createReportPresentation(
      markdown,
      [
        {
          id: "local",
          title: "Local archive",
          sourceType: "knowledge",
          retrievedAt: 1,
          linkedClaims: [],
        },
      ],
      messages.report.sections,
    );
    expect(view.bodyMarkdown).toContain("A finding");
    expect(view.bodyMarkdown).not.toContain("Unknown date");
    expect(view.bodyMarkdown).not.toContain("Local archive");
    expect(view.notesMarkdown).toContain("Unknown date");
    expect(view.notesMarkdown).toContain("step-1");
    expect(view.notesMarkdown).not.toContain("Local archive");
    expect(view.sourcesMarkdown).toContain(
      "[Source 1](#citation-0) Local archive",
    );
    expect(view.sourcesMarkdown).not.toContain("Unknown date");
    expect(view.sourcesMarkdown).not.toContain("step-1");
    expect(view.bodyMarkdown).toContain("[ref]: https://example.com");
    expect(view.markdown).toContain("Unknown date");
    expect(view.markdown).toContain("[Source 1] Local archive");
    expect(view.markdown).not.toContain("#citation-");
  },
);
