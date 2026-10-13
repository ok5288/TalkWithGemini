import type { JsonObject } from "./types";
import { nativeCapabilities } from "./catalog";

/** The only Intelligent UI wire format understood by this client. */
export const INTELLIGENT_UI_SCHEMA_VERSION = 1 as const;

const RESERVED_IDS = new Set(["__proto__", "prototype", "constructor"]);
function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function readOwnEnumerableValue(
  value: object,
  key: string,
): { present: boolean; value?: unknown } {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
    return { present: false };
  }
  return { present: true, value: descriptor.value };
}

/**
 * Copy an untrusted JSON-like value without invoking inherited toJSON methods,
 * getters, or prototype setters. Persisted payloads are JSON, but this guard
 * also keeps migration helpers safe when called with an object from a test or
 * an extension boundary.
 */
function copyForQuarantine(
  value: unknown,
  seen: WeakSet<object>,
  inArray = false,
): unknown {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "bigint") return `${value}n`;
  if (typeof value !== "object") return inArray ? null : undefined;
  if (seen.has(value)) return null;
  seen.add(value);

  if (Array.isArray(value)) {
    const result = value.map((item) => copyForQuarantine(item, seen, true));
    seen.delete(value);
    return result;
  }

  const result: Record<string, unknown> = {};
  for (const key of Object.keys(value)) {
    const own = readOwnEnumerableValue(value, key);
    if (!own.present) continue;
    const copied = copyForQuarantine(own.value, seen);
    if (copied !== undefined) {
      Object.defineProperty(result, key, {
        configurable: true,
        enumerable: true,
        writable: true,
        value: copied,
      });
    }
  }
  seen.delete(value);
  return result;
}

/**
 * Serialize an unsupported block for private persistence. The value is kept
 * as an inert string so no renderer or model projection can accidentally use
 * fields from a future protocol.
 */
export function quarantineUnsupportedUiPayload(value: unknown): string {
  const copied = copyForQuarantine(value, new WeakSet<object>());
  try {
    return JSON.stringify(copied ?? null);
  } catch {
    return "null";
  }
}

export function isQuarantinedUiPayload(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function readString(value: unknown, maxLength = 480): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

/** Only title and summary are allowed to form an unsupported fallback. */
export function getUnsupportedUiFallback(value: unknown): string {
  if (!isRecord(value)) return "";
  const definition = isRecord(value.definition) ? value.definition : undefined;
  const title = readString(definition?.title ?? value.title);
  const summary = readString(definition?.summary ?? value.summary);
  return [title, summary].filter(Boolean).join(" — ");
}

export function isKnownNativeKind(value: unknown): boolean {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(nativeCapabilities, value)
  );
}

export function isUnsupportedNativeDefinition(value: unknown): boolean {
  return (
    isRecord(value) &&
    ((Object.prototype.hasOwnProperty.call(value, "version") &&
      value.version !== INTELLIGENT_UI_SCHEMA_VERSION &&
      !(value.kind === "explorer" && value.version === 2)) ||
      (typeof value.kind === "string" && !isKnownNativeKind(value.kind)))
  );
}

export function isUnsupportedHtmlMetadata(value: unknown): boolean {
  return (
    isRecord(value) &&
    Object.prototype.hasOwnProperty.call(value, "version") &&
    value.version !== INTELLIGENT_UI_SCHEMA_VERSION
  );
}

/**
 * Future protocol data is unsupported when its version/renderer/kind is not
 * known, or when it already carries a quarantine marker from an older client.
 */
export function isUnsupportedIntelligentUiPayload(value: unknown): boolean {
  if (!isRecord(value) || value.type !== "intelligent_ui") return false;
  if (isQuarantinedUiPayload(value.unsupportedPayload)) return true;
  if (value.schemaVersion !== INTELLIGENT_UI_SCHEMA_VERSION) return true;
  if (value.renderer !== "native" && value.renderer !== "html") return true;
  if (
    value.renderer === "native" &&
    isUnsupportedNativeDefinition(value.definition)
  )
    return true;
  return false;
}

export function normalizeUiRevision(
  value: unknown,
  fallback: number,
  minimum: number,
): number {
  return Number.isSafeInteger(value) && Number(value) >= minimum
    ? Number(value)
    : fallback;
}

export function isSafeUiId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 240 &&
    !RESERVED_IDS.has(value)
  );
}

/**
 * Reports whether a private message/tree contains a quarantined block. This
 * is intentionally structural and does not inspect or parse the payload.
 */
export function hasUnsupportedUiContent(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasUnsupportedUiContent);
  if (!isRecord(value)) return false;
  if (isUnsupportedIntelligentUiPayload(value)) return true;
  return Object.values(value).some(hasUnsupportedUiContent);
}

/** A safe empty state for unsupported content; future fields never execute. */
export function unsupportedUiState(): JsonObject {
  return {};
}
