import type { ChatConfig } from "./types";
import type { ModelMetadata } from "@/types";
import { parseModelString, supportsToolCalls } from "../utils/model";
import { isReasoningEnabled, resolveReasoningModeForModel } from "./reasoning";

export function resolveEffectiveChatRequestConfig({
  chatConfig,
  selectedModel,
  modelMetadata,
  customModelMetadata,
  searchCompatibility,
}: {
  chatConfig: ChatConfig;
  selectedModel: string;
  modelMetadata: Record<string, ModelMetadata>;
  customModelMetadata: Record<string, ModelMetadata>;
  searchCompatibility?: { enabled: boolean };
}): ChatConfig {
  const { modelName: selectedModelId } = parseModelString(selectedModel);
  const selectedModelMetadata =
    customModelMetadata[selectedModelId] || modelMetadata[selectedModelId];
  const reasoningMode = resolveReasoningModeForModel(
    chatConfig.reasoningMode,
    selectedModelMetadata,
    chatConfig.useReasoning,
  );

  return {
    ...chatConfig,
    useSearch: chatConfig.useSearch && (searchCompatibility?.enabled ?? true),
    useAgentMode:
      chatConfig.useAgentMode === true &&
      supportsToolCalls(selectedModelMetadata),
    reasoningMode,
    useReasoning: isReasoningEnabled(reasoningMode),
  };
}
