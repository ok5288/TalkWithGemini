import { describe, expect, it } from "vitest";
import { normalizeSystemSettings } from "@/lib/settings/appConfig";
import { resolveEffectiveChatContext } from "@/lib/chat/effectiveChatContext";
import { DEFAULT_CHAT_CONFIG, DEFAULT_RAG_CONFIG } from "@/config/defaults";
import { INTELLIGENT_UI_PROMPT_MARKER } from "@/lib/intelligentUi/prompt";
import type { ChatMode } from "@/types";
const context = (mode: ChatMode, enabled = true) =>
  resolveEffectiveChatContext({
    selectedModel: "openai:test",
    modelMetadata: { test: { id: "test", name: "Test", tool_call: true } },
    customModelMetadata: {},
    chatConfig: { ...DEFAULT_CHAT_CONFIG, chatMode: mode },
    search: { provider: "google", configs: {} },
    rag: {
      ...DEFAULT_RAG_CONFIG,
      documentParseProvider: "mineru",
      mineruApiToken: "",
    },
    installedPlugins: [],
    pluginConfigs: {},
    activePlugins: [],
    enableIntelligentUi: enabled,
  });
describe("Intelligent UI settings and prompt boundary", () => {
  it("defaults missing legacy settings to enabled and retains explicit opt out", () => {
    expect(normalizeSystemSettings(undefined).enableIntelligentUi).toBe(true);
    expect(normalizeSystemSettings({}).enableIntelligentUi).toBe(true);
    expect(
      normalizeSystemSettings({ enableIntelligentUi: false })
        .enableIntelligentUi,
    ).toBe(false);
    expect(
      normalizeSystemSettings({ enableIntelligentUi: true })
        .enableIntelligentUi,
    ).toBe(true);
  });
  it("injects the protocol in ordinary and Agent chat only when enabled", () => {
    expect(context("chat").systemInstruction).toContain(
      INTELLIGENT_UI_PROMPT_MARKER,
    );
    expect(context("agent").systemInstruction).toContain(
      INTELLIGENT_UI_PROMPT_MARKER,
    );
    expect(context("chat", false).systemInstruction).not.toContain(
      INTELLIGENT_UI_PROMPT_MARKER,
    );
  });
  it("keeps the protocol out of Research", () => {
    const result = context("research");
    expect(result.researchModeEnabled).toBe(true);
    expect(result.systemInstruction).not.toContain(
      INTELLIGENT_UI_PROMPT_MARKER,
    );
  });
});
