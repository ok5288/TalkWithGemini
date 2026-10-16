/** Provider failures shared by server dispatch and browser research callers. */
export type ModelErrorKind =
  | "offline"
  | "auth"
  | "rate_limit"
  | "model_not_found"
  | "timeout"
  | "network"
  | "unavailable";

export function getModelErrorStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const record = error as Record<string, unknown>;
  const status = record.statusCode ?? record.status;
  return typeof status === "number" ? status : undefined;
}

export function classifyModelError(error: unknown): ModelErrorKind {
  const status = getModelErrorStatus(error);
  const record =
    error && typeof error === "object"
      ? (error as Record<string, unknown>)
      : {};
  const text = `${record.code ?? ""} ${record.name ?? ""} ${record.message ?? ""}`;
  // Explicit provider rejections take precedence over the browser's online hint.
  if (
    status === 401 ||
    status === 403 ||
    /\b40[13]\b|unauthorized|forbidden|invalid.?api.?key|authentication|PROVIDER_AUTH/i.test(
      text,
    )
  )
    return "auth";
  if (
    status === 429 ||
    /\b429\b|rate.?limit|too many requests|quota/i.test(text)
  )
    return "rate_limit";
  if (
    status === 404 ||
    /\b404\b|model[_ ]not[_ ]found|model.*does not exist/i.test(text)
  )
    return "model_not_found";
  if (typeof navigator !== "undefined" && navigator.onLine === false)
    return "offline";
  if (status === 408 || status === 504 || /timeout|timed out/i.test(text))
    return "timeout";
  if (
    /network|failed to fetch|fetch failed|load failed|connection|socket|ECONN|ENOTFOUND|incomplete.*stream|stream ended/i.test(
      text,
    )
  )
    return "network";
  return "unavailable";
}

export function getResearchModelErrorCode(error: unknown): string {
  return `RESEARCH_MODEL_${classifyModelError(error).toUpperCase()}`;
}
