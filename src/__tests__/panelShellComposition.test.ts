import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("capability panel composition", () => {
  it.each([
    ["assistants", "src/components/assistant/AssistantHub.tsx"],
    ["skills", "src/components/skill/SkillMarket.tsx"],
    ["plugins", "src/components/plugin/PluginMarket.tsx"],
    ["knowledge", "src/components/knowledge/KnowledgeBase.tsx"],
  ])("uses the shared shell and %s accent", (accent, path) => {
    const source = readFileSync(resolve(process.cwd(), path), "utf8");
    expect(source).toContain('from "@/components/ui/panel"');
    expect(source).toContain(`<PanelRoot accent="${accent}"`);
    expect(source).toContain("<PanelHeader");
    expect(source).toContain("<PanelSearch");
    expect(source).toContain("<PanelCard");
    expect(source).not.toMatch(
      /bg-linear-to-tr from-(?:rose|emerald|blue|purple)-/,
    );
    expect(source).not.toContain("rounded-3xl");
  });
});
