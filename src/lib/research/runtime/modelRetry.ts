import {
  classifyModelError,
  getModelErrorStatus,
} from "@/lib/chat/providerErrors";
import { isStructuredOutputCapabilityError } from "@/lib/chat/responseFormat";
import { runWithPreOutputRetry } from "@/lib/chat/streamResilience";

/** Only repeat requests that have not produced text or performed source/tool work. */
export async function runResearchModelWithRetry<T>({
  run,
  hasVisibleOutput = () => false,
  hasToolActivity = () => false,
  signal,
  onAttempt,
}: {
  run: (attempt: number) => Promise<T>;
  hasVisibleOutput?: () => boolean;
  hasToolActivity?: () => boolean;
  signal?: AbortSignal;
  onAttempt?: (attempt: number) => void;
}): Promise<T> {
  let blocked = false;
  let retryError: Error | undefined;
  let originalError: unknown;
  try {
    return await runWithPreOutputRetry({
      run: async (attempt) => {
        signal?.throwIfAborted();
        try {
          return await run(attempt);
        } catch (error) {
          const kind = classifyModelError(error);
          const status = getModelErrorStatus(error);
          blocked =
            signal?.aborted === true ||
            !(error instanceof Error) ||
            error.name === "AbortError" ||
            isStructuredOutputCapabilityError(error) ||
            ["auth", "rate_limit", "model_not_found", "offline"].includes(
              kind,
            ) ||
            (status !== undefined && status < 500 && status !== 408) ||
            (!["network", "timeout"].includes(kind) &&
              !(status !== undefined && status >= 500 && status <= 599) &&
              !/\b5\d\d\b|temporarily unavailable|service unavailable|bad gateway|overloaded/i.test(
                error.message,
              ));
          if (blocked) throw error;
          originalError = error;
          retryError = new Error("Temporary model connection failure", {
            cause: error,
          });
          throw retryError;
        }
      },
      hasVisibleOutput,
      hasToolActivity: () => blocked || hasToolActivity(),
      signal,
      onAttempt,
    });
  } catch (error) {
    throw error === retryError ? originalError : error;
  }
}
