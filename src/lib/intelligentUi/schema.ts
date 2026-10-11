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
import { explorerDatasetSchema } from "./explorer/schema";
import { normalizeUiSourceBindings } from "./sources/types";
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

export function normalizeIntelligentUiBlock(
  value: unknown,
  options: { interrupted?: boolean } = {},
): IntelligentUiBlock | null {
  if (!value || typeof value !== "object") return null;
  const b = value as Record<string, unknown>;
  if (b.type !== "intelligent_ui" || typeof b.id !== "string") return null;
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
      id: b.id,
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
  return {
    id: b.id,
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
  };
}
