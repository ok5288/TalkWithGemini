import type { ResearchTaskRepositoryFallbackReason } from "./types";

export type ResearchPersistenceFailure =
  | ResearchTaskRepositoryFallbackReason
  | "validation"
  | "conflict"
  | "report_verification"
  | "checkpoint";
export class ResearchPersistenceError extends Error {
  constructor(
    public readonly reason: ResearchPersistenceFailure,
    message?: string,
  ) {
    super(message ?? `Research persistence failed: ${reason}`);
    this.name = "ResearchPersistenceError";
  }
}
export function classifyResearchStorageFailure(
  error: unknown,
): ResearchTaskRepositoryFallbackReason {
  if (
    error instanceof ResearchPersistenceError &&
    error.reason !== "validation" &&
    error.reason !== "conflict" &&
    error.reason !== "report_verification" &&
    error.reason !== "checkpoint"
  )
    return error.reason;
  const name = error instanceof Error ? error.name : "";
  if (name === "QuotaExceededError") return "quota";
  if (name === "SecurityError" || name === "NotSupportedError")
    return "indexeddb_unavailable";
  return "indexeddb_operation_failed";
}
