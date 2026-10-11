import type { DiagramTheme } from "./types";

const affectedTypes = new Set([
  "gitGraph",
  "timeline",
  "kanban",
  "radar",
  "treemap",
]);

// Opaque article-family surfaces and readable strokes. Explicit derived colors
// survive Mermaid base theme's automatic darkening (which otherwise reaches black).
function paletteFor(theme: DiagramTheme) {
  return theme === "dark"
    ? [
        ["#165369", "#cffafe", "#22d3ee"],
        ["#174f40", "#bbf7d0", "#34d399"],
        ["#423665", "#ddd6fe", "#a78bfa"],
        ["#625021", "#fde68a", "#fbbf24"],
        ["#613440", "#fecdd3", "#fb7185"],
      ]
    : [
        ["#ecfeff", "#155e75", "#0891b2"],
        ["#ecfdf5", "#047857", "#047857"],
        ["#f5f3ff", "#6d28d9", "#7c3aed"],
        ["#fffbeb", "#92400e", "#b45309"],
        ["#fff1f2", "#be123c", "#e11d48"],
      ];
}

export function buildMermaidThemeVariables(
  theme: DiagramTheme,
  enhanced: boolean,
) {
  const dark = theme === "dark";
  if (!enhanced) {
    return {
      background: "transparent",
      primaryColor: dark ? "#27272a" : "#f8fafc",
      primaryTextColor: dark ? "#f4f4f5" : "#18181b",
      primaryBorderColor: dark ? "#52525b" : "#d4d4d8",
      lineColor: dark ? "#a1a1aa" : "#71717a",
      secondaryColor: dark ? "#18181b" : "#ffffff",
      tertiaryColor: "transparent",
      textColor: dark ? "#f4f4f5" : "#18181b",
      fontFamily: "ui-sans-serif, system-ui, sans-serif",
    };
  }

  return {
    background: "transparent",
    primaryColor: dark ? "#0f2a37" : "#ecfeff",
    primaryTextColor: dark ? "#cffafe" : "#155e75",
    primaryBorderColor: dark ? "#22d3ee" : "#67e8f9",
    lineColor: dark ? "#34d399" : "#10b981",
    secondaryColor: dark ? "#102b24" : "#ecfdf5",
    tertiaryColor: dark ? "#221a3a" : "#f5f3ff",
    textColor: dark ? "#f4f8ff" : "#0b1324",
    nodeBorder: dark ? "#22d3ee" : "#06b6d4",
    mainBkg: dark ? "#0f2a37" : "#ecfeff",
    clusterBkg: dark ? "#0b1220" : "#f8fbff",
    clusterBorder: dark ? "#2a4763" : "#a5f3fc",
    fontFamily: "ui-sans-serif, system-ui, sans-serif",
  };
}

const commonTypes = new Set([
  "flowchart",
  "flowchart-v2",
  "sequence",
  "stateDiagram",
  "stateDiagram-v2",
  "er",
]);

function buildCommonDiagramPalette(type: string, theme: DiagramTheme) {
  const dark = theme === "dark";
  const [cyan, mint, violet, amber] = paletteFor(theme);
  const canvas = dark ? "#0b1220" : "#f8fbff";
  const foreground = dark ? "#f4f8ff" : "#0b1324";
  const nodeSurface = dark ? "#0f2a37" : cyan[0];
  const boundary = dark ? "#94a3b8" : "#64748b";
  const variables: Record<string, unknown> = {
    darkMode: dark,
    primaryColor: nodeSurface,
    primaryTextColor: cyan[1],
    primaryBorderColor: cyan[2],
    secondaryColor: mint[0],
    secondaryTextColor: mint[1],
    secondaryBorderColor: mint[2],
    tertiaryColor: violet[0],
    tertiaryTextColor: violet[1],
    tertiaryBorderColor: violet[2],
    mainBkg: nodeSurface,
    nodeBorder: cyan[2],
    nodeTextColor: cyan[1],
    textColor: foreground,
    lineColor: mint[2],
    arrowheadColor: mint[2],
    clusterBkg: canvas,
    clusterBorder: boundary,
    titleColor: foreground,
    edgeLabelBackground: canvas,
    fontFamily:
      'ui-sans-serif, system-ui, "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif',
  };

  if (type === "sequence") {
    Object.assign(variables, {
      actorBkg: nodeSurface,
      actorTextColor: cyan[1],
      actorBorder: cyan[2],
      actorLineColor: boundary,
      signalColor: mint[2],
      signalTextColor: foreground,
      sequenceNumberColor: dark ? canvas : "#ffffff",
      labelBoxBkgColor: violet[0],
      labelBoxBorderColor: violet[2],
      labelTextColor: violet[1],
      loopTextColor: foreground,
      noteBkgColor: amber[0],
      noteTextColor: amber[1],
      noteBorderColor: amber[2],
      activationBkgColor: mint[0],
      activationBorderColor: mint[2],
      rectBkgColor: canvas,
    });
  } else if (type === "stateDiagram" || type === "stateDiagram-v2") {
    Object.assign(variables, {
      stateBkg: nodeSurface,
      stateLabelColor: cyan[1],
      stateBorder: cyan[2],
      transitionColor: mint[2],
      transitionLabelColor: foreground,
      compositeBackground: canvas,
      compositeTitleBackground: violet[0],
      altBackground: violet[0],
      labelBackgroundColor: canvas,
      noteBkgColor: amber[0],
      noteTextColor: amber[1],
      noteBorderColor: amber[2],
      specialStateColor: mint[2],
      innerEndBackground: canvas,
    });
  } else if (type === "er") {
    // Mermaid 11's unified ER renderer reads rowOdd/rowEven directly.
    variables.rowOdd = cyan[0];
    variables.rowEven = mint[0];
  }

  return variables;
}

