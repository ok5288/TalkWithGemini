import { describe, expect, it } from "vitest";
import {
  normalizeMermaidSvg,
  normalizeMindMapSvg,
} from "../lib/utils/diagramSvg";

describe("diagram SVG normalization", () => {
  it("stabilizes Mermaid root attributes for snapshot and export rendering", () => {
    const svg =
      '<svg viewBox="0 0 321.4567 120" width="100%" style="max-width: 100%; color: red"><g/></svg>';

    expect(normalizeMermaidSvg(svg)).toContain(
      'class="markdown-mermaid-svg-snapshot"',
    );
    expect(normalizeMermaidSvg(svg)).toContain('data-diagram-export="mermaid"');
    expect(normalizeMermaidSvg(svg)).toContain('width="321.457"');
    expect(normalizeMermaidSvg(svg)).toContain('height="120"');
    expect(normalizeMermaidSvg(svg)).not.toContain("max-width");
  });

  it("normalizes mind map backgrounds without changing export identity", () => {
    const svg = '<svg><rect width="100%" height="100%" fill="#fff"/><g/></svg>';

    const normalized = normalizeMindMapSvg(svg);
    expect(normalized).toContain('fill="transparent"');
    expect(normalized).toContain('data-diagram-export="mindmap"');
    expect(normalized).toContain('class="markdown-mindmap-svg-snapshot"');
  });

  it("preserves accessible names, descriptions, and embedded theme styles", () => {
    const svg = `<svg viewBox="0 0 320 120" aria-labelledby="chart-title-sample" aria-describedby="chart-desc-sample">
      <title id="chart-title-sample">任务生命周期</title>
      <desc id="chart-desc-sample">任务可失败后重试或取消。</desc>
      <style>.node rect { fill: #0f2a37; stroke: #22d3ee; }</style>
      <g><text>执行中</text></g>
    </svg>`;

    const normalized = normalizeMermaidSvg(svg);
    expect(normalized).toContain('aria-labelledby="chart-title-sample"');
    expect(normalized).toContain('aria-describedby="chart-desc-sample"');
    expect(normalized).toContain(
      '<title id="chart-title-sample">任务生命周期</title>',
    );
    expect(normalized).toContain(
      '<desc id="chart-desc-sample">任务可失败后重试或取消。</desc>',
    );
    expect(normalized).toContain("fill: #0f2a37; stroke: #22d3ee;");
  });

  it("preserves generated SVG internals while normalizing root attributes", () => {
    const svg = `
      <svg viewBox="0 0 100 40">
        <style>.label { font: 12px sans-serif; }</style>
        <foreignObject width="80" height="24">
          <div xmlns="http://www.w3.org/1999/xhtml" class="label">Node</div>
        </foreignObject>
        <defs>
          <marker id="arrow" orient="auto"><path d="M0,0 L10,5 L0,10 z"/></marker>
        </defs>
      </svg>
    `;

    const normalized = normalizeMermaidSvg(svg);

    expect(normalized).toContain("<style>");
    expect(normalized).toContain("<foreignObject");
    expect(normalized).toContain("<marker");
    expect(normalized).toContain('class="markdown-mermaid-svg-snapshot"');
  });
});
