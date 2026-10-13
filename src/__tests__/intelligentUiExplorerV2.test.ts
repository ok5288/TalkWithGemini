import { describe, expect, it } from "vitest";
import {
  parseNativeDefinition,
  normalizeIntelligentUiBlock,
} from "@/lib/intelligentUi/schema";
import { parseIntelligentUiText } from "@/lib/intelligentUi/parser";
import {
  deriveExplorer,
  deriveExplorerDisplay,
  EXPLORER_TRAVEL_V2_EXAMPLE,
  EXPLORER_TRAVEL_EXAMPLE,
  initialExplorer,
} from "@/lib/intelligentUi/explorer";
import { projectUiBlock } from "@/lib/intelligentUi/projection";
import { hasUnsupportedUiContent } from "@/lib/intelligentUi/compatibility";
import { recoverKnownExplorerV2InAppData } from "@/lib/intelligentUi/recovery";
import type { IntelligentUiBlock } from "@/lib/intelligentUi/types";

function block(): IntelligentUiBlock {
  const d = structuredClone(EXPLORER_TRAVEL_V2_EXAMPLE);
  return {
    id: "original",
    type: "intelligent_ui",
    schemaVersion: 1,
    renderer: "native",
    definition: d,
    definitionRevision: 3,
    status: "ready",
    fallbackMarkdown: d.summary,
    state: {
      ...initialExplorer(d),
      selected: ["b"],
      parameters: { nights: 3, people: 4, budget: 900 },
    },
    stateRevision: 7,
    staticSnapshot: "",
    sourceRefs: [],
  };
}
function quarantine(payload: unknown) {
  return {
    ...block(),
    id: "current-wrapper",
    definition: null,
    state: {},
    stateRevision: 0,
    definitionRevision: 3,
    status: "failed",
    unsupportedPayload: JSON.stringify(payload),
    diagnostic: { code: "unsupported_version" },
  };
}

