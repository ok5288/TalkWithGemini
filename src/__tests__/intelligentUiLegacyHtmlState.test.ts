import { describe, expect, it } from "vitest";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import type { Message, SessionMessageTree } from "@/types";
import type { IntelligentUiBlock, JsonObject } from "@/lib/intelligentUi/types";
import {
  normalizeIntelligentUiBlock,
  normalizeJsonState,
} from "@/lib/intelligentUi/schema";
import { isUiInstanceEligible } from "@/lib/intelligentUi/instance";
import {
  createHtmlRuntimeGuards,
  HTML_RUNTIME_LIMITS,
} from "@/lib/intelligentUi/runtimeLimits";
import {
  cloneMessageTreeWithNewIds,
  getActiveMessagePath,
  normalizeSessionMessageTree,
} from "@/lib/chat/messageTree";
import { normalizeMessageTreeMessages } from "@/store/storage/migrations";
import {
  createAppExportPayload,
  type AppExportPayload,
} from "@/lib/data/appExport";
import {
  inspectBrowserAppBackup,
  type BackupManifestV3,
} from "@/lib/data/appBackup";

function nestedState(depth: number): JsonObject {
  let value: JsonObject = { marker: "preserve deepest value" };
  for (let level = 0; level < depth; level++) value = { next: [value] };
  return value;
}
function block(state: JsonObject): IntelligentUiBlock {
  return {
    id: "legacy-html",
    type: "intelligent_ui",
    schemaVersion: 1,
    renderer: "html",
    definition: {
      version: 1,
      title: "Legacy",
      summary: "Saved output",
      html: "<p>Original</p>",
    },
    definitionRevision: 3,
    status: "ready",
    fallbackMarkdown: "Saved output",
    state,
    stateRevision: 9,
    staticSnapshot: "Prior result",
    sourceRefs: [],
  };
}
function readBlock(tree: SessionMessageTree): IntelligentUiBlock {
  return getActiveMessagePath(tree)[0]!.outputBlocks![0] as IntelligentUiBlock;
}
function restore(tree: SessionMessageTree) {
  // Same normalization composition used by chatStore session loading.
  return normalizeMessageTreeMessages(normalizeSessionMessageTree(tree));
}

describe("persisted legacy HTML state", () => {
  it.each([
    ["deep", nestedState(40)],
    ["large", { text: "x".repeat(HTML_RUNTIME_LIMITS.stateBytes + 1) }],
    ["deep and large", { ...nestedState(40), text: "界".repeat(100000) }],
  ] as const)(
    "preserves %s JSON across normalize, restore, clone and private backup",
    async (_label, state) => {
      const normalized = normalizeIntelligentUiBlock(block(state))!;
      expect(normalized.state).toEqual(state);
      expect(normalized.state).not.toBe(state);
      expect(normalized.status).toBe("ready");
      expect(isUiInstanceEligible(normalized, true, true)).toBe(false);
      const message: Message = {
        id: "message",
        role: "model",
        timestamp: 1,
        content: "",
        outputBlocks: [normalized],
      };
      const loaded = restore(
        JSON.parse(JSON.stringify(normalizeSessionMessageTree([message]))),
      );
      const cloned = cloneMessageTreeWithNewIds(loaded, () => "copy");
      const payload = createAppExportPayload({
        sessionMessages: { session: cloned },
      });
      const manifest: BackupManifestV3 = {
        format: "neo-chat-backup",
        exportVersion: payload.exportVersion,
        storageVersion: payload.storageVersion,
        exportedAt: payload.exportedAt,
        dataPath: "data.json",
        files: [],
        missingReferences: [],
        excluded: payload.metadata.security.excluded,
      };
      // Browser backups use ZipPassThrough; mirror that format and avoid
      // manufacturing a high-ratio archive rejected by extraction safeguards.
      const archive = zipSync(
        {
          "manifest.json": strToU8(JSON.stringify(manifest)),
          "data.json": strToU8(JSON.stringify(payload)),
        },
        { level: 0 },
      );
      await expect(
        inspectBrowserAppBackup(new Blob([archive])),
      ).resolves.toMatchObject({ kind: "zip-v3", fileCount: 0 });
      const unpacked = JSON.parse(
        strFromU8(unzipSync(archive)["data.json"]!),
      ) as AppExportPayload;
      const roundTrip = restore(
        unpacked.data.sessionMessages.session as SessionMessageTree,
      );
      for (const candidate of [loaded, cloned, roundTrip]) {
        expect(readBlock(candidate).state).toEqual(state);
        expect(readBlock(candidate).stateRevision).toBe(9);
        expect(readBlock(candidate).definitionRevision).toBe(3);
        expect(isUiInstanceEligible(readBlock(candidate), true, true)).toBe(
          false,
        );
      }
      expect(readBlock(cloned).state).not.toBe(readBlock(loaded).state);
      expect(() =>
        createHtmlRuntimeGuards(HTML_RUNTIME_LIMITS).state(state),
      ).toThrow("runtime_limit");
    },
  );

  it("preserves JSON property names safely without prototype mutation", () => {
    const state = JSON.parse(
      '{"__proto__":{"value":1},"constructor":"saved","prototype":[2]}',
    ) as JsonObject;
    const normalized = normalizeIntelligentUiBlock(block(state))!;
    expect(JSON.stringify(normalized.state)).toBe(JSON.stringify(state));
    expect(Object.getPrototypeOf(normalized.state)).toBe(Object.prototype);
    expect(Object.prototype).not.toHaveProperty("value");
    expect(isUiInstanceEligible(normalized, true, true)).toBe(true);
    const tree = normalizeSessionMessageTree([
      {
        id: "message",
        role: "model",
        timestamp: 1,
        content: "",
        outputBlocks: [normalized],
      },
    ]);
    const exported = createAppExportPayload({
      sessionMessages: { session: tree },
    });
    const unpacked = JSON.parse(JSON.stringify(exported)) as AppExportPayload;
    const restored = restore(
      unpacked.data.sessionMessages.session as SessionMessageTree,
    );
    expect(JSON.stringify(readBlock(restored).state)).toBe(
      JSON.stringify(state),
    );
  });

  it("keeps native sanitization and runtime depth restrictions unchanged", () => {
    const state = nestedState(40);
    const native = {
      ...block(state),
      renderer: "native",
      definition: {
        version: 1,
        kind: "checklist",
        title: "Tasks",
        summary: "Tasks",
        props: { items: [{ id: "one", label: "One" }] },
      },
    };
    expect(normalizeIntelligentUiBlock(native)!.state).toEqual(
      normalizeJsonState(state),
    );
    expect(
      JSON.stringify(normalizeIntelligentUiBlock(native)!.state),
    ).not.toContain("preserve deepest value");
    expect(
      isUiInstanceEligible(
        normalizeIntelligentUiBlock(block({ value: 1 }))!,
        true,
        true,
      ),
    ).toBe(true);
  });

  it("does not execute accessors or preserve cyclic non-JSON input", () => {
    let accessed = false;
    const state = Object.defineProperty({}, "value", {
      enumerable: true,
      get() {
        accessed = true;
        return 1;
      },
    });
    expect(normalizeIntelligentUiBlock(block(state))!.state).toEqual({});
    expect(accessed).toBe(false);
    const cyclic: JsonObject = {};
    cyclic.self = cyclic;
    expect(normalizeIntelligentUiBlock(block(cyclic))!.state).toEqual({});
  });
});
