import { isCheckpointQueryLedger } from "../checkpointCodec";
import {
  getCurrentResearchReportRunIds,
  isCommittedCheckpointToolCall,
  redactCheckpointText,
  sanitizeCheckpointToolCall,
  type ResearchTask,
  type SavedResearchCheckpoint,
} from "@/lib/research";
import { normalizeImageSource } from "@/lib/search/results";
import { readResearchCheckpointJson } from "./readLocalResearchJson";

export async function readCheckpoint(
  task: ResearchTask,
): Promise<SavedResearchCheckpoint | null> {
  const path = task.checkpoint?.historyPath;
  if (!path) return null;
  try {
    const result = await readResearchCheckpointJson(task.sessionId, path);
    if (!result.ok) return null;
    const parsed = result.value as SavedResearchCheckpoint;
    return parsed?.version === 1 &&
      parsed.taskId === task.id &&
      (parsed.researchRunId === undefined ||
        parsed.researchRunId === task.checkpoint?.researchRunId) &&
      (parsed.agentRunId === undefined ||
        parsed.agentRunId === getCurrentResearchReportRunIds(task).at(-1)) &&
      (parsed.streamCompleted === undefined ||
        typeof parsed.streamCompleted === "boolean") &&
      (parsed.executedQueries === undefined ||
        isCheckpointQueryLedger(parsed.executedQueries)) &&
      typeof parsed.prompt === "string" &&
      typeof parsed.partialContent === "string" &&
      typeof parsed.savedAt === "number" &&
      Number.isFinite(parsed.savedAt) &&
      Array.isArray(parsed.toolCalls) &&
      parsed.toolCalls.every(
        (call) =>
          call && typeof call.id === "string" && typeof call.name === "string",
      )
      ? {
          ...parsed,
          prompt: redactCheckpointText(parsed.prompt || ""),
          partialContent: redactCheckpointText(parsed.partialContent || ""),
          toolCalls: Array.isArray(parsed.toolCalls)
            ? parsed.toolCalls
                .filter(isCommittedCheckpointToolCall)
                .map(sanitizeCheckpointToolCall)
            : [],
          outputBlocks: [],
          ...(Array.isArray(parsed.imageSources)
            ? {
                imageSources: parsed.imageSources
                  // A checkpoint accumulates multiple searches and waves.
                  // Match the saved task/report capacity, not one search page.
                  .slice(0, 2_000)
                  .flatMap((image) => {
                    if (
                      !image ||
                      typeof image.id !== "string" ||
                      !image.id.trim() ||
                      typeof image.retrievedAt !== "number" ||
                      !Number.isFinite(image.retrievedAt) ||
                      image.retrievedAt < 0 ||
                      typeof image.researchRunId !== "string" ||
                      !image.researchRunId.trim()
                    )
                      return [];
                    const normalized = normalizeImageSource(image);
                    return normalized
                      ? [
                          {
                            ...normalized,
                            id: image.id.trim().slice(0, 240),
                            retrievedAt: image.retrievedAt,
                            researchRunId: image.researchRunId
                              .trim()
                              .slice(0, 240),
                          },
                        ]
                      : [];
                  }),
              }
            : { imageSources: [] }),
        }
      : null;
  } catch {
    return null;
  }
}
