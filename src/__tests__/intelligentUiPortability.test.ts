import { describe, expect, it } from "vitest";
import type { Message, Session, ToolCall } from "@/types";
import { parseIntelligentUiText } from "@/lib/intelligentUi/parser";
import {
  prepareMessageUiForStatic,
  projectMessageUi,
} from "@/lib/chat/intelligentUiPortability";
import { EXPLORER_TRAVEL_EXAMPLE } from "@/lib/intelligentUi/explorer/example";
import { captureToolResultView } from "@/lib/intelligentUi/toolResults/adapters";
import { prepareSessionShare } from "@/services/sharing/snapshot";

const session: Session = {
  id: "s",
  title: "UI",
  model: "test",
  messageCount: 1,
  updatedAt: 1,
};
function fixture() {
  const content =
    "```intelligent-ui\n" +
    JSON.stringify({
      version: 1,
      kind: "form",
      title: "Learning",
      summary: "Plan",
      props: { fields: [{ id: "goal", label: "Goal", type: "text" }] },
    }) +
    "\n```";
  const segment = parseIntelligentUiText(content, { final: true })[0]!;
  if (segment.type !== "intelligent_ui") throw new Error("Missing UI");
  segment.block.state = {
    values: { goal: "PRIVATE_GOAL" },
    hidden: "HIDDEN_SECRET",
  };
  segment.block.staticSnapshot = "UNTRUSTED_SNAPSHOT";
  const message: Message = {
    id: "m",
    role: "model",
    content,
    timestamp: 1,
    outputBlocks: [segment.block],
  };
  return { message, block: segment.block };
}

describe("intelligent UI portability", () => {
  it("exports original static content without private state or protocol source", () => {
    const { message } = fixture();
    const text = projectMessageUi(message, { purpose: "static-original" });
    expect(text).toContain("Goal");
    expect(text).not.toMatch(/PRIVATE|HIDDEN|UNTRUSTED|intelligent-ui/);
    expect(
      projectMessageUi(
        { ...message, outputBlocks: undefined },
        { purpose: "static-original" },
      ),
    ).toBe(text);
  });
  it("includes only known visible fields when explicitly requested", async () => {
    const { message } = fixture();
    const original = structuredClone(message);
    const shared = await prepareSessionShare({ session, messages: [message] });
    expect(JSON.stringify(shared)).not.toMatch(
      /PRIVATE|HIDDEN|UNTRUSTED|intelligent-ui/,
    );
    const selected = await prepareSessionShare({
      session,
      messages: [message],
      includeIntelligentUiState: true,
    });
    expect(JSON.stringify(selected)).toContain("PRIVATE");
    expect(JSON.stringify(selected)).not.toMatch(/HIDDEN|UNTRUSTED/);
    expect(selected.snapshot.messages[0]?.blocks[0]?.type).toBe("text");
    expect(message).toEqual(original);
  });
  it("never exports executable HTML or script source", async () => {
    const content =
      '```intelligent-ui\n{"version":1,"title":"Demo","summary":"Static explanation"}\n<script>window.SECRET_SOURCE=1</script><input value="private">\n```';
    const message: Message = {
      id: "html",
      role: "model",
      content,
      timestamp: 1,
    };
    const result = await prepareSessionShare({ session, messages: [message] });
    expect(JSON.stringify(result)).toContain("Static explanation");
    expect(JSON.stringify(result)).not.toMatch(
      /SECRET_SOURCE|<script|<input|intelligent-ui/,
    );
  });
  it("keeps user code examples literal", () => {
    const { message } = fixture();
    expect(
      projectMessageUi(
        { ...message, role: "user" },
        { purpose: "static-original" },
      ),
    ).toBe(message.content);
  });
});

it("preserves example provenance in original and current projections", () => {
  const content =
    "```intelligent-ui\n" +
    JSON.stringify({
      version: 1,
      kind: "comparison",
      title: "Choices",
      summary: "Compare",
      props: {
        columns: [{ key: "cost", label: "Cost" }],
        items: [{ id: "a", label: "A", values: { cost: 12 } }],
        provenance: "example",
      },
    }) +
    "\n```";
  const message: Message = { id: "p", role: "model", content, timestamp: 1 };
  expect(projectMessageUi(message, { purpose: "static-original" })).toContain(
    "Illustrative example data",
  );
});

