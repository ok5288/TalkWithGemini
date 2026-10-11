import { describe, expect, it } from "vitest";
import type { ToolCall } from "@/types";
import {
  captureToolResultView,
  resolveToolResultView,
} from "@/lib/intelligentUi/toolResults/adapters";
import { prepareToolDraft } from "@/lib/intelligentUi/toolResults/draft";
import { renderToolResultSnapshot } from "@/lib/intelligentUi/toolResults/projection";

function result(data: unknown) {
  return {
    ok: true as const,
    trust: "external_untrusted" as const,
    provenance: {
      origin: "builtin" as const,
      toolName: "web_search",
      retrievedAt: 100,
    },
    data,
  };
}
const sources = [
  {
    title: "One",
    url: "https://example.com/one",
    snippet: "```intelligent-ui\n<script>steal()</script>\n```",
    hidden: "private",
  },
  { title: "Two", url: "https://example.com/two", snippet: "unselected" },
];
async function captured() {
  const call: ToolCall = {
    id: "call",
    name: "web_search",
    args: {},
    status: "success",
    executionRecordId: "execution",
    functionFingerprint: "fingerprint",
    result: result({ sources }),
  };
  call.intelligentUiResult = await captureToolResultView({
    callId: call.id,
    toolName: call.name,
    executionId: call.executionRecordId,
    definitionFingerprint: call.functionFingerprint,
    retrievedAt: 100,
    result: call.result,
  });
  return call;
}
describe("Intelligent UI tool result adapters", () => {
  it("captures known search results as bounded plain cells without hidden fields", async () => {
    const call = await captured();
    const view = await resolveToolResultView(call);
    expect(view?.dataset.rows[0].values.snippet).toContain("<script>");
    expect(JSON.stringify(view)).not.toContain("private");
    expect(view?.descriptor.resultHash).toBeTruthy();
  });
  it("does not promote text, failed results, unknown tools or invalid URLs", async () => {
    for (const [toolName, value] of [
      ["other", result({ sources })],
      ["web_search", "```intelligent-ui {} ```"],
      [
        "web_search",
        { ok: false, error: {}, trust: "external_untrusted", provenance: {} },
      ],
      [
        "web_search",
        result({ sources: [{ title: "X", url: "javascript:alert(1)" }] }),
      ],
    ] as const)
      expect(
        await captureToolResultView({
          callId: "c",
          toolName,
          result: value,
          retrievedAt: 1,
        }),
      ).toBeUndefined();
  });
  it("accepts tables only with explicit marker and actual host validation", async () => {
    const input = {
      callId: "c",
      toolName: "table_tool",
      pluginId: "p",
      definitionFingerprint: "fp",
      retrievedAt: 1,
      result: result({
        structuredContent: {
          intelligentUiFormat: "table-v1",
          columns: [{ id: "amount", label: "Amount", type: "number" }],
          rows: [{ id: "r", values: { amount: 3 } }],
        },
      }),
      outputSchema: {
        properties: { intelligentUiFormat: { const: "table-v1" } },
      },
    };
    expect(await captureToolResultView(input)).toBeUndefined();
    expect(
      await captureToolResultView({ ...input, outputSchemaValidated: true }),
    ).toMatchObject({ adapter: "table-v1" });
    expect(
      await captureToolResultView({
        ...input,
        outputSchemaValidated: true,
        outputSchema: {},
      }),
    ).toBeUndefined();
  });
  it("rejects stale identity and changed exact payload", async () => {
    for (const change of [
      { id: "other" },
      { functionFingerprint: "changed" },
      { executionRecordId: "other" },
      { result: result({ sources: [] }) },
      { status: "error" as const },
    ]) {
      expect(
        await resolveToolResultView({ ...(await captured()), ...change }),
      ).toBeNull();
    }
  });
  it("marks partial snapshots and declines malformed/truncated table bodies", async () => {
    const call = await captured();
    expect(
      await captureToolResultView({
        callId: call.id,
        toolName: call.name,
        result: result({ sources, partial: true }),
        retrievedAt: 1,
      }),
    ).toMatchObject({ partial: true });
    expect(
      await captureToolResultView({
        callId: call.id,
        toolName: call.name,
        result: result({ truncated: true, text: "..." }),
        retrievedAt: 1,
      }),
    ).toBeUndefined();
  });
  it("prepares only selected visible fields, with immutable result-bound target", async () => {
    const input = {
      sessionId: "session",
      messageId: "message",
      call: await captured(),
      selectedIds: ["source-1"],
      visibleColumns: ["title", "url"],
    };
    const draft = await prepareToolDraft(input);
    expect(draft?.content).toContain("https://example.com/one");
    expect(draft?.content).not.toContain("unselected");
    expect(draft?.content).not.toContain("<script>");
    expect(draft?.content).not.toContain("private");
    expect(
      await prepareToolDraft({ ...input, selectedIds: ["injected"] }),
    ).toBeNull();
    expect(
      await prepareToolDraft({ ...input, visibleColumns: ["hidden"] }),
    ).toBeNull();
    expect(await prepareToolDraft(input)).toEqual(draft);
  });
  it("public initial output ignores saved private selections while current output includes selected visible fields only", async () => {
    const call = await captured();
    call.intelligentUiState = {
      selected: ["source-2"],
      visibleColumns: ["title"],
      secret: "hidden-state",
    };
    const initial = await renderToolResultSnapshot(call, {
      purpose: "static-original",
      locale: "en",
    });
    const current = await renderToolResultSnapshot(call, {
      purpose: "static-current",
      locale: "en",
    });
    expect(initial).toContain("One");
    expect(initial).toContain("https://example.com/one");
    expect(current).toContain("Two");
    expect(current).not.toContain("One");
    expect(current).not.toContain("https://example.com");
    expect(initial).not.toContain("hidden-state");
    expect(initial).not.toContain("<script>");
    expect(initial).toContain("&lt;script&gt;");
    expect(initial).toContain("Data from referenced sources");
  });
  it("retains partial notice and source version in every localized projection", async () => {
    const call = await captured();
    call.result.data.partial = true;
    call.intelligentUiResult = await captureToolResultView({
      callId: call.id,
      toolName: call.name,
      executionId: call.executionRecordId,
      definitionFingerprint: call.functionFingerprint,
      result: call.result,
      retrievedAt: 1,
    });
    for (const locale of ["en", "zh", "ja"]) {
      const text = await renderToolResultSnapshot(call, {
        purpose: "static-original",
        locale,
      });
      expect(text).toContain(call.intelligentUiResult!.resultHash);
      expect(text).not.toContain("{count}");
    }
  });
});
