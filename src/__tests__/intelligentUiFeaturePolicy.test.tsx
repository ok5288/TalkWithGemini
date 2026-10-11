// @vitest-environment jsdom
import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { isExplorerEnabled } from "@/lib/intelligentUi/featurePolicy";
import {
  getNativePromptInstructions,
  nativeDefinitionSchema,
} from "@/lib/intelligentUi/catalog";
import { buildIntelligentUiPromptInstruction } from "@/lib/intelligentUi/prompt";
import { parseIntelligentUiText } from "@/lib/intelligentUi/parser";
import { EXPLORER_TRAVEL_EXAMPLE } from "@/lib/intelligentUi/explorer";
import IntelligentUiCard from "@/components/content/intelligentUi/IntelligentUiCard";
import type { IntelligentUiBlock, JsonObject } from "@/lib/intelligentUi/types";
import messages from "@/i18n/locales/en/IntelligentUi.json";
const adapter = vi.hoisted(() => ({
  onChange: undefined as undefined | ((state: JsonObject) => void),
  onImport: undefined as undefined | ((data: null) => void),
}));
vi.mock("@/components/content/intelligentUi/NativeUi", () => ({
  default: (props: {
    onChange: (state: JsonObject) => void;
    onImportDataset?: (data: null) => void;
  }) => {
    adapter.onChange = props.onChange;
    adapter.onImport = props.onImportDataset;
    return <div data-testid="native-adapter" />;
  },
}));
vi.mock("next/dynamic", () => ({ default: () => () => null }));
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});
const block: IntelligentUiBlock = {
  id: "explorer",
  type: "intelligent_ui",
  schemaVersion: 1,
  renderer: "native",
  definition: EXPLORER_TRAVEL_EXAMPLE,
  definitionRevision: 1,
  status: "ready",
  fallbackMarkdown: "Travel",
  state: {},
  stateRevision: 0,
  staticSnapshot: "",
  sourceRefs: [],
};
it("defaults on and keeps all three validated prompt examples", () => {
  vi.stubEnv("NEXT_PUBLIC_ENABLE_INTELLIGENT_UI_EXPLORER", undefined);
  expect(isExplorerEnabled()).toBe(true);
  expect(
    parseIntelligentUiText(buildIntelligentUiPromptInstruction(), {
      final: true,
    }).filter((s) => s.type === "intelligent_ui"),
  ).toHaveLength(3);
});
it("removes explorer instructions and examples without removing schema compatibility", () => {
  vi.stubEnv("NEXT_PUBLIC_ENABLE_INTELLIGENT_UI_EXPLORER", "false");
  expect(isExplorerEnabled()).toBe(false);
  expect(
    getNativePromptInstructions().some((p) => p.startsWith("explorer:")),
  ).toBe(false);
  const blocks = parseIntelligentUiText(buildIntelligentUiPromptInstruction(), {
    final: true,
  }).filter((s) => s.type === "intelligent_ui");
  expect(blocks).toHaveLength(2);
  expect(buildIntelligentUiPromptInstruction()).toContain(
    "Do not emit explorer blocks",
  );
  expect(
    nativeDefinitionSchema.safeParse(EXPLORER_TRAVEL_EXAMPLE).success,
  ).toBe(true);
});
it("renders disabled explorers as static and rejects stale state/import callbacks", () => {
  const change = vi.fn(),
    importData = vi.fn();
  const content = () => (
    <NextIntlClientProvider locale="en" messages={{ IntelligentUi: messages }}>
      <IntelligentUiCard
        block={block}
        enabled
        onStateChange={change}
        onImportDataset={importData}
      />
    </NextIntlClientProvider>
  );
  const view = render(content());
  expect(screen.queryByTestId("native-adapter")).toBeTruthy();
  const oldChange = adapter.onChange!,
    oldImport = adapter.onImport!;
  vi.stubEnv("NEXT_PUBLIC_ENABLE_INTELLIGENT_UI_EXPLORER", "false");
  view.rerender(content());
  expect(screen.queryByTestId("native-adapter")).toBeNull();
  expect(screen.queryByRole("button", { name: "Reset" })).toBeNull();
  oldChange({ selected: ["b"] });
  oldImport(null);
  expect(change).not.toHaveBeenCalled();
  expect(importData).not.toHaveBeenCalled();
});
it("keeps other native kinds interactive when explorer is off", () => {
  vi.stubEnv("NEXT_PUBLIC_ENABLE_INTELLIGENT_UI_EXPLORER", "false");
  render(
    <NextIntlClientProvider locale="en" messages={{ IntelligentUi: messages }}>
      <IntelligentUiCard
        block={{
          ...block,
          definition: {
            version: 1,
            kind: "checklist",
            title: "List",
            summary: "List",
            props: { items: [{ id: "one", label: "One" }] },
          },
        }}
        enabled
        onStateChange={vi.fn()}
      />
    </NextIntlClientProvider>,
  );
  expect(screen.queryByTestId("native-adapter")).toBeTruthy();
});