describe("Explorer v2 definitions and display", () => {
  it("accepts v1 and v2 through catalog and protocol without changing envelope", () => {
    expect(parseNativeDefinition(EXPLORER_TRAVEL_EXAMPLE)?.version).toBe(1);
    expect(parseNativeDefinition(EXPLORER_TRAVEL_V2_EXAMPLE)?.version).toBe(2);
    const [segment] = parseIntelligentUiText(
      "```intelligent-ui\n" +
        JSON.stringify(EXPLORER_TRAVEL_V2_EXAMPLE) +
        "\n```",
      { final: true },
    );
    expect(segment).toMatchObject({
      block: { schemaVersion: 1, status: "ready", definition: { version: 2 } },
    });
    expect(hasUnsupportedUiContent(block())).toBe(false);
  });
  it.each([
    "table",
    "parameters",
    "duplicate",
    "axis",
    "metrics",
    "topchart",
    "nestedtypo",
    "tooMany",
  ])("rejects invalid %s", (kind) => {
    const d = structuredClone(EXPLORER_TRAVEL_V2_EXAMPLE);
    if (kind === "table" || kind === "parameters")
      d.props.sections = d.props.sections.filter((s) => s.kind !== kind);
    if (kind === "duplicate") d.props.sections.push(d.props.sections[2]);
    if (kind === "axis")
      d.props.sections[2] = {
        kind: "chart",
        id: "bad",
        title: "Bad",
        type: "scatter",
        x: "name",
        y: "total",
      };
    if (kind === "metrics")
      d.props.sections[1] = { kind: "metrics", nodes: ["total"] };
    if (kind === "topchart")
      Object.assign(d.props, { chart: { type: "bar", x: "name", y: "total" } });
    if (kind === "nestedtypo")
      Object.assign(d.props.parameters[0], { vlaue: 5 });
    if (kind === "tooMany")
      d.props.sections.push(
        ...[1, 2, 3].map((n) => ({
          kind: "chart" as const,
          id: `c${n}`,
          title: "Cost",
          type: "bar" as const,
          x: "name",
          y: "total",
        })),
      );
    expect(parseNativeDefinition(d)).toBeNull();
  });
  it("revalidates context axes against the resolved dataset", () => {
    const d = structuredClone(EXPLORER_TRAVEL_V2_EXAMPLE);
    const data = EXPLORER_TRAVEL_EXAMPLE.props.dataset;
    if (data.kind !== "inline") throw Error("fixture");
    d.props.dataset = { kind: "context", alias: "travel", version: "1" };
    d.props.sections[2] = {
      kind: "chart",
      id: "invalid",
      title: "Invalid",
      type: "scatter",
      x: "name",
      y: "total",
    };
    expect(parseNativeDefinition(d)).not.toBeNull();
    expect(deriveExplorer(d, {}, data.data).errors).toContainEqual({
      code: "invalid_chart_type",
    });
  });
  it("uses each chart's filtered point mapping while selection leaves all rows visible", () => {
    const d = structuredClone(EXPLORER_TRAVEL_V2_EXAMPLE);
    if (d.props.dataset.kind !== "inline") throw Error("fixture");
    d.props.dataset.data.rows[0].values.rating = null;
    d.props.sections[3] = {
      kind: "chart",
      id: "rating",
      title: "Rating",
      type: "scatter",
      x: "rating",
      y: "total",
    };
    const result = deriveExplorer(d, {
      ...initialExplorer(d),
      selected: ["b"],
      sortKey: "total",
      descending: true,
    });
    const display = deriveExplorerDisplay(d, result);
    expect(result.rows.map((r) => r.id)).toEqual(["a", "b"]);
    expect(display.charts[0].rows.map((r) => r.id)).toEqual(["a", "b"]);
    expect(display.charts[1].rows.map((r) => r.id)).toEqual(["b"]);
    expect(result.metrics.selectedTotal).toBe(340);
    expect(
      deriveExplorer(d, {
        ...result.state,
        parameters: { ...result.state.parameters, people: 4 },
      }).rows[0].values.perPerson,
    ).toBe(125);
  });
  it("static current charts respect selected rows and visible columns; original excludes imports", () => {
    const b = block();
    b.state = { ...b.state, visibleColumns: ["name", "total"] };
    const current = projectUiBlock(b, {
      purpose: "static-current",
      locale: "en",
    });
    expect(current).toContain("Total by option");
    expect(current).not.toContain("Cost per person");
    expect(current).not.toContain("| A |");
    expect(current).toContain("| B |");
    const d = b.definition!;
    if (
      !("kind" in d) ||
      d.kind !== "explorer" ||
      d.props.dataset.kind !== "inline"
    )
      throw Error("fixture");
    b.dataSnapshot = structuredClone(d.props.dataset.data);
    b.dataSnapshot.rows[0].values.name = "PRIVATE_IMPORT";
    expect(
      projectUiBlock(b, { purpose: "static-original", locale: "en" }),
    ).not.toContain("PRIVATE_IMPORT");
  });
});

