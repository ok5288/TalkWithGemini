import { z } from "zod";
import type { ToolCall } from "@/types";
import { isToolResultEnvelope } from "@/lib/agent/toolResult";
import { hashToolArguments } from "@/lib/agent/toolArguments";
import { explorerDatasetSchema } from "../explorer/schema";
import type { ExplorerDataset } from "../explorer/types";
import { deriveExplorer } from "../explorer/derive";
import type { JsonObject } from "../types";

/** Host-captured metadata, never inferred from code fences or text payloads. */
export interface UiToolResultDescriptor {
  version: 1;
  adapter: "search-v1" | "table-v1";
  callId: string;
  toolName: string;
  pluginId?: string;
  executionId?: string;
  definitionFingerprint: string;
  resultHash: string;
  retrievedAt: number;
  partial: boolean;
}

const sourceSchema = z.object({
  title: z.string().min(1).max(2000),
  url: z
    .string()
    .url()
    .max(8000)
    .refine((url) => /^https?:\/\//i.test(url)),
  snippet: z.string().max(12000).optional(),
});
const searchSchema = z.object({ sources: z.array(sourceSchema).max(1000) });
const record = (v: unknown): Record<string, unknown> | undefined =>
  v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : undefined;

function resultData(result: unknown) {
  return isToolResultEnvelope(result) && result.ok ? result.data : undefined;
}

function isPartialResult(result: unknown): boolean {
  const data = record(resultData(result));
  const structured = record(data?.structuredContent);
  return (
    data?.truncated === true ||
    data?.partial === true ||
    structured?.truncated === true ||
    structured?.partial === true
  );
}

export function mapToolResultDataset(
  result: unknown,
  adapter: UiToolResultDescriptor["adapter"],
): ExplorerDataset | null {
  const data = resultData(result);
  if (adapter === "search-v1") {
    const parsed = searchSchema.safeParse(data);
    if (!parsed.success) return null;
    const dataset = {
      id: "tool-result",
      version: "captured",
      columns: [
        { id: "title", label: "Title", type: "text" as const },
        { id: "url", label: "URL", type: "text" as const },
        { id: "snippet", label: "Summary", type: "text" as const },
      ],
      rows: parsed.data.sources.map((source, i) => ({
        id: `source-${i + 1}`,
        values: {
          title: source.title,
          url: source.url,
          snippet: source.snippet ?? "",
        },
      })),
    };
    const bounded = explorerDatasetSchema.safeParse(dataset);
    return bounded.success ? bounded.data : null;
  }
  const structured = record(record(data)?.structuredContent ?? data);
  if (structured?.intelligentUiFormat !== "table-v1") return null;
  const parsed = explorerDatasetSchema.safeParse({
    id: "tool-result",
    version: "captured",
    columns: structured.columns,
    rows: structured.rows,
  });
  return parsed.success ? parsed.data : null;
}

export async function captureToolResultView(input: {
  callId: string;
  toolName: string;
  pluginId?: string;
  executionId?: string;
  definitionFingerprint?: string;
  retrievedAt: number;
  result: unknown;
  outputSchema?: unknown;
  outputSchemaValidated?: boolean;
}): Promise<UiToolResultDescriptor | undefined> {
  if (!isToolResultEnvelope(input.result) || !input.result.ok) return;
  const schema = record(input.outputSchema);
  const marker = record(record(schema?.properties)?.intelligentUiFormat)?.const;
  const adapter =
    !input.pluginId && input.toolName === "web_search"
      ? "search-v1"
      : input.pluginId &&
          input.definitionFingerprint &&
          input.outputSchemaValidated &&
          marker === "table-v1"
        ? "table-v1"
        : undefined;
  if (!adapter || !mapToolResultDataset(input.result, adapter)) return;
  return {
    version: 1,
    adapter,
    callId: input.callId,
    toolName: input.toolName,
    ...(input.pluginId ? { pluginId: input.pluginId } : {}),
    ...(input.executionId ? { executionId: input.executionId } : {}),
    definitionFingerprint:
      input.definitionFingerprint ?? "builtin:web_search:v1",
    resultHash: await hashToolArguments(input.result),
    retrievedAt: input.retrievedAt,
    partial: isPartialResult(input.result),
  };
}

/** Imported metadata is data, not authority: recheck binding and exact payload. */
export async function resolveToolResultView(call: ToolCall): Promise<{
  descriptor: UiToolResultDescriptor;
  dataset: ExplorerDataset;
} | null> {
  const d = call.intelligentUiResult;
  if (
    !d ||
    d.version !== 1 ||
    !["search-v1", "table-v1"].includes(d.adapter) ||
    call.status !== "success" ||
    call.isError ||
    d.callId !== call.id ||
    d.toolName !== call.name ||
    d.pluginId !== call.pluginId ||
    d.executionId !== call.executionRecordId ||
    d.partial !== isPartialResult(call.result) ||
    d.definitionFingerprint !==
      (call.functionFingerprint ?? "builtin:web_search:v1") ||
    !Number.isFinite(d.retrievedAt) ||
    !Number.isFinite(new Date(d.retrievedAt).getTime()) ||
    d.resultHash !== (await hashToolArguments(call.result))
  )
    return null;
  if (
    d.adapter === "search-v1" &&
    (call.pluginId || call.name !== "web_search")
  )
    return null;
  if (d.adapter === "table-v1" && (!call.pluginId || !call.functionFingerprint))
    return null;
  const dataset = mapToolResultDataset(call.result, d.adapter);
  return dataset
    ? { descriptor: d, dataset: { ...dataset, version: d.resultHash } }
    : null;
}

/** Storage boundary normalization; no imported state becomes tool arguments. */
export function normalizeToolResultUiState(
  call: ToolCall,
  next: JsonObject,
): JsonObject | null {
  const descriptor = call.intelligentUiResult;
  if (!descriptor || call.status !== "success" || call.isError) return null;
  const dataset = mapToolResultDataset(call.result, descriptor.adapter);
  if (!dataset) return null;
  return deriveExplorer(
    {
      version: 1,
      kind: "explorer",
      title: call.name,
      summary: call.name,
      props: {
        dataset: { kind: "inline", data: dataset },
        provenance: "source",
        parameters: [],
        nodes: [],
      },
    },
    next,
  ).state;
}
