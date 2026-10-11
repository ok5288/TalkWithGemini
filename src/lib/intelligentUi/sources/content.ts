import { parseExplorerImport } from "@/lib/intelligentUi/explorer/import";
import { explorerDatasetSchema } from "@/lib/intelligentUi/explorer/schema";
import type { ExplorerDataset } from "@/lib/intelligentUi/explorer/types";

export function parseSourceDatasetContent(
  content: string,
): ExplorerDataset | null {
  if (content.length > 1_000_000) return null;
  const text = content.trim();
  if (text.startsWith("{")) {
    try {
      const parsed = explorerDatasetSchema.safeParse(JSON.parse(text));
      if (parsed.success) return parsed.data;
    } catch {
      return null;
    }
  }
  return parseExplorerImport(
    text,
    text.startsWith("[") || text.startsWith("{") ? "json" : "csv",
  ).dataset;
}