describe("Explorer v2 quarantine recovery", () => {
  it("restores full private JSON and imports under current wrapper identity with unverified bindings", () => {
    const original = block();
    if (EXPLORER_TRAVEL_EXAMPLE.props.dataset.kind !== "inline")
      throw Error("fixture");
    original.dataSnapshot = structuredClone(
      EXPLORER_TRAVEL_EXAMPLE.props.dataset.data,
    );
    original.sourceBindings = [
      {
        bindingId: "a:1",
        bindingStatus: "resolved",
        alias: "source-0123456789abcdef",
        version: "1",
        kind: "attachment",
        sourceRef: "m",
        contentHash: "a".repeat(64),
      },
    ];
    const restored = normalizeIntelligentUiBlock(
      JSON.parse(JSON.stringify(quarantine(original))),
    )!;
    expect(restored.unsupportedPayload).toBeUndefined();
    expect(restored.diagnostic).toBeUndefined();
    expect(restored.id).toBe("current-wrapper");
    expect(restored.state).toEqual(original.state);
    expect(restored.stateRevision).toBe(7);
    expect(restored.dataSnapshot).toEqual(original.dataSnapshot);
    expect(restored.definition?.version).toBe(2);
    expect(restored.sourceBindings).toHaveLength(1);
    expect(
      restored.sourceBindings?.every((b) => b.bindingStatus === "unverified"),
    ).toBe(true);
  });
  it("restores definition-only parser quarantine with initial state", () => {
    const restored = normalizeIntelligentUiBlock(
      quarantine(EXPLORER_TRAVEL_V2_EXAMPLE),
    )!;
    expect(restored.status).toBe("ready");
    expect(restored.state).toEqual(initialExplorer(EXPLORER_TRAVEL_V2_EXAMPLE));
  });
  it("retains unresolved context selection until live data can normalize it", () => {
    const original = block();
    if (
      !original.definition ||
      !("kind" in original.definition) ||
      original.definition.kind !== "explorer"
    )
      throw Error("fixture");
    original.definition.props.dataset = {
      kind: "context",
      alias: "travel",
      version: "1",
    };
    expect(
      normalizeIntelligentUiBlock(quarantine(original))?.state.selected,
    ).toEqual(["b"]);
  });
  it.each(["unknown", "nested", "malformed", "spoof"])(
    "does not reopen %s",
    (kind) => {
      const payload = block();
      if (kind === "unknown")
        Object.assign(payload.definition!, { version: 3 });
      if (kind === "nested")
        payload.unsupportedPayload = JSON.stringify(block());
      const wrapper = quarantine(payload);
      if (kind === "malformed") wrapper.unsupportedPayload = "{broken";
      if (kind === "spoof")
        Object.assign(wrapper, { state: { selected: ["a"] } });
      const restored = normalizeIntelligentUiBlock(wrapper)!;
      expect(restored.definition).toBeNull();
      expect(hasUnsupportedUiContent(restored)).toBe(true);
    },
  );
  it("recovers only session message blocks without mutating the private capture", () => {
    const wrapper = quarantine(block());
    const input = {
      settings: { wrapper },
      sessionMessages: {
        unopened: {
          nodesById: { message: { message: { outputBlocks: [wrapper] } } },
        },
      },
    };
    const recovered = recoverKnownExplorerV2InAppData(input);
    expect(hasUnsupportedUiContent(recovered.sessionMessages)).toBe(false);
    expect(
      input.sessionMessages.unopened.nodesById.message.message.outputBlocks[0]
        .unsupportedPayload,
    ).toBeDefined();
    expect(recovered.settings).toBe(input.settings);
  });
});

it("keeps deeply nested private payloads inert without recursive overflow or truncated restoration", () => {
  const payload = block();
  let nested: unknown = "deep";
  for (let i = 0; i < 1000; i++) nested = { nested };
  Object.assign(payload.state, { nested });
  const wrapper = quarantine(payload);
  expect(() => normalizeIntelligentUiBlock(wrapper)).not.toThrow();
  expect(normalizeIntelligentUiBlock(wrapper)?.unsupportedPayload).toBe(
    wrapper.unsupportedPayload,
  );
});

it("recovers only real message UI blocks and preserves identical objects in tool results", () => {
  const wrapper = quarantine(block());
  const toolResult = { result: wrapper };
  const message = {
    outputBlocks: [wrapper, { type: "tool_group", toolCalls: [toolResult] }],
    toolCalls: [toolResult],
  };
  const tree = {
    rootMessageIds: ["m"],
    nodesById: { m: { id: "m", message, childMessageIds: [] } },
  };
  const data = recoverKnownExplorerV2InAppData({
    sessionMessages: { s: JSON.stringify(tree) },
  });
  const recovered = data.sessionMessages.s as unknown as typeof tree;
  expect(recovered.nodesById.m.message.outputBlocks[0]).toMatchObject({
    definition: { version: 2 },
  });
  expect(recovered.nodesById.m.message.toolCalls).toEqual(message.toolCalls);
  expect(recovered.nodesById.m.message.outputBlocks[1]).toEqual(
    message.outputBlocks[1],
  );
});

it("does not confuse a valid dataset column named unsupportedPayload with nested quarantine", () => {
  const payload = block();
  const d = payload.definition;
  if (
    !d ||
    !("kind" in d) ||
    d.kind !== "explorer" ||
    d.props.dataset.kind !== "inline"
  )
    throw Error("fixture");
  d.props.dataset.data.columns.push({
    id: "unsupportedPayload",
    label: "Note",
    type: "text",
  });
  d.props.dataset.data.rows.forEach((row) => {
    row.values.unsupportedPayload = "normal cell";
  });
  expect(
    normalizeIntelligentUiBlock(quarantine(payload))?.definition?.version,
  ).toBe(2);
});