it("prepares a public static export without mutating imported explorer data", async () => {
  const content =
    "```intelligent-ui\n" + JSON.stringify(EXPLORER_TRAVEL_EXAMPLE) + "\n```";
  const segment = parseIntelligentUiText(content, { final: true })[0]!;
  if (segment.type !== "intelligent_ui") throw new Error("Missing UI");
  const sourceDataset = EXPLORER_TRAVEL_EXAMPLE.props.dataset;
  if (sourceDataset.kind !== "inline") throw new Error("Missing fixture data");
  const imported = {
    ...sourceDataset.data,
    id: "private-import",
    version: "local-1",
    rows: [
      {
        id: "private",
        values: { name: "PRIVATE_ROW", transport: 1, hotel: 1, rating: 1 },
      },
    ],
  };
  segment.block.dataSnapshot = imported;
  segment.block.state = {
    parameters: { nights: 1, people: 1, budget: 100 },
    selected: ["private"],
  };
  const message: Message = {
    id: "explorer-export",
    role: "model",
    content,
    timestamp: 1,
    outputBlocks: [segment.block],
  };
  const original = await prepareMessageUiForStatic(message, undefined, {
    purpose: "static-original",
  });
  const current = await prepareMessageUiForStatic(message, undefined, {
    purpose: "static-current",
  });
  const originalText = original.outputBlocks?.[0];
  const currentText = current.outputBlocks?.[0];
  expect(originalText?.type).toBe("text");
  expect(currentText?.type).toBe("text");
  expect(
    originalText && originalText.type === "text" ? originalText.content : "",
  ).not.toContain("PRIVATE_ROW");
  expect(
    originalText && originalText.type === "text" ? originalText.content : "",
  ).toContain("Illustrative example data");
  expect(
    currentText && currentText.type === "text" ? currentText.content : "",
  ).toContain("PRIVATE\\_ROW");
  expect(
    currentText && currentText.type === "text" ? currentText.content : "",
  ).toContain("Data supplied by you");
  expect(message.outputBlocks?.[0]?.type).toBe("intelligent_ui");
});

it("converts adapted tool results to safe static text without exporting metadata", async () => {
  const call: ToolCall = {
    id: "search-call",
    name: "web_search",
    args: {},
    status: "success",
    executionRecordId: "execution-1",
    result: {
      ok: true,
      trust: "external_untrusted",
      provenance: { origin: "builtin", toolName: "web_search" },
      data: {
        sources: [
          {
            title: "Safe result",
            url: "https://example.com/result",
            snippet: "<script>private()</script>",
          },
        ],
      },
    },
  };
  call.intelligentUiResult = await captureToolResultView({
    callId: call.id,
    toolName: call.name,
    executionId: call.executionRecordId,
    retrievedAt: 1,
    result: call.result,
  });
  const message: Message = {
    id: "tool-export",
    role: "model",
    content: "",
    timestamp: 1,
    toolCalls: [call],
    outputBlocks: [{ id: "tools", type: "tool_group", toolCalls: [call] }],
  };
  const { createMessageSourceContext } =
    await import("@/lib/intelligentUi/sources/adapters");
  const context = await createMessageSourceContext({
    sessionId: "session",
    messages: [message],
    canAccessTool: () => true,
  });
  const denied = await prepareMessageUiForStatic(message, undefined, {
    purpose: "static-original",
  });
  expect(denied.outputBlocks).toEqual([]);
  const prepared = await prepareMessageUiForStatic(message, undefined, {
    purpose: "static-original",
    sourceScope: {
      load: async () => context,
      assertValid: async () => undefined,
    },
  });
  const output = prepared.outputBlocks?.[0];
  expect(output?.type).toBe("text");
  expect(output && output.type === "text" ? output.content : "").toContain(
    "Safe result",
  );
  expect(output && output.type === "text" ? output.content : "").toContain(
    "&lt;script&gt;",
  );
  expect(JSON.stringify(prepared)).not.toContain("intelligentUiResult");
});

