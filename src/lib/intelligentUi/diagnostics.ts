import type { UiDiagnostic } from "./types";

const CODES = new Set<UiDiagnostic["code"]>([
  "incomplete",
  "invalid_json",
  "invalid_fields",
  "unsupported_version",
  "unsupported_kind",
  "html_policy",
]);

/** Restore a controlled reason without trusting free-text diagnostic fields. */
export function normalizeUiDiagnostic(
  value: unknown,
): UiDiagnostic | undefined {
  if (!value || typeof value !== "object") return undefined;
  const code = Object.getOwnPropertyDescriptor(value, "code")?.value;
  return CODES.has(code) ? { code } : undefined;
}
