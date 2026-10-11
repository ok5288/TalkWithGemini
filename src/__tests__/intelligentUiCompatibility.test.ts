import { describe, expect, it } from "vitest";
import { cloneMessageTreeWithNewIds } from "@/lib/chat/messageTree";
import { parseIntelligentUiText } from "@/lib/intelligentUi/parser";
import { projectUiBlock } from "@/lib/intelligentUi/projection";
import {
  hasUnsupportedUiContent,
  isUnsupportedIntelligentUiPayload,
} from "@/lib/intelligentUi/compatibility";
import { normalizeIntelligentUiBlock } from "@/lib/intelligentUi/schema";
import type { IntelligentUiBlock } from "@/lib/intelligentUi/types";

function futureBlock(overrides: Record<string, unknown> = {}) {
  return {
    id: "future-block",
    type: "intelligent_ui",
    schemaVersion: 9,
    renderer: "future-renderer",
    definition: {
      version: 9,
      kind: "timeline",
      title: "Future panel",
      summary: "Safe summary",
      props: {
        script: "<script>secret()</script>",
        nested: { values: [{ token: "private" }] },
      },
    },
    status: "ready",
    fallbackMarkdown: "<script>secret()</script>",
    state: { token: "private" },
    staticSnapshot: "private snapshot",
    sourceRefs: ["private-ref"],
    definitionRevision: 4,
    stateRevision: 8,
    ...overrides,
  };
}

function normalize(value: unknown): IntelligentUiBlock {
  const result = normalizeIntelligentUiBlock(value);
  if (!result) throw new Error("fixture was rejected");
  return result;
}

