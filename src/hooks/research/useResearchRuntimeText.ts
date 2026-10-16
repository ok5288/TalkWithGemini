import { classifyModelError } from "@/lib/chat/providerErrors";
import { ResearchPersistenceError } from "@/services/research/taskRepository/errors";
import { useCallback, useMemo } from "react";
import { useTranslations } from "next-intl";

import type {
  ResearchRuntimeErrorText,
  ResearchTranslate,
} from "@/lib/research/runtime/executionContext";
import type { ResearchDependencyText } from "@/lib/research/runtime/taskContext";

/**
 * The localized strings the runtime needs outside React: one translator shared
 * by every runtime hook, plus the two lookup helpers threaded into the modules
 * under `runtime/`.
 */
export function useResearchRuntimeText(): {
  t: ResearchTranslate;
  localizedRuntimeError: ResearchRuntimeErrorText;
  dependencyText: ResearchDependencyText;
} {
  const t = useTranslations("Research");
  const localizedRuntimeError = useCallback<ResearchRuntimeErrorText>(
    (error) => {
      if (
        error instanceof Error &&
        error.cause instanceof ResearchPersistenceError
      )
        error = error.cause;
      return error instanceof ResearchPersistenceError
        ? t(`runtime.error.storage.${error.reason}`)
        : error instanceof Error &&
            error.message === t("runtime.error.persistence")
          ? error.message
          : t(`runtime.error.${classifyModelError(error)}`);
    },
    [t],
  );
  const dependencyText = useMemo(
    () => ({
      offline: t("runtime.dependency.offline"),
      modelUnavailable: t("runtime.dependency.modelUnavailable"),
      toolCallingUnavailable: t("runtime.dependency.toolCallingUnavailable"),
      searchUnavailable: t("runtime.dependency.searchUnavailable"),
      searchDisabled: t("runtime.dependency.searchDisabled"),
      checkpointUnavailable: t("runtime.dependency.checkpointUnavailable"),
      sourceUnavailable: (source: string) =>
        t("runtime.dependency.sourceUnavailable", { source }),
    }),
    [t],
  );
  return { t, localizedRuntimeError, dependencyText };
}
