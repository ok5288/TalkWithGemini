import { describe, it, expect } from "vitest";
import { parseIntelligentUiText } from "@/lib/intelligentUi/parser";
import {
  normalizeIntelligentUiBlock,
  normalizeJsonState,
  parseNativeDefinition,
} from "@/lib/intelligentUi/schema";
import { projectUiBlock, projectUiText } from "@/lib/intelligentUi/projection";
import { CHART_PROMPT_EXAMPLE } from "@/lib/chat/diagramPrompt";
import { createMessageOutputBlockBuilder } from "@/lib/chat/messageOutputBlocks";
const definition = {
  version: 1,
  kind: "checklist",
  title: "Tasks",
  summary: "Prepare",
  props: { items: [{ id: "a", label: "One" }] },
};
const fence = "```intelligent-ui\n" + JSON.stringify(definition) + "\n```\n";
describe("Intelligent UI protocol", () => {
  it("does not recognize retired code block labels", () => {
    for (const label of ["neo-ui", "neo-html"]) {
      const source = `\`\`\`${label}\n${JSON.stringify(definition)}\n\`\`\``;
      expect(parseIntelligentUiText(source, { final: true })).toEqual([
        { type: "text", content: source, offset: 0 },
      ]);
    }
  });
  it("sends canonical source and visible fields without arbitrary saved state", () => {
    const [segment] = parseIntelligentUiText(fence, { final: true });
    if (segment?.type !== "intelligent_ui") throw Error("Missing UI");
    segment.block.state = { checked: ["a"], hidden: "PRIVATE_SECRET" };
    const context = projectUiBlock(segment.block, {
      purpose: "model-continuation",
    });
    expect(context).toContain("```intelligent-ui");
    expect(context).toContain("[x] One");
    expect(context).not.toContain("PRIVATE_SECRET");
  });
  it("distinguishes HTML definition from its reported current result", () => {
    const source =
      '```intelligent-ui\n{"version":1,"title":"Demo","summary":"Default"}\n<div>Default</div>\n```';
    const [segment] = parseIntelligentUiText(source, { final: true });
    if (segment?.type !== "intelligent_ui") throw Error("Missing UI");
    expect(segment.block.staticSnapshot).toBe("");
    expect(
      projectUiBlock(segment.block, { purpose: "model-continuation" }),
    ).toContain("No current visible result");
    segment.block.state = { secret: "HIDDEN" };
    segment.block.staticSnapshot = "Current input: 7";
    const context = projectUiBlock(segment.block, {
      purpose: "model-continuation",
    });
    expect(context).toContain("Current input: 7");
    expect(context).not.toContain("HIDDEN");
    expect(
      projectUiBlock(segment.block, { purpose: "static-original" }),
    ).not.toContain("Current input: 7");
  });
  it("preserves identity at every chunk boundary and completes before trailing text", () => {
    for (let split = 0; split <= fence.length; split++) {
      const b = createMessageOutputBlockBuilder({
        enableIntelligentUi: true,
        createId: () => "x",
      });
      b.appendText(fence.slice(0, split));
      b.getBlocks();
      b.appendText(fence.slice(split));
      const first = b.getBlocks().find((x) => x.type === "intelligent_ui");
      expect(first).toMatchObject({ id: "x-ui-0", status: "ready" });
      b.appendText("Later text");
      expect(b.getBlocks()[0]).toEqual(first);
    }
  });
  it("hides reserved fence prefixes while streaming", () => {
    for (const text of [
      "`",
      "``",
      "```i",
      "```intelligent-",
      "```intelligent-u",
    ]) {
      expect(parseIntelligentUiText(text)).toEqual([]);
    }
  });
  it("leaves nested examples and ordinary html literal", () => {
    const example = "````markdown\n" + fence + "````\n";
    expect(projectUiText(example, { purpose: "static-original" })).toBe(
      example,
    );
    const html = "```html\n<script>secret()</script>\n```";
    expect(projectUiText(html, { purpose: "static-original" })).toBe(html);
  });
  it("does not parse when disabled or inside a long-text capture", () => {
    const b = createMessageOutputBlockBuilder();
    b.appendText(fence);
    expect(b.getBlocks()[0]?.type).toBe("text");
  });
  it("does not fail partial blocks until finalized and cancels on interruption", () => {
    const b = createMessageOutputBlockBuilder({ enableIntelligentUi: true });
    b.appendText("```intelligent-ui\n{");
    expect(b.getBlocks()[0]).toMatchObject({ status: "receiving" });
    expect(b.getBlocks()[0]).toMatchObject({ status: "receiving" });
    b.finalizeIntelligentUi(true);
    expect(b.getBlocks()[0]).toMatchObject({ status: "cancelled" });
  });
  it("previews HTML after metadata and never exposes it in model projection", () => {
    const source =
      '```intelligent-ui\n{"version":1,"title":"Demo","summary":"Description"}\n<div>Preview</div><script>secret()</script>';
    const segments = parseIntelligentUiText(source);
    expect(segments[0]).toMatchObject({
      block: { renderer: "html", status: "preview" },
    });
    expect(projectUiText(source, { purpose: "static-original" })).not.toContain(
      "secret",
    );
  });
  it("unknown versions and invalid props degrade without source disclosure", () => {
    const bad = fence.replace('"version":1', '"version":2');
    expect(parseIntelligentUiText(bad)[0]).toMatchObject({
      block: { status: "failed", definition: null },
    });
    expect(projectUiText(bad, { purpose: "static-original" })).not.toContain(
      "intelligent-ui",
    );
  });
  it("strips unknown fields and prototype keys and rejects duplicate IDs", () => {
    expect(
      parseNativeDefinition({ ...definition, secret: "x" }),
    ).not.toHaveProperty("secret");
    expect(
      normalizeJsonState(JSON.parse('{"__proto__":{"admin":true},"ok":1}')),
    ).toEqual({ ok: 1 });
    expect(
      parseNativeDefinition({
        ...definition,
        props: {
          items: [
            { id: "x", label: "a" },
            { id: "x", label: "b" },
          ],
        },
      }),
    ).toBeNull();
  });
  it("restores interrupted previews without making them executable", () => {
    const s = parseIntelligentUiText(
      '```intelligent-ui\n{"version":1,"title":"x","summary":"y"}\n<div>x</div>',
    )[0];
    if (s?.type !== "intelligent_ui") throw Error();
    expect(
      normalizeIntelligentUiBlock(s.block, { interrupted: true })?.status,
    ).toBe("cancelled");
  });
  it("projects chart data without private state and quiz answers as labels", () => {
    const chart = {
      ...definition,
      kind: "chart",
      props: {
        charts: [
          { id: "chart", label: "Revenue", source: CHART_PROMPT_EXAMPLE },
        ],
        provenance: "example",
      },
    };
    const parsed = parseIntelligentUiText(
      "```intelligent-ui\n" + JSON.stringify(chart) + "\n```",
      { final: true },
    )[0];
    if (parsed?.type !== "intelligent_ui") throw Error();
    expect(parsed.block.status).toBe("ready");
    expect(
      projectUiBlock(parsed.block, { purpose: "static-original" }),
    ).toContain("Quarter");
    expect(
      projectUiBlock(parsed.block, { purpose: "static-original" }),
    ).toContain("184");
    parsed.block.state = { chartId: "chart", filter: "not-in-this-data" };
    expect(
      projectUiBlock(parsed.block, { purpose: "static-current" }),
    ).not.toContain("184");
    expect(
      projectUiBlock(parsed.block, { purpose: "static-original" }),
    ).toContain("184");
    parsed.block.state = { secret: "DO NOT SHARE" };
    expect(
      projectUiBlock(parsed.block, { purpose: "static-current" }),
    ).not.toContain("DO NOT SHARE");
  });
  it("clones initial interactive state rather than sharing branch references", () => {
    const parsed = parseIntelligentUiText(fence)[0];
    if (parsed?.type !== "intelligent_ui") throw Error();
    const builder = createMessageOutputBlockBuilder({
      initialBlocks: [parsed.block],
    });
    const copy = builder.getBlocks()[0];
    if (copy?.type !== "intelligent_ui") throw Error();
    copy.state.checked = ["a"];
    expect(builder.getBlocks()[0]).toMatchObject({ state: { checked: [] } });
  });
  it("does not execute a closing-fence prefix until its line ends or the stream finalizes", () => {
    const candidate = fence.trimEnd();
    const preview = parseIntelligentUiText(candidate)[0];
    expect(preview).toMatchObject({ block: { status: "receiving" } });
    expect(parseIntelligentUiText(candidate + "not-a-fence")[0]).toMatchObject({
      block: { status: "receiving" },
    });
    expect(parseIntelligentUiText(candidate + "\n")[0]).toMatchObject({
      block: { status: "ready" },
    });
    expect(parseIntelligentUiText(candidate, { final: true })[0]).toMatchObject(
      { block: { status: "ready" } },
    );
    const builder = createMessageOutputBlockBuilder({
      enableIntelligentUi: true,
    });
    builder.appendText(candidate);
    expect(builder.finalizeIntelligentUi()).toBe(true);
    expect(builder.getBlocks()[0]).toMatchObject({ status: "ready" });
  });
  it("preserves readable future-version metadata without disclosing its source", () => {
    const unknown = fence.replace('"version":1', '"version":2');
    expect(projectUiText(unknown, { purpose: "static-original" })).toContain(
      "Prepare",
    );
    expect(projectUiText(unknown, { purpose: "static-original" })).toContain(
      "Tasks",
    );
    expect(
      projectUiText(unknown, { purpose: "static-original" }),
    ).not.toContain('"props"');
  });
  it("seals completed EOF fences across later tool rounds", () => {
    const builder = createMessageOutputBlockBuilder({
      enableIntelligentUi: true,
    });
    builder.appendText(
      '```intelligent-ui\n{"version":1,"title":"One","summary":"First"}\n<div>Ready</div>\n```',
    );
    builder.finalizeIntelligentUi();
    const first = builder.getBlocks()[0];
    expect(first).toMatchObject({ status: "ready" });
    builder.appendToolCall({
      id: "tool",
      name: "lookup",
      args: {},
      status: "pending",
    });
    builder.appendText(
      'Later text\n```intelligent-ui\n{"version":1,"title":"Two","summary":"Second"}\n<div>Pending',
    );
    expect(builder.getBlocks()[0]).toEqual(first);
    expect(builder.getBlocks().at(-1)).toMatchObject({ status: "preview" });
    builder.finalizeIntelligentUi(true);
    expect(builder.getBlocks()[0]).toEqual(first);
    expect(builder.getBlocks().at(-1)).toMatchObject({ status: "cancelled" });
  });
  it("does not reopen an interrupted block when text resumes without an activity boundary", () => {
    const builder = createMessageOutputBlockBuilder({
      enableIntelligentUi: true,
    });
    builder.appendText("```intelligent-ui\n{");
    builder.finalizeIntelligentUi(true);
    const cancelled = builder.getBlocks()[0];
    builder.appendText(fence);
    expect(builder.getBlocks()[0]).toEqual(cancelled);
    expect(builder.getBlocks().at(-1)).toMatchObject({ status: "ready" });
    builder.finalizeIntelligentUi();
    expect(builder.getBlocks()[0]).toEqual(cancelled);
  });
  it("releases and seals an unfinished protocol prefix at round completion", () => {
    const builder = createMessageOutputBlockBuilder({
      enableIntelligentUi: true,
    });
    builder.appendText("```intelligent-");
    expect(builder.getBlocks()).toEqual([]);
    expect(builder.finalizeIntelligentUi()).toBe(true);
    expect(builder.getBlocks()[0]).toMatchObject({
      type: "text",
      content: "```intelligent-",
    });
    builder.appendText("ui\n" + JSON.stringify(definition) + "\n```\n");
    expect(builder.getBlocks().every((block) => block.type === "text")).toBe(
      true,
    );
  });
});
