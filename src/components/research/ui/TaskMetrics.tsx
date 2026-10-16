"use client";

import React from "react";
import { useTranslations } from "next-intl";

import { InlineStatus } from "@/components/ui/primitives";

import type { ResearchTaskViewModel } from "../types";
export function ResearchSourceScope({ task }: { task: ResearchTaskViewModel }) {
  const t = useTranslations("Research");
  const scope = task.sourceScope;
  if (!scope) return null;
  const fetchEnabled = scope.toolIds.some(
    (toolId) => toolId === "fetch_url" || toolId.endsWith(":fetch_url"),
  );
  const entries = [
    scope.searchEnabled
      ? t("sourceScope.webSearchOn")
      : t("sourceScope.webSearchOff"),
    fetchEnabled ? t("sourceScope.fetchUrl") : null,
    scope.knowledgeCount > 0
      ? t("sourceScope.knowledge", { count: scope.knowledgeCount })
      : null,
    scope.attachmentCount > 0
      ? t("sourceScope.attachments", { count: scope.attachmentCount })
      : null,
    scope.workspaceCount > 0
      ? t("sourceScope.workspace", { count: scope.workspaceCount })
      : null,
    scope.pluginCount > 0
      ? t("sourceScope.plugins", { count: scope.pluginCount })
      : null,
  ].filter((entry): entry is string => Boolean(entry));

  return (
    <>
      <ul
        className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground"
        aria-label={t("sourceScope.label")}
      >
        {entries.map((entry) => (
          <li key={entry}>{entry}</li>
        ))}
      </ul>
      {!scope.searchEnabled ? (
        <InlineStatus tone="warning" className="mt-3">
          {t("sourceScope.searchWarning")}
        </InlineStatus>
      ) : null}
    </>
  );
}