export function buildMermaidPaletteOverrides(
  type: string,
  theme: DiagramTheme,
): Record<string, unknown> | undefined {
  if (commonTypes.has(type)) return buildCommonDiagramPalette(type, theme);
  if (!affectedTypes.has(type)) return undefined;
  const palette = paletteFor(theme);
  const dark = theme === "dark";
  const canvas = dark ? "#0b1220" : "#f6fbff";
  const foreground = dark ? "#f4f8ff" : "#0b1324";
  const variables: Record<string, unknown> = {};
  for (let i = 0; i < 12; i++) {
    const [surface, text, line] = palette[i % palette.length];
    variables[`cScale${i}`] = type === "radar" ? line : surface;
    variables[`cScalePeer${i}`] = type === "treemap" ? line : surface;
    variables[`cScaleInv${i}`] = line;
    // Treemap assigns its label scale independently from its fill scale.
    variables[`cScaleLabel${i}`] = type === "treemap" ? foreground : text;
    variables[`lineColor${i}`] = line;
    if (i < 8) {
      variables[`git${i}`] = surface;
      variables[`gitInv${i}`] = line;
      variables[`gitBranchLabel${i}`] = text;
    }
  }
  if (type === "gitGraph") {
    Object.assign(variables, {
      commitLabelColor: foreground,
      commitLabelBackground: canvas,
      tagLabelColor: foreground,
      tagLabelBackground: canvas,
      tagLabelBorder: palette[0][2],
    });
  }
  if (type === "radar") {
    variables.radar = {
      axisColor: dark ? "#cbd5e1" : "#475569",
      graticuleColor: dark ? "#94a3b8" : "#64748b",
    };
  }
  return variables;
}

export function buildMermaidPaletteCSS(
  type: string,
  theme: DiagramTheme,
): string {
  if (!affectedTypes.has(type)) return "";
  const palette = paletteFor(theme);
  const foreground = theme === "dark" ? "#f4f8ff" : "#0b1324";
  if (type === "gitGraph") {
    return (
      Array.from({ length: 12 }, (_, i) => {
        const [, , line] = palette[(i % 8) % palette.length];
        return `.arrow${i}, .commit${i} { stroke: ${line}; }`;
      }).join("\n") + "\n.commit-label-bkg { opacity: 1; }"
    );
  }
  if (type === "radar") {
    return `.radarTitle, .radarAxisLabel, .radarLegendText { fill: ${foreground}; color: ${foreground}; }`;
  }
  if (type === "kanban") {
    // Kanban lightens each section by another 10%, washing light fills to white
    // and weakening dark-mode label contrast. Use the final surface directly.
    return Array.from({ length: 12 }, (_, i) => {
      const [surface] = palette[i % palette.length];
      return `.section-${i - 1} > rect { fill: ${surface}; stroke: ${surface}; }`;
    }).join("\n");
  }
  if (type === "treemap") {
    return `.treemapLeaf { stroke: ${theme === "dark" ? "#64748b" : "#94a3b8"}; }`;
  }
  return "";
}