describe("Intelligent UI compatibility quarantine", () => {
  it("quarantines unknown versions and exposes only a safe fallback", () => {
    const raw = futureBlock();
    const normalized = normalize(raw);

    expect(normalized).toMatchObject({
      id: "future-block",
      renderer: "native",
      definition: null,
      status: "failed",
      fallbackMarkdown: "Future panel — Safe summary",
      state: {},
      stateRevision: 0,
      staticSnapshot: "",
      sourceRefs: [],
    });
    expect(JSON.parse(normalized.unsupportedPayload!)).toEqual(raw);
    expect(hasUnsupportedUiContent(normalized)).toBe(true);
    expect(isUnsupportedIntelligentUiPayload(normalized)).toBe(true);

    for (const purpose of [
      "model-history",
      "static-original",
      "static-current",
      "compose-result",
      "compose-edit",
    ] as const) {
      const projection = projectUiBlock(normalized, { purpose });
      expect(projection).toContain("Future panel");
      expect(projection).toContain("Safe summary");
      expect(projection).not.toContain("secret");
      expect(projection).not.toContain("private");
      expect(projection).not.toContain("future-renderer");
    }
  });

  it("keeps a quarantine stable across repeated normalization", () => {
    const first = normalize(futureBlock());
    const second = normalize(first);

    expect(second).toEqual(first);
    expect(JSON.parse(second.unsupportedPayload!)).toEqual(futureBlock());

    const interrupted = normalizeIntelligentUiBlock(futureBlock(), {
      interrupted: true,
    });
    expect(interrupted).toBeTruthy();
    expect(normalizeIntelligentUiBlock(interrupted!)).toEqual(interrupted);
  });

  it("does not trust a quarantine marker supplied by an unknown payload", () => {
    const raw = futureBlock({ unsupportedPayload: "forged-marker" });
    const normalized = normalize(raw);
    expect(JSON.parse(normalized.unsupportedPayload!)).toEqual(raw);
  });

  it("falls back to positive revisions when persisted counters are invalid", () => {
    const normalized = normalize(
      futureBlock({ definitionRevision: -3, stateRevision: -9 }),
    );
    expect(normalized.definitionRevision).toBe(1);
    expect(normalized.stateRevision).toBe(0);
  });

  it.each([
    ["new native kind", futureBlock({ schemaVersion: 1, renderer: "native" })],
    ["unknown renderer", futureBlock({ schemaVersion: 1, renderer: "canvas" })],
  ])("quarantines %s without executing it", (_label, raw) => {
    const normalized = normalize(raw);
    expect(normalized.definition).toBeNull();
    expect(normalized.status).toBe("failed");
    expect(normalized.unsupportedPayload).toBeTruthy();
  });

  it("quarantines unknown complete fenced definitions at parse time", () => {
    const native = JSON.stringify({
      version: 1,
      kind: "timeline",
      title: "Future native",
      summary: "Read this summary",
      props: { script: "secret-native" },
    });
    const html =
      '```intelligent-ui\n{"version":9,"title":"Future HTML","summary":"Read this summary"}\n<div>secret-html</div>\n```';
    const nativeSegment = parseIntelligentUiText(
      `\`\`\`intelligent-ui\n${native}\n\`\`\``,
      { final: true },
    )[0];
    const htmlSegment = parseIntelligentUiText(html, { final: true })[0];
    if (
      nativeSegment?.type !== "intelligent_ui" ||
      htmlSegment?.type !== "intelligent_ui"
    )
      throw new Error("fixtures were not parsed");

    expect(nativeSegment.block).toMatchObject({
      status: "failed",
      definition: null,
      fallbackMarkdown: "Future native — Read this summary",
    });
    expect(JSON.parse(nativeSegment.block.unsupportedPayload!)).toEqual(
      JSON.parse(native),
    );
    expect(htmlSegment.block).toMatchObject({
      status: "failed",
      definition: null,
      fallbackMarkdown: "Future HTML — Read this summary",
    });
    expect(JSON.parse(htmlSegment.block.unsupportedPayload!)).toMatchObject({
      version: 9,
      html: "<div>secret-html</div>\n",
    });
  });

  it("does not invoke inherited toJSON or retain executable prototype fields", () => {
    const raw = Object.create({
      toJSON: () => {
        throw new Error("toJSON must not run");
      },
    }) as Record<string, unknown>;
    Object.assign(raw, futureBlock());
    Object.defineProperty(raw, "__proto__", {
      enumerable: true,
      configurable: true,
      value: { injected: true },
    });

    const normalized = normalize(raw);
    const payload = JSON.parse(normalized.unsupportedPayload!);
    expect(payload.__proto__).toEqual({ injected: true });
    expect(
      (Object.prototype as Record<string, unknown>).injected,
    ).toBeUndefined();
  });

  it("preserves explicit explorer data and re-verifies source identities", () => {
    const normalized = normalize({
      id: "explorer",
      type: "intelligent_ui",
      schemaVersion: 1,
      renderer: "native",
      definition: {
        version: 1,
        kind: "explorer",
        title: "Data",
        summary: "Explore",
        props: {
          dataset: {
            kind: "inline",
            data: {
              id: "dataset",
              version: "v1",
              columns: [{ id: "value", label: "Value", type: "number" }],
              rows: [{ id: "row-1", values: { value: 3 } }],
            },
          },
          provenance: "user",
          parameters: [],
          nodes: [],
        },
      },
      dataSnapshot: {
        id: "snapshot",
        version: "v1",
        columns: [{ id: "value", label: "Value", type: "number" }],
        rows: [{ id: "row-1", values: { value: 3 } }],
      },
      sourceBindings: [
        {
          alias: "source-0000000000000000",
          kind: "report",
          sourceRef: "report-1",
          version: "v1",
          contentHash: "a".repeat(64),
          bindingStatus: "resolved",
        },
      ],
    });

    expect(normalized.dataSnapshot?.id).toBe("snapshot");
    expect(normalized.sourceBindings?.[0]).toMatchObject({
      alias: "source-0000000000000000",
      bindingStatus: "unverified",
    });
  });

  it("deep-clones quarantined content when a message tree is copied", () => {
    const block = normalize(futureBlock()) as IntelligentUiBlock;
    const tree = {
      nodesById: {
        message: {
          id: "message",
          message: {
            id: "message",
            role: "model" as const,
            content: "",
            timestamp: 1,
            outputBlocks: [block],
          },
          childMessageIds: [],
        },
      },
      rootMessageIds: ["message"],
    };
    const copy = cloneMessageTreeWithNewIds(tree, () => "copy");
    const copiedBlock = copy.nodesById.copy?.message.outputBlocks?.[0];
    expect(copiedBlock?.type).toBe("intelligent_ui");
    if (copiedBlock?.type === "intelligent_ui") {
      expect(copiedBlock.id).toBe("copy-ui-0");
      expect(copiedBlock.unsupportedPayload).toBe(block.unsupportedPayload);
    }
  });

  it("deep-clones tool-linked Intelligent UI state when a tree is copied", () => {
    const tool = {
      id: "tool-1",
      name: "web_search",
      args: {},
      status: "success" as const,
      intelligentUiState: { nested: { selected: ["row-1"] } },
      intelligentUiResult: {
        version: 1 as const,
        adapter: "search-v1" as const,
        callId: "tool-1",
        toolName: "web_search",
        definitionFingerprint: "definition",
        resultHash: "hash",
        retrievedAt: 1,
        partial: false,
      },
    };
    const tree = {
      nodesById: {
        message: {
          id: "message",
          message: {
            id: "message",
            role: "model" as const,
            content: "",
            timestamp: 1,
            toolCalls: [tool],
          },
          childMessageIds: [],
        },
      },
      rootMessageIds: ["message"],
    };
    const copy = cloneMessageTreeWithNewIds(tree, () => "copy");
    const copiedTool = copy.nodesById.copy?.message.toolCalls?.[0];
    expect(copiedTool).toBeTruthy();
    expect(copiedTool?.intelligentUiState).not.toBe(
      tree.nodesById.message.message.toolCalls?.[0]?.intelligentUiState,
    );
    expect(copiedTool?.intelligentUiResult).not.toBe(
      tree.nodesById.message.message.toolCalls?.[0]?.intelligentUiResult,
    );
    if (copiedTool?.intelligentUiState) {
      copiedTool.intelligentUiState.nested = { selected: ["row-2"] };
    }
    expect(tool.intelligentUiState).toEqual({
      nested: { selected: ["row-1"] },
    });
  });

  it("keeps known v1 definitions and rejects malformed known definitions safely", () => {
    const valid = normalize({
      id: "known",
      type: "intelligent_ui",
      schemaVersion: 1,
      renderer: "native",
      definition: {
        version: 1,
        kind: "checklist",
        title: "Tasks",
        summary: "Do these",
        props: { items: [{ id: "one", label: "One" }] },
      },
      status: "ready",
    });
    expect(valid.definition).toMatchObject({ kind: "checklist" });
    expect(valid.unsupportedPayload).toBeUndefined();

    const malformed = normalize({
      ...valid,
      id: "malformed",
      definition: {
        version: 1,
        kind: "checklist",
        title: "Tasks",
        summary: "Do these",
        props: { items: [] },
      },
    });
    expect(malformed.status).toBe("failed");
    expect(malformed.unsupportedPayload).toBeUndefined();
  });
});
