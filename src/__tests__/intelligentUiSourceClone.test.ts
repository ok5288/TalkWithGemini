import { describe, expect, it } from "vitest";
import {
  cloneMessageTreeWithNewIds,
  normalizeSessionMessageTree,
} from "@/lib/chat/messageTree";
import { getUiSourceAlias } from "@/lib/intelligentUi/sources/resolver";
import { remapClonedUiSources } from "@/lib/intelligentUi/sources/clone";
import { createResearchTask } from "@/lib/research/task";
import { getReferencedResearchTaskIds } from "@/services/research/sessionLifecycle";
import type { ResearchReportVersion } from "@/lib/research/types";
import type { IntelligentUiBlock } from "@/lib/intelligentUi/types";

describe("exact source identity remapping during session duplication", () => {
  it("deep-copies tool-only block state without inventing new execution journal IDs", () => {
    const original = normalizeSessionMessageTree([
      {
        id: "m",
        role: "model",
        content: "",
        timestamp: 1,
        outputBlocks: [
          {
            id: "tools",
            type: "tool_group",
            toolCalls: [
              {
                id: "call",
                name: "table",
                args: {},
                status: "success",
                executionRecordId: "original-execution",
                intelligentUiState: { selected: ["row"] },
              },
            ],
          },
        ],
      },
    ]);
    const copied = cloneMessageTreeWithNewIds(original, () => "copy");
    const originalBlock = original.nodesById.m.message.outputBlocks![0];
    const copiedBlock = copied.nodesById.copy.message.outputBlocks![0];
    if (
      originalBlock.type !== "tool_group" ||
      copiedBlock.type !== "tool_group"
    )
      throw Error("fixture");
    expect(copiedBlock.toolCalls[0].executionRecordId).toBe(
      "original-execution",
    );
    expect(copiedBlock.toolCalls[0].intelligentUiState).not.toBe(
      originalBlock.toolCalls[0].intelligentUiState,
    );
    copiedBlock.toolCalls[0].intelligentUiState!.selected = [];
    expect(originalBlock.toolCalls[0].intelligentUiState!.selected).toEqual([
      "row",
    ]);
  });
  it("collects report-only attachments and maps report metadata and bindings by clone identity", async () => {
    const task = createResearchTask({
      id: "task",
      sessionId: "original",
      goal: "Report",
      now: 1,
    });
    const report: ResearchReportVersion = {
      id: "report",
      version: 1,
      artifactId: "opfs://report",
      planVersion: 1,
      researchRunId: "run",
      createdAt: 1,
      summary: "",
      keyFindings: [],
      gaps: [],
      kind: "initial",
    };
    task.reportVersions = [report];
    const targetTask = {
      ...task,
      id: "new-task",
      sessionId: "copy",
      reportVersions: [
        { ...report, id: "new-report", artifactId: "opfs://copied-report" },
      ],
    };
    const alias = await getUiSourceAlias("original", "report:task:report", "1");
    const block: IntelligentUiBlock = {
      id: "ui",
      type: "intelligent_ui",
      schemaVersion: 1,
      renderer: "native",
      definition: null,
      definitionRevision: 1,
      status: "failed",
      fallbackMarkdown: "Report",
      state: {},
      stateRevision: 2,
      staticSnapshot: "",
      sourceRefs: [],
      sourceBindings: [
        {
          bindingId: "binding",
          alias,
          sourceRef: "report:task:report",
          kind: "report",
          version: "1",
          contentHash: "a".repeat(64),
          bindingStatus: "resolved",
        },
      ],
    };
    const originalTree = normalizeSessionMessageTree([
      {
        id: "message",
        role: "model",
        content: "",
        timestamp: 1,
        attachments: [
          {
            id: "attachment",
            fileName: "report.md",
            mimeType: "text/markdown",
            url: report.artifactId,
            intelligentUiSource: {
              kind: "report",
              taskId: task.id,
              reportId: report.id,
              artifactId: report.artifactId,
              version: 1,
            },
          },
        ],
        outputBlocks: [block],
      },
    ]);
    expect(getReferencedResearchTaskIds(originalTree)).toEqual([task.id]);
    const messageIdMap = new Map<string, string>();
    const clonedTree = cloneMessageTreeWithNewIds(
      originalTree,
      () => "new-message",
      messageIdMap,
    );
    const copied = await remapClonedUiSources({
      originalSessionId: "original",
      targetSessionId: "copy",
      originalTree,
      clonedTree,
      messageIdMap,
      taskIdMap: new Map([[task.id, targetTask.id]]),
      originalTasks: [task],
      targetTasks: [targetTask],
    });
    expect(
      copied.nodesById["new-message"].message.attachments![0],
    ).toMatchObject({
      url: "opfs://copied-report",
      intelligentUiSource: {
        taskId: "new-task",
        reportId: "new-report",
        artifactId: "opfs://copied-report",
        version: 1,
      },
    });
    const binding = (
      copied.nodesById["new-message"].message
        .outputBlocks![0] as IntelligentUiBlock
    ).sourceBindings![0];
    expect(binding).toMatchObject({
      sourceRef: "report:new-task:new-report",
      version: "1",
      contentHash: "a".repeat(64),
      bindingStatus: "unverified",
      alias: await getUiSourceAlias("copy", "report:new-task:new-report", "1"),
    });
    expect(originalTree.nodesById.message.message.attachments![0].url).toBe(
      "opfs://report",
    );
    const unavailable = await remapClonedUiSources({
      originalSessionId: "original",
      targetSessionId: "copy",
      originalTree,
      clonedTree,
      messageIdMap,
      taskIdMap: new Map(),
      originalTasks: [task],
      targetTasks: [],
    });
    expect(
      unavailable.nodesById["new-message"].message.attachments![0]
        .localFileMissing,
    ).toBe(true);
    expect(
      (
        unavailable.nodesById["new-message"].message
          .outputBlocks![0] as IntelligentUiBlock
      ).sourceBindings![0].bindingStatus,
    ).toBe("unavailable");
  });
});
