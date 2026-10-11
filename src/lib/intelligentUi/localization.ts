import en from "@/i18n/locales/en/IntelligentUi.json";
import zh from "@/i18n/locales/zh/IntelligentUi.json";
import ja from "@/i18n/locales/ja/IntelligentUi.json";

/** Pure projection labels; callers supply the active UI locale. */
export function uiLabels(locale = "en"): typeof en {
  if (locale.startsWith("zh")) return zh;
  if (locale.startsWith("ja")) return ja;
  return en;
}
