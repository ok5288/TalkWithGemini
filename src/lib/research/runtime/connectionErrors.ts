import {
  classifyModelError,
  getModelErrorStatus,
} from "@/lib/chat/providerErrors";

export function isResearchConnectionError(error: unknown): boolean {
  const kind = classifyModelError(error);
  if (["offline", "network", "timeout"].includes(kind)) return true;
  if (kind !== "unavailable") return false;
  const status = getModelErrorStatus(error);
  if (status !== undefined && status >= 500 && status <= 599) return true;
  if (!(error instanceof Error)) return false;
  const code = "code" in error ? error.code : undefined;
  return (
    code === "PROVIDER_UNAVAILABLE" ||
    /\b50[023]\b|temporarily unavailable|service unavailable|bad gateway|overloaded/i.test(
      error.message,
    )
  );
}
