"use client";

import { useTranslations } from "next-intl";
import { projectUiSources } from "@/lib/intelligentUi/sources/resolver";
import type {
  UiSourceBinding,
  UiSourceContext,
} from "@/lib/intelligentUi/sources/types";

/** The caller supplies a freshly authorized context, never restored binding status. */
export default function SourceBindings({
  bindings,
  context,
}: {
  bindings: readonly UiSourceBinding[];
  context: UiSourceContext;
}) {
  const t = useTranslations("IntelligentUi");
  const sources = projectUiSources(bindings, context, {
    publicOnly: false,
    includeContent: true,
  });
  if (!sources.length) return null;
  return (
    <section
      className="mt-3 min-w-0 space-y-2 border-t border-border pt-3"
      aria-label={t("sourceTrace.title")}
    >
      <p className="text-xs text-muted-foreground">
        {t("sourceTrace.disclaimer")}
      </p>
      {sources.map((source, index) => (
        <details
          key={bindings[index].bindingId}
          className="min-w-0 rounded-lg border border-border px-3 py-2"
        >
          <summary className="cursor-pointer break-words text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {source.title || t("sourceTrace.private")} ·{" "}
            {t(`sourceTrace.${source.bindingStatus}`)}
          </summary>
          <dl className="mt-2 space-y-1 break-words text-xs text-muted-foreground">
            {source.version && (
              <div>
                <dt className="inline">{t("sourceTrace.version")}: </dt>
                <dd className="inline">{source.version}</dd>
              </div>
            )}
            <div>
              <dt className="inline">{t("sourceTrace.locator")}: </dt>
              <dd className="inline">
                {source.locator || t("sourceTrace.noLocator")}
              </dd>
            </div>
          </dl>
          {source.content && (
            <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs">
              {source.content.slice(0, 5000)}
              {source.content.length > 5000 ? "…" : ""}
            </pre>
          )}
          {source.url && (
            <a
              className="mt-2 inline-block break-all text-sm underline"
              href={source.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              {t("sourceTrace.open")}
            </a>
          )}
        </details>
      ))}
    </section>
  );
}
