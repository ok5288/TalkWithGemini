import { z } from "zod";
import type {
  HtmlDefinition,
  IntelligentUiBlock,
  JsonObject,
  JsonValue,
  NativeDefinition,
} from "./types";
import { base } from "./capabilities/shared";
import { nativeDefinitionSchema } from "./catalog";
import { explorerDatasetSchema, explorerV2Schema } from "./explorer/schema";
import { initialExplorer, normalizeExplorer } from "./explorer/derive";
import { normalizeUiSourceBindings } from "./sources/types";
import { normalizeUiDiagnostic } from "./diagnostics";
import {
  getUnsupportedUiFallback,
  isQuarantinedUiPayload,
  isUnsupportedIntelligentUiPayload,
  normalizeUiRevision,
  quarantineUnsupportedUiPayload,
  unsupportedUiState,
} from "./compatibility";
export { nativeDefinitionSchema } from "./catalog";
export const htmlDefinitionSchema = z.object({ ...base, html: z.string() });
export function normalizeJsonState(value: unknown): JsonObject {
  const visit = (input: unknown, depth: number): JsonValue | undefined => {
    if (depth > 24) return undefined;
    if (
      input === null ||
      typeof input === "string" ||
      typeof input === "boolean"
    )
      return input;
    if (typeof input === "number")
      return Number.isFinite(input) ? input : undefined;
    if (Array.isArray(input))
      return input.map((v) => visit(v, depth + 1) ?? null);
    if (input && typeof input === "object") {
      const result: JsonObject = {};
      for (const [key, val] of Object.entries(input)) {
        if (["__proto__", "constructor", "prototype"].includes(key)) continue;
        const clean = visit(val, depth + 1);
        if (clean !== undefined) result[key] = clean;
      }
      return result;
    }
    return undefined;
  };
  const result = visit(value, 0);
  return result && typeof result === "object" && !Array.isArray(result)
    ? result
    : {};
}
/** Persistence is lossless for JSON HTML state; runtime eligibility enforces limits. */
function restoreHtmlJsonState(value: unknown): JsonObject {
  const isContainer = (item: unknown): item is JsonObject | JsonValue[] => {
    if (!item || typeof item !== "object") return false;
    const prototype = Object.getPrototypeOf(item);
    return (
      Array.isArray(item) ||
      prototype === null ||
      prototype === Object.prototype
    );
  };
  if (!isContainer(value) || Array.isArray(value)) return {};
  const output: JsonObject = {};
  type Frame = {
    source: JsonObject | JsonValue[];
    target: JsonObject | JsonValue[];
    keys: string[];
    index: number;
  };
  const frame = (source: Frame["source"], target: Frame["target"]): Frame => ({
    source,
    target,
    keys: Array.isArray(source)
      ? Array.from({ length: source.length }, (_, index) => String(index))
      : Object.keys(source),
    index: 0,
  });
  const stack = [frame(value, output)];
  const ancestors = new WeakSet<object>([value]);
  while (stack.length) {
    const current = stack[stack.length - 1]!;
    if (current.index === current.keys.length) {
      ancestors.delete(current.source);
      stack.pop();
      continue;
    }
    const key = current.keys[current.index++]!;
    const property = Object.getOwnPropertyDescriptor(current.source, key);
    // Non-JSON input is not historical JSON and must not invoke accessors.
    if (!property || !("value" in property)) return {};
    const child: unknown = property.value;
    let copied: JsonValue;
    if (
      child === null ||
      typeof child === "string" ||
      typeof child === "boolean"
    )
      copied = child;
    else if (typeof child === "number" && Number.isFinite(child))
      copied = child;
    else if (isContainer(child) && !ancestors.has(child)) {
      copied = Array.isArray(child) ? [] : {};
      ancestors.add(child);
      stack.push(frame(child, copied));
    } else return {};
    // Keep JSON keys such as __proto__ as own data without invoking setters.
    Object.defineProperty(current.target, key, {
      value: copied,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return output;
}

export function parseNativeDefinition(value: unknown): NativeDefinition | null {
  const parsed = nativeDefinitionSchema.safeParse(normalizeJsonState(value));
  return parsed.success ? (parsed.data as NativeDefinition) : null;
}
export function parseHtmlDefinition(value: unknown): HtmlDefinition | null {
  const parsed = htmlDefinitionSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function isNormalizedQuarantineRecord(value: Record<string, unknown>): boolean {
  return (
    value.schemaVersion === 1 &&
    value.renderer === "native" &&
    value.definition === null &&
    (value.status === "failed" || value.status === "cancelled") &&
    value.staticSnapshot === "" &&
    Array.isArray(value.sourceRefs) &&
    value.sourceRefs.length === 0 &&
    value.state !== null &&
    typeof value.state === "object" &&
    !Array.isArray(value.state) &&
    Object.keys(value.state).length === 0
  );
}

/** Only the canonical inert wrapper can be reopened, and only for Explorer v2. */
function recoverExplorerV2Quarantine(
  b: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (
    !isNormalizedQuarantineRecord(b) ||
    !isQuarantinedUiPayload(b.unsupportedPayload)
  )
    return;
  const wrapperKeys = new Set([
    "id",
    "type",
    "schemaVersion",
    "renderer",
    "definition",
    "definitionRevision",
    "status",
    "fallbackMarkdown",
    "state",
    "stateRevision",
    "staticSnapshot",
    "sourceRefs",
    "unsupportedPayload",
    "diagnostic",
  ]);
  if (Object.keys(b).some((key) => !wrapperKeys.has(key))) return;
  let raw: unknown;
  try {
    raw = JSON.parse(b.unsupportedPayload);
  } catch {
    return;
  }
  const hasNestedMarker = (value: unknown): boolean => {
    if (
      value &&
      typeof value === "object" &&
      Object.hasOwn(value, "unsupportedPayload")
    )
      return true;
    const pending = [{ value, depth: 0 }];
    while (pending.length) {
      const item = pending.pop()!;
      if (item.depth > 24) return true;
      if (!item.value || typeof item.value !== "object") continue;
      for (const nested of Object.values(item.value))
        pending.push({ value: nested, depth: item.depth + 1 });
    }
    return false;
  };
  if (
    !raw ||
    typeof raw !== "object" ||
    Array.isArray(raw) ||
    hasNestedMarker(raw)
  )
    return;
  const payload = raw as Record<string, unknown>;
  const full = payload.type === "intelligent_ui";
  if (
    full &&
    (payload.schemaVersion !== 1 ||
      payload.renderer !== "native" ||
      typeof payload.id !== "string" ||
      typeof payload.fallbackMarkdown !== "string" ||
      typeof payload.staticSnapshot !== "string" ||
      !Array.isArray(payload.sourceRefs) ||
      !["ready", "failed", "cancelled", "receiving", "preview"].includes(
        String(payload.status),
      ) ||
      !Number.isSafeInteger(payload.definitionRevision) ||
      Number(payload.definitionRevision) < 1 ||
      !Number.isSafeInteger(payload.stateRevision) ||
      Number(payload.stateRevision) < 0 ||
      !payload.state ||
      typeof payload.state !== "object" ||
      Array.isArray(payload.state))
  )
    return;
  const definition = explorerV2Schema.safeParse(
    full ? payload.definition : payload,
  );
  if (!definition.success) return;
  const snapshot =
    full && payload.dataSnapshot !== undefined
      ? explorerDatasetSchema.safeParse(payload.dataSnapshot)
      : undefined;
  if (snapshot && !snapshot.success) return;
  const data = snapshot?.success ? snapshot.data : undefined;
  const input = full
    ? normalizeJsonState(payload.state)
    : initialExplorer(definition.data);
  const state =
    data || definition.data.props.dataset.kind === "inline"
      ? normalizeExplorer(definition.data, input, data)
      : input;
  return {
    ...(full ? payload : b),
    id: b.id,
    type: "intelligent_ui",
    schemaVersion: 1,
    renderer: "native",
    definition: definition.data,
    definitionRevision: full
      ? payload.definitionRevision
      : b.definitionRevision,
    status: full ? payload.status : "ready",
    fallbackMarkdown: definition.data.summary,
    state,
    stateRevision: full ? payload.stateRevision : 0,
    staticSnapshot: full ? payload.staticSnapshot : "",
    sourceRefs: [],
    ...(data ? { dataSnapshot: data } : {}),
    sourceBindings: normalizeUiSourceBindings(
      full ? payload.sourceBindings : undefined,
    ),
    unsupportedPayload: undefined,
    diagnostic: undefined,
  };
}

export function normalizeIntelligentUiBlock(
  value: unknown,
  options: { interrupted?: boolean } = {},
): IntelligentUiBlock | null {
  if (!value || typeof value !== "object") return null;
  let b = value as Record<string, unknown>;
  if (b.type !== "intelligent_ui" || typeof b.id !== "string") return null;
  const blockId = b.id;
  b = recoverExplorerV2Quarantine(b) ?? b;
  if (isUnsupportedIntelligentUiPayload(b)) {
    const unsupportedPayload =
      isNormalizedQuarantineRecord(b) &&
      isQuarantinedUiPayload(b.unsupportedPayload)
        ? b.unsupportedPayload
        : quarantineUnsupportedUiPayload(value);
    const fallback =
      getUnsupportedUiFallback(b) ||
      (isQuarantinedUiPayload(b.unsupportedPayload) &&
      typeof b.fallbackMarkdown === "string"
        ? b.fallbackMarkdown
        : "");
    return {
      id: blockId,
      type: "intelligent_ui",
      schemaVersion: 1,
      renderer: "native",
      definition: null,
      definitionRevision: normalizeUiRevision(b.definitionRevision, 1, 1),
      status:
        options.interrupted || b.status === "cancelled"
          ? "cancelled"
          : "failed",
      fallbackMarkdown: fallback,
      state: unsupportedUiState(),
      stateRevision: 0,
      staticSnapshot: "",
      sourceRefs: [],
      unsupportedPayload,
      diagnostic: normalizeUiDiagnostic(b.diagnostic) ?? {
        code: "unsupported_version",
      },
    };
  }
  const renderer = b.renderer === "html" ? "html" : "native";
  const definition =
    b.schemaVersion === 1
      ? renderer === "html"
        ? parseHtmlDefinition(b.definition)
        : parseNativeDefinition(b.definition)
      : null;
  const fallback =
    typeof b.fallbackMarkdown === "string" ? b.fallbackMarkdown : "";
  let status: IntelligentUiBlock["status"] = [
    "receiving",
    "preview",
    "ready",
    "failed",
    "cancelled",
  ].includes(String(b.status))
    ? (b.status as IntelligentUiBlock["status"])
    : "failed";
  if (options.interrupted && (status === "receiving" || status === "preview"))
    status = "cancelled";
  if (!definition && status === "ready") status = "failed";
  const dataSnapshot =
    definition && "kind" in definition && definition.kind === "explorer"
      ? (() => {
          const parsed = explorerDatasetSchema.safeParse(b.dataSnapshot);
          return parsed.success ? parsed.data : undefined;
        })()
      : undefined;
  const sourceBindings = normalizeUiSourceBindings(b.sourceBindings);
  const diagnostic =
    normalizeUiDiagnostic(b.diagnostic) ??
    (status === "cancelled" ? { code: "incomplete" as const } : undefined);
  return {
    id: blockId,
    type: "intelligent_ui",
    schemaVersion: 1,
    renderer,
    definition,
    definitionRevision: normalizeUiRevision(b.definitionRevision, 1, 1),
    status,
    fallbackMarkdown: fallback,
    state:
      renderer === "html"
        ? restoreHtmlJsonState(b.state)
        : normalizeJsonState(b.state),
    stateRevision: normalizeUiRevision(b.stateRevision, 0, 0),
    staticSnapshot:
      typeof b.staticSnapshot === "string" ? b.staticSnapshot : "",
    sourceRefs: [],
    ...(dataSnapshot ? { dataSnapshot } : {}),
    ...(sourceBindings.length ? { sourceBindings } : {}),
    ...(diagnostic ? { diagnostic } : {}),
  };
}
