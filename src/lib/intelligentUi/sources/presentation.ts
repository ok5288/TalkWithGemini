import { uiLabels } from "@/lib/intelligentUi/localization";
import type { UiSourceProjection } from "./types";

function escape(value: string) {
  return value.replace(/[\\`*_{}\[\]<>()#!|]/g, "\\$&").replace(/\r?\n/g, " ");
}

/** Receives a public projection, never an internal binding or raw source object. */
export function renderUiSourceSummary(
  sources: readonly UiSourceProjection[],
  locale = "en",
): string {
  if (!sources.length) return "";
  const labels = uiLabels(locale);
  return `${labels.sources}:\n${sources.map((source) => `- ${escape(source.title || labels.sourceTrace.private)}${source.version ? ` · ${labels.sourceTrace.version}: ${escape(source.version)}` : ""} · ${labels.sourceTrace[source.bindingStatus]}${source.url ? ` · ${escape(source.url)}` : ""}`).join("\n")}`;
}
