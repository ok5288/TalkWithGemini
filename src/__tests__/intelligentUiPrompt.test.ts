// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { CHART_PROMPT_EXAMPLE } from "@/lib/chat/diagramPrompt";
import { buildIntelligentUiPromptInstruction } from "@/lib/intelligentUi/prompt";
import {
  INTELLIGENT_UI_CHECKLIST_EXAMPLE,
  formatHtmlPromptExample,
} from "@/lib/intelligentUi/promptExamples";
import { parseIntelligentUiText } from "@/lib/intelligentUi/parser";
import { prepareIntelligentHtml } from "@/lib/intelligentUi/htmlPolicy";
import { nativeCapabilities } from "@/lib/intelligentUi/catalog";
import { EXPLORER_TRAVEL_EXAMPLE } from "@/lib/intelligentUi/explorer/example";

const cases = [
  EXPLORER_TRAVEL_EXAMPLE,
  INTELLIGENT_UI_CHECKLIST_EXAMPLE,
  {
    kind: "comparison",
    props: {
      columns: [{ key: "price", label: "Price" }],
      items: [{ id: "a", label: "Plan A", values: { price: 10 } }],
      provenance: "example",
    },
  },
  {
    kind: "form",
    props: {
      fields: [
        { id: "goal", label: "Goal", type: "text", required: true },
        {
          id: "hours",
          label: "Hours",
          type: "number",
          min: 1,
          defaultValue: 2,
        },
      ],
    },
  },
  {
    kind: "chart",
    props: {
      charts: [{ id: "sales", label: "Sales", source: CHART_PROMPT_EXAMPLE }],
      provenance: "example",
    },
  },
  {
    kind: "quiz",
    props: {
      questions: [
        {
          id: "one",
          prompt: "2 + 2?",
          options: [
            { id: "a", label: "4" },
            { id: "b", label: "5" },
          ],
          answerIds: ["a"],
          explanation: "Two pairs make four.",
        },
      ],
    },
  },
  {
    kind: "calculator",
    props: {
      operation: "scale",
      inputs: [
        { id: "amount", label: "Amount", value: 100 },
        { id: "original", label: "Original portions", value: 10 },
        { id: "target", label: "Target portions", value: 20 },
      ],
    },
  },
  {
    kind: "flashcards",
    props: { cards: [{ id: "square", front: "What is $3^2$?", back: "$9$" }] },
  },
];

describe("Intelligent UI generation contract fixtures", () => {
  it.each(cases)(
    "accepts a complete $kind fixture through the real parser",
    (fixture) => {
      const definition = {
        version: 1,
        title: "Example",
        summary: "Illustrative exercise.",
        ...fixture,
      };
      const result = parseIntelligentUiText(
        "```intelligent-ui\n" + JSON.stringify(definition) + "\n```",
        { final: true },
      );
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        block: { status: "ready", definition: { kind: fixture.kind } },
      });
    },
  );

  it("covers the entire compile-time catalog", () => {
    expect(cases.map((item) => item.kind).sort()).toEqual(
      Object.keys(nativeCapabilities).sort(),
    );
  });

  it("validates every complete example embedded in the actual prompt", () => {
    const blocks = parseIntelligentUiText(
      buildIntelligentUiPromptInstruction(),
      { final: true },
    ).filter((segment) => segment.type === "intelligent_ui");
    expect(blocks).toHaveLength(4);
    expect(
      blocks.some(
        ({ block }) =>
          block.definition &&
          "kind" in block.definition &&
          block.definition.kind === "explorer" &&
          block.definition.version === 2,
      ),
    ).toBe(true);
    for (const { block } of blocks) {
      expect(block.status).toBe("ready");
      if (block.definition && "html" in block.definition) {
        const prepared = prepareIntelligentHtml(block.definition.html, true);
        expect(prepared.html).toContain('<form id="portions-form">');
        expect(prepared.scripts).toHaveLength(1);
        expect(prepared.scripts[0]?.source).toContain(
          'addEventListener("submit"',
        );
        expect(prepared.scripts[0]?.source).toContain(
          'addEventListener("reset"',
        );
        expect(prepared.scripts[0]?.source).toContain(
          "window.intelligentUi.sendMessage(",
        );
        expect(prepared.html).toContain("data-neo-ai-action");
      }
    }
  });

  it("keeps prose and quoted protocol examples literal", () => {
    const prose = "The answer is four. No interaction is needed.";
    expect(parseIntelligentUiText(prose, { final: true })).toEqual([
      { type: "text", content: prose, offset: 0 },
    ]);
    const quoted = "````markdown\n" + formatHtmlPromptExample() + "\n````";
    expect(
      parseIntelligentUiText(quoted, { final: true }).every(
        (segment) => segment.type === "text",
      ),
    ).toBe(true);
  });
});
