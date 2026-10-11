# Mermaid output quality

Neo Chat keeps Mermaid as literal, editable source and uses its installed
renderer for layout. The application supplies the existing cyan, mint, violet,
amber, and rose theme families. This applies the information-design principles
of [Diagram Design](https://github.com/cathrynlavery/diagram-design) without
adding its HTML/SVG redraw workflow or an additional generation call.

## Generation contract

The system prompt chooses the diagram type by the relationship being explained:
flowcharts for steps and decisions, sequence diagrams for participant exchanges,
state diagrams for lifecycles, and ER diagrams for entities and cardinality.
Grouped flowcharts describe architecture and dependencies. Other Mermaid types
remain available, and prose or a table is preferable for simple answers.

Each diagram answers one main question. Labels follow the user's language;
lengthy explanations stay outside the closed `mermaid` fence. Conditions,
failure paths, cycles, sequence fragments, relationship cardinality, and group
membership carry meaning and must survive simplification. An overview and
focused detail can reduce density; any merge or omission must be explained.
Missing or conflicting facts are reported instead of filled with invented
components or relationships. Source labels and notes are data, not instructions.

New flowcharts, sequence diagrams, state diagrams, and ER diagrams include
native `accTitle` and `accDescr` fields. These provide the SVG's accessible name
and description; they do not replace visible labels or surrounding explanations.
Mermaid and mindmap source remains free of HTML, HTML entities, CSS, and visual
wrappers. Numeric chart JSON and the separate mindmap syntax keep their existing
contracts.

The system contains one complete flowchart example. Request-level instructions
provide a short reminder, without repeating the example or exposing a planning
transcript. Existing prompt markers, idempotent appending, and request length
handling remain in place.

## Rendering contract

Mermaid uses the `base` theme with explicit light/dark colors. Common diagram
themes cover nodes, edges, groups, sequence notes and fragments, state boundaries,
and alternating ER attribute rows. Ordinary text must have at least 4.5:1 contrast
against its actual surface, and essential lines and boundaries at least 3:1.
Shapes, labels, and meaningful solid/dashed edges carry information alongside
color. Fonts use a system stack with Chinese fallbacks and no remote font fetch.

The renderer's generated SVG contains the theme and native accessibility
metadata. SVG normalization preserves those internals, and the same rendered
snapshot is used for display and PNG export. Source copying still returns the
original Mermaid. Strict mode, render serialization, caching, and the existing
fullscreen controls remain in use.

## Representative evaluation cases

Use the same provider, model version, generation settings, conversation context,
and tools for the baseline and revised prompts. Save the outputs separately,
record failures, and repeat cases when sampling variance matters. The canonical
Mermaid sources in `src/__tests__/fixtures/mermaidQualitySamples.ts` exercise the
installed parser; they are not evidence of a model's output quality.

| Case                              | Input                                                                                                          | Acceptance                                                                                                                         |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Chinese and punctuation           | 用 Mermaid 表示：客户端提交 JSON（v2）；服务端校验；合法则执行，不合法则返回修正说明。                         | Chinese labels; valid flowchart; both conditions and outcomes retained; no HTML escaping.                                          |
| Conditional flow                  | 请求先校验权限，再校验额度；无权限时拒绝，额度不足时等待，两项通过才执行。请画图。                             | Both decisions and their distinct failure outcomes survive.                                                                        |
| Sequence fragments                | 用时序图说明：客户端请求服务端；缓存命中直接返回，否则最多查询数据库两次，再返回结果。                         | Sequence syntax, `alt` and `loop`, correct participants and message order.                                                         |
| Lifecycle                         | 任务从等待到执行；可完成、失败后重试，或执行中取消。画出生命周期。                                             | State syntax; retry cycle; completion and cancellation remain distinct.                                                            |
| ER cardinality                    | 一个用户可有零个或多个订单；每个订单必须属于一个用户。用户有 id、name，订单有 id、user_id、status。            | ER syntax; correct optional-many and mandatory-one cardinality; supplied fields preserved.                                         |
| Architecture and density          | 网页和移动端经网关访问服务，服务访问缓存和数据库；服务失败可重试。客户端和核心服务分别分组。请画架构图并解释。 | Groups, entry points, stores, and retry retained; no invented services. Split detail only when useful and disclose simplification. |
| Insufficient or conflicting facts | 资料甲说一个订单可属于多个用户，资料乙说必须属于一个用户；没有数据库定义。请画准确的 ER 图。                   | State the conflict; do not silently choose or invent a definitive relationship.                                                    |
| Simple answer                     | 用一句话解释什么是缓存，不需要图表。                                                                           | One concise sentence; no forced diagram.                                                                                           |

For all diagram cases, check the closed fence, supported grammar, accessible
name/description, factual relationships, and the user's language. Syntax or
semantic failures cannot be offset by better appearance. Compare clarity and
visual hierarchy using an unlabeled side-by-side review when possible.

## Verification boundaries

Focused Vitest checks cover actual Mermaid parsing and SVG rendering, effective
theme colors, accessibility metadata preservation, literal source routing, and
export wiring. The jsdom rendering checks supply stand-in SVG text metrics;
they validate renderer output rather than text geometry. Run them with:

```bash
corepack pnpm exec vitest run src/__tests__/diagramPrompt.test.ts src/__tests__/mermaidQualitySamples.test.ts src/__tests__/mermaidRenderedSvg.test.ts src/__tests__/mermaidPalette.test.ts src/__tests__/diagramSvg.test.ts src/__tests__/diagramBlockSaveImage.test.tsx src/__tests__/diagramImageExport.test.ts
```

Browser visual review should inspect light and dark themes, a narrow viewport,
Chinese labels, arrow-label collisions, fullscreen, and exported PNGs. Parser,
DOM, and color-ratio checks do not prove browser text metrics or visual quality.
Model comparisons and visual review must be recorded as separate evidence;
prepared fixtures alone do not establish improvement. E2E runs still require
explicit permission. There is no new diagram-count, output-size, or build-size
budget gate.
