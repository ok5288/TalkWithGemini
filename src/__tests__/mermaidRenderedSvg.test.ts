// @vitest-environment jsdom
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import mermaid from "mermaid";
import {
  buildMermaidPaletteOverrides,
  buildMermaidThemeVariables,
} from "@/components/content/markdown/mermaidPalette";
import { normalizeMermaidSvg } from "@/lib/utils/diagramSvg";
import { mermaidQualitySamples } from "./fixtures/mermaidQualitySamples";

const originalBBox = Object.getOwnPropertyDescriptor(
  SVGElement.prototype,
  "getBBox",
);
const originalTextLength = Object.getOwnPropertyDescriptor(
  SVGElement.prototype,
  "getComputedTextLength",
);

beforeAll(() => {
  // jsdom has no SVG text metrics. These stand-ins exercise real rendering,
  // style embedding, and accessibility output, not browser layout geometry.
  Object.defineProperty(SVGElement.prototype, "getBBox", {
    configurable: true,
    value(this: SVGElement) {
      return {
        x: 0,
        y: 0,
        width: Math.max(24, Math.min(400, (this.textContent ?? "").length * 8)),
        height: 24,
      };
    },
  });
  Object.defineProperty(SVGElement.prototype, "getComputedTextLength", {
    configurable: true,
    value(this: SVGElement) {
      return (this.textContent ?? "").length * 8;
    },
  });
});

afterAll(() => {
  if (originalBBox) {
    Object.defineProperty(SVGElement.prototype, "getBBox", originalBBox);
  } else {
    Reflect.deleteProperty(SVGElement.prototype, "getBBox");
  }
  if (originalTextLength) {
    Object.defineProperty(
      SVGElement.prototype,
      "getComputedTextLength",
      originalTextLength,
    );
  } else {
    Reflect.deleteProperty(SVGElement.prototype, "getComputedTextLength");
  }
});

describe.each(["light", "dark"] as const)(
  "rendered Mermaid SVG in %s",
  (theme) => {
    it.each(Object.entries(mermaidQualitySamples))(
      "%s embeds theme colors and keeps resolving accessible names",
      async (name, { diagramType, source, title }) => {
        const variables: Record<string, unknown> = {
          ...buildMermaidThemeVariables(theme, true),
          ...buildMermaidPaletteOverrides(diagramType, theme),
        };
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          suppressErrorRendering: true,
          theme: "base",
          flowchart: { htmlLabels: false },
          sequence: { useMaxWidth: true },
          themeVariables: variables,
        });
        const { svg } = await mermaid.render(
          `quality-${theme}-${name}`,
          source,
        );
        const normalized = normalizeMermaidSvg(svg);
        const root = new DOMParser().parseFromString(
          normalized,
          "image/svg+xml",
        ).documentElement;
        const titleId = root.getAttribute("aria-labelledby");
        const descriptionId = root.getAttribute("aria-describedby");

        expect(root.querySelector("parsererror")).toBeNull();
        expect(titleId).toBeTruthy();
        expect(descriptionId).toBeTruthy();
        expect(root.querySelector(`[id="${titleId}"]`)?.textContent).toBe(
          title,
        );
        expect(
          root.querySelector(`[id="${descriptionId}"]`)?.textContent,
        ).toBeTruthy();
        expect(root.getAttribute("data-diagram-export")).toBe("mermaid");
        expect(root.querySelector("style")?.textContent).toContain(
          variables.lineColor,
        );
        expect(root.querySelector("style")?.textContent).toContain(
          "PingFang SC",
        );
        expect(normalized).not.toContain("fonts.googleapis.com");

        if (name === "er") {
          // ER attribute backgrounds are drawn as row paths, not inherited CSS.
          expect(
            root.querySelector(`path[fill="${variables.rowOdd}"]`),
          ).not.toBeNull();
          expect(
            root.querySelector(`path[fill="${variables.rowEven}"]`),
          ).not.toBeNull();
        } else if (name === "sequence") {
          expect(root.querySelector("style")?.textContent).toContain(
            variables.noteBkgColor,
          );
          expect(root.querySelector(".note")).not.toBeNull();
          expect(root.querySelector(".activation0")).not.toBeNull();
        }
      },
    );
  },
);
