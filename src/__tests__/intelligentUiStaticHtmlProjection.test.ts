import { expect, it } from "vitest";
import { projectUiBlock } from "@/lib/intelligentUi/projection";
import { uiLabels } from "@/lib/intelligentUi/localization";
import type { IntelligentUiBlock } from "@/lib/intelligentUi/types";

it.each(["en", "zh", "ja"])(
  "labels interface snapshots and missing reports in %s without exposing private original state",
  (locale) => {
    const block: IntelligentUiBlock = {
      id: "html",
      type: "intelligent_ui",
      renderer: "html",
      schemaVersion: 1,
      definitionRevision: 1,
      stateRevision: 1,
      state: { private: "SECRET" },
      staticSnapshot: "<script>PRIVATE</script>",
      sourceRefs: [],
      fallbackMarkdown: "Simulation",
      status: "ready",
      definition: {
        version: 1,
        title: "Simulation",
        summary: "Explore",
        html: "<p>Code</p>",
      },
    };
    const plain = (text: string) =>
      text.replace(/\\([\\`*_{}\[\]<>()#!|])/g, "$1");
    const current = projectUiBlock(block, {
      purpose: "static-current",
      locale,
    });
    expect(plain(current)).toContain(uiLabels(locale).htmlSnapshotLabel);
    expect(current).toContain("\\<script\\>");
    expect(current).not.toContain("<script>");
    expect(current).not.toContain("SECRET");
    const original = projectUiBlock(block, {
      purpose: "static-original",
      locale,
    });
    expect(original).not.toMatch(/PRIVATE|SECRET|script|Code/);
    expect(plain(original)).not.toContain(uiLabels(locale).htmlSnapshotLabel);
    expect(
      plain(
        projectUiBlock(
          { ...block, staticSnapshot: "" },
          { purpose: "static-current", locale },
        ),
      ),
    ).toContain(uiLabels(locale).htmlSnapshotMissing);
  },
);
