// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import mermaid from "mermaid";
import {
  buildMermaidPaletteCSS,
  buildMermaidPaletteOverrides,
  buildMermaidThemeVariables,
} from "@/components/content/markdown/mermaidPalette";
import { mermaidPaletteSamples } from "./fixtures/mermaidPaletteSamples";

function luminance(hex: string) {
  const rgb = hex
    .slice(1)
    .match(/../g)!
    .map((value) => {
      const channel = Number.parseInt(value, 16) / 255;
      return channel <= 0.04045
        ? channel / 12.92
        : ((channel + 0.055) / 1.055) ** 2.4;
    });
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
}

function contrast(a: string, b: string) {
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

describe("Mermaid derived palette", () => {
  it.each(Object.entries(mermaidPaletteSamples))(
    "recognizes the actual %s source type",
    async (type, source) => {
      mermaid.initialize({ startOnLoad: false, theme: "base" });
      expect(mermaid.detectType(source)).toBe(type);
      expect(await mermaid.parse(source)).toEqual(
        expect.objectContaining({ diagramType: type }),
      );
    },
  );
  it.each(["light", "dark"] as const)(
    "keeps text readable and radar series distinguishable in %s mode",
    (theme) => {
      for (const type of [
        "gitGraph",
        "timeline",
        "kanban",
        "radar",
        "treemap",
      ]) {
        mermaid.initialize({
          theme: "base",
          themeVariables: buildMermaidPaletteOverrides(type, theme),
        });
        const v = mermaid.mermaidAPI.getConfig().themeVariables;
        for (let i = 0; i < 12; i++) {
          if (type === "radar") {
            expect(
              contrast(
                v[`cScale${i}`],
                theme === "dark" ? "#0b1220" : "#f6fbff",
              ),
            ).toBeGreaterThanOrEqual(3);
          } else {
            expect(
              contrast(v[`cScale${i}`], v[`cScaleLabel${i}`]),
            ).toBeGreaterThanOrEqual(4.5);
            if (type !== "treemap") {
              expect(
                contrast(v[`cScalePeer${i}`], v[`cScaleLabel${i}`]),
              ).toBeGreaterThanOrEqual(4.5);
            }
          }
        }
        expect(
          new Set(Array.from({ length: 5 }, (_, i) => v[`cScale${i}`])).size,
        ).toBe(5);
        expect(contrast(v.git0, v.gitBranchLabel0)).toBeGreaterThanOrEqual(4.5);
      }
    },
  );
  it.each(["gitGraph", "timeline", "kanban", "radar", "treemap"])(
    "%s keeps dark palette colors from collapsing to black",
    (type) => {
      mermaid.initialize({
        startOnLoad: false,
        theme: "base",
        themeVariables: {
          primaryColor: "#0f2a37",
          secondaryColor: "#102b24",
          tertiaryColor: "#221a3a",
          primaryTextColor: "#cffafe",
          ...buildMermaidPaletteOverrides(type, "dark"),
        },
      });
      const colors = mermaid.mermaidAPI.getConfig().themeVariables;
      const prefix = type === "gitGraph" ? "git" : "cScale";
      for (let i = 0; i < 5; i++) {
        expect(colors[`${prefix}${i}`]).not.toMatch(/, 0%\)|#000000|^black$/u);
      }
    },
  );

  it.each(["classDiagram", "mindmap"])(
    "leaves %s theme variables untouched",
    (type) =>
      expect(buildMermaidPaletteOverrides(type, "dark")).toBeUndefined(),
  );

  describe.each(["light", "dark"] as const)(
    "common diagrams in %s",
    (theme) => {
      const canvas = theme === "dark" ? "#0b1220" : "#ffffff";

      it.each(["flowchart-v2", "sequence", "stateDiagram", "er"])(
        "%s keeps effective text and essential marks readable",
        (type) => {
          mermaid.initialize({
            startOnLoad: false,
            theme: "base",
            themeVariables: {
              ...buildMermaidThemeVariables(theme, true),
              ...buildMermaidPaletteOverrides(type, theme),
            },
          });
          const v = mermaid.mermaidAPI.getConfig().themeVariables;
          const textPairs = [
            [v.nodeTextColor, v.mainBkg],
            [v.titleColor, v.clusterBkg],
            [v.textColor, v.edgeLabelBackground],
            [v.primaryTextColor, v.primaryColor],
            [v.secondaryTextColor, v.secondaryColor],
            [v.tertiaryTextColor, v.tertiaryColor],
          ];
          const markPairs = [
            [v.lineColor, canvas],
            [v.arrowheadColor, canvas],
            [v.nodeBorder, v.mainBkg],
            [v.nodeBorder, canvas],
            [v.clusterBorder, v.clusterBkg],
          ];

          if (type === "sequence") {
            textPairs.push(
              [v.actorTextColor, v.actorBkg],
              [v.signalTextColor, canvas],
              [v.labelTextColor, v.labelBoxBkgColor],
              [v.loopTextColor, v.rectBkgColor],
              [v.noteTextColor, v.noteBkgColor],
              [v.sequenceNumberColor, v.signalColor],
            );
            markPairs.push(
              [v.actorBorder, v.actorBkg],
              [v.actorLineColor, canvas],
              [v.signalColor, canvas],
              [v.noteBorderColor, v.noteBkgColor],
              [v.activationBorderColor, v.activationBkgColor],
              [v.labelBoxBorderColor, v.labelBoxBkgColor],
            );
          } else if (type === "stateDiagram") {
            textPairs.push(
              [v.stateLabelColor, v.stateBkg],
              [v.stateLabelColor, v.compositeTitleBackground],
              [v.stateLabelColor, v.compositeBackground],
              [v.textColor, v.altBackground],
              [v.transitionLabelColor, v.labelBackgroundColor],
              [v.noteTextColor, v.noteBkgColor],
            );
            markPairs.push(
              [v.stateBorder, v.stateBkg],
              [v.transitionColor, canvas],
              [v.specialStateColor, v.innerEndBackground],
              [v.noteBorderColor, v.noteBkgColor],
            );
          } else if (type === "er") {
            textPairs.push(
              [v.nodeTextColor, v.rowOdd],
              [v.nodeTextColor, v.rowEven],
            );
            markPairs.push([v.nodeBorder, v.rowOdd], [v.nodeBorder, v.rowEven]);
            expect(v.rowOdd).not.toBe(v.rowEven);
          }

          for (const [text, surface] of textPairs) {
            expect(
              contrast(text, surface),
              `${text} on ${surface}`,
            ).toBeGreaterThanOrEqual(4.5);
          }
          for (const [stroke, surface] of markPairs) {
            expect(
              contrast(stroke, surface),
              `${stroke} on ${surface}`,
            ).toBeGreaterThanOrEqual(3);
          }
          expect(v.darkMode).toBe(theme === "dark");
          expect(v.fontFamily).toContain("PingFang SC");
          expect(v.fontFamily).toContain("Microsoft YaHei");
          expect(buildMermaidPaletteOverrides(type, theme)).not.toHaveProperty(
            "cScale0",
          );
          expect(buildMermaidPaletteCSS(type, theme)).toBe("");
        },
      );
    },
  );
});
