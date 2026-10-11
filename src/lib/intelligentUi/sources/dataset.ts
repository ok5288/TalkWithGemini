import type { ExplorerDataset } from "@/lib/intelligentUi/explorer/types";
import { parseSourceDatasetContent } from "./content";
import { resolveUiSources, revalidateUiSources } from "./resolver";
import type {
  UiSourceBinding,
  UiSourceContext,
  UiSourceRequest,
} from "./types";

/** Context datasets are resolved locally from exact, authorized content only. */
export function resolveUiSourceDataset(
  request: UiSourceRequest,
  context: UiSourceContext,
  sessionId: string,
  pinnedBinding?: UiSourceBinding,
): {
  dataset: ExplorerDataset | null;
  binding: UiSourceBinding;
  error?: string;
} {
  const binding = pinnedBinding
    ? revalidateUiSources([pinnedBinding], context)[0]
    : resolveUiSources(
        [
          {
            alias: request.alias,
            version: request.version,
            locator: request.locator,
          },
        ],
        context,
        sessionId,
      )[0];
  if (
    context.sessionId !== sessionId ||
    !request.version ||
    binding.alias !== request.alias ||
    (request.version !== undefined && request.version !== binding.version) ||
    (request.locator !== undefined && request.locator !== binding.locator) ||
    binding.bindingStatus !== "resolved"
  )
    return {
      dataset: null,
      binding,
      error: `source.${binding.bindingStatus === "resolved" ? "unverified" : binding.bindingStatus}`,
    };
  const material = context.materials.get(binding.alias);
  if (!material?.content)
    return { dataset: null, binding, error: "source.unavailable" };
  const dataset = parseSourceDatasetContent(material.content);
  if (!dataset)
    return { dataset: null, binding, error: "source.invalid-dataset" };
  return {
    dataset: {
      ...dataset,
      id: binding.alias,
      version: material.contentHash,
    },
    binding,
  };
}
