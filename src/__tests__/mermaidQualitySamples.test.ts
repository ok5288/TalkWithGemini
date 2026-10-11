// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import mermaid from "mermaid";
import { buildDiagramPromptInstruction } from "@/lib/chat/diagramPrompt";
import { parseMarkdownDiagramBlocks } from "@/lib/utils/markdownDiagrams";
import { mermaidQualitySamples } from "./fixtures/mermaidQualitySamples";

describe("Mermaid generation examples", () => {
  it.each(Object.entries(mermaidQualitySamples))(
    "parses %s with its accessible name and description",
    async (_name, { diagramType, source, title }) => {
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        theme: "base",
        flowchart: { htmlLabels: false },
      });

      expect(mermaid.detectType(source)).toBe(diagramType);
      expect(await mermaid.parse(source)).toEqual(
        expect.objectContaining({ diagramType }),
      );
      const diagram = await mermaid.mermaidAPI.getDiagramFromText(source);
      expect(diagram.db.getAccTitle?.()).toBe(title);
      expect(diagram.db.getAccDescription?.()).toBeTruthy();
    },
  );

  it("routes the system's complete example as literal Mermaid source", () => {
    const instruction = buildDiagramPromptInstruction({ enhanced: true });
    const diagrams = parseMarkdownDiagramBlocks(instruction).filter(
      (segment) => segment.kind === "diagram",
    );
    const mermaidBlocks = diagrams.filter(
      (segment) => segment.diagram.type === "mermaid",
    );

    expect(mermaidBlocks).toHaveLength(1);
    expect(mermaidBlocks[0].diagram).toMatchObject({
      content: mermaidQualitySamples.flowchart.source,
      incomplete: false,
    });
  });
});