it("localizes all static provenance and preserves declared references without certifying them", () => {
  const content =
    "```intelligent-ui\n" +
    JSON.stringify({
      version: 1,
      kind: "comparison",
      title: "Options",
      summary: "Compare",
      props: {
        columns: [{ key: "price", label: "Price" }],
        items: [
          { id: "a", label: "Alpha", values: { price: 10 } },
          { id: "b", label: "Beta", values: { price: 20 } },
        ],
        provenance: "example",
      },
    }) +
    "\n```";
  const part = parseIntelligentUiText(content, { final: true })[0]!;
  if (part.type !== "intelligent_ui") throw new Error("Missing UI");
  part.block.state = {
    selected: ["a", "SECRET"],
    filter: "Alpha",
    hidden: "PRIVATE",
  };
  part.block.sourceRefs = ["report-1"];
  const message: Message = {
    id: "m",
    role: "model",
    content,
    timestamp: 1,
    outputBlocks: [part.block],
  };
  for (const [locale, label, selected] of [
    ["en", "Illustrative example data", "Selected"],
    ["zh", "示例数据", "已选择"],
    ["ja", "例示用のデータ", "選択済み"],
  ]) {
    const projected = projectMessageUi(message, {
      purpose: "static-current",
      locale,
    });
    expect(projected).toContain(label);
    expect(projected).toContain(selected);
    expect(projected).toContain("report-1");
    expect(projected).not.toMatch(/SECRET|PRIVATE|Beta/);
    expect(
      projectMessageUi(message, { purpose: "model-history", locale }),
    ).toContain("Beta");
  }
});

it("editing includes only the definition, never private state or cached snapshots", () => {
  const { message } = fixture();
  const text = projectMessageUi(message, {
    purpose: "compose-edit",
    locale: "zh",
  });
  expect(text).toContain("intelligent-ui");
  expect(text).toContain('"goal"');
  expect(text).not.toMatch(/PRIVATE|HIDDEN|UNTRUSTED/);
});

it("localizes invalid protocol fallback even when a legacy message stored English", () => {
  const { message, block } = fixture();
  block.definition = null;
  block.fallbackMarkdown = "Interactive content unavailable.";
  expect(
    projectMessageUi(message, { purpose: "static-original", locale: "zh" }),
  ).not.toContain("Interactive content");
});

it("projects flashcard progress only with opt-in", () => {
  const content =
    "```intelligent-ui\n" +
    JSON.stringify({
      version: 1,
      kind: "flashcards",
      title: "Cards",
      summary: "Review",
      props: { cards: [{ id: "c", front: "Question", back: "Answer" }] },
    }) +
    "\n```";
  const segment = parseIntelligentUiText(content, { final: true })[0]!;
  if (segment.type !== "intelligent_ui") throw new Error("Missing UI");
  segment.block.state = {
    currentId: "c",
    revealed: true,
    review: "all",
    ratings: { c: "known", unknown: "PRIVATE" },
  };
  const message: Message = {
    id: "f",
    role: "model",
    content,
    timestamp: 1,
    outputBlocks: [segment.block],
  };
  expect(
    projectMessageUi(message, { purpose: "static-original", locale: "zh" }),
  ).not.toContain("已掌握");
  const current = projectMessageUi(message, {
    purpose: "compose-result",
    locale: "zh",
  });
  expect(current).toContain("已掌握");
  expect(current).not.toContain("PRIVATE");
});

it("uses shared recent quiz results and does not reveal explanations during retry", () => {
  const content =
    "```intelligent-ui\n" +
    JSON.stringify({
      version: 1,
      kind: "quiz",
      title: "Quiz",
      summary: "Practice",
      props: {
        questions: [
          {
            id: "q",
            prompt: "Question",
            options: [
              { id: "a", label: "Correct" },
              { id: "b", label: "Wrong" },
            ],
            answerIds: ["a"],
            explanation: "SECRET_EXPLANATION",
          },
        ],
      },
    }) +
    "\n```";
  const segment = parseIntelligentUiText(content, { final: true })[0]!;
  if (segment.type !== "intelligent_ui") throw new Error("Missing UI");
  segment.block.state = {
    questionIds: ["q"],
    answers: { q: ["a"] },
    submitted: false,
    latestAnswers: { q: ["b"] },
  };
  const message: Message = {
    id: "q",
    role: "model",
    content,
    timestamp: 1,
    outputBlocks: [segment.block],
  };
  const current = projectMessageUi(message, {
    purpose: "static-current",
    locale: "en",
  });
  expect(current).toContain("Correct");
  expect(current).toContain("Latest overall score: 0 / 1");
  expect(current).not.toContain("SECRET_EXPLANATION");
});

it("preserves escaped block references in edit drafts and unavailable definitions", () => {
  const { message, block } = fixture();
  block.sourceRefs = ["report-1", "[source](javascript:alert)"];
  for (const purpose of ["compose-edit", "static-original"] as const) {
    if (purpose === "static-original") block.definition = null;
    const result = projectMessageUi(message, { purpose, locale: "zh" });
    expect(result).toContain("来源");
    expect(result).toContain("report-1");
    expect(result).toContain("\\[source\\]\\(javascript:alert\\)");
    expect(result).not.toMatch(/PRIVATE|HIDDEN|UNTRUSTED/);
  }
});
