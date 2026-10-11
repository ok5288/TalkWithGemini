import { beforeEach, describe, expect, it, vi } from "vitest";
import { runExternalSearchPreflight } from "@/services/api/chat/externalSearchPreflight";

const search = vi.hoisted(() => vi.fn());
vi.mock("@/services/api/searchService", () => ({
  createSearchProvider: search,
}));
vi.mock("@/services/api/chat/modelSelection", () => ({
  resolveTextGenerationModel: () => "provider/text-model",
  resolveModelMetadata: () => undefined,
}));
beforeEach(() => search.mockReset());

describe("UI authorization during search preparation", () => {
  it.each(["preflight", "decision", "search"])(
    "preserves the terminal authorization error during %s",
    async (stage) => {
      const error = Object.assign(new Error("Authorization expired"), {
        code: "UI_SOURCE_STALE",
      });
      let guardCalls = 0;
      const status = vi.fn();
      const update = vi.fn();
      await expect(
        runExternalSearchPreflight({
          model: "provider/text-model",
          modelName: "text-model",
          providers: [],
          history: [],
          newMessage: "Find sources",
          attachments: [],
          generate: async () => {
            if (stage === "decision") throw error;
            return JSON.stringify({ shouldSearch: true, query: "sources" });
          },
          beforeDispatch: async () => {
            guardCalls += 1;
            if (
              (stage === "preflight" && guardCalls === 1) ||
              (stage === "search" && guardCalls === 2)
            )
              throw error;
          },
          onSearchStatus: status,
          upsertSearchBlock: update,
          emitOutputBlocks: vi.fn(),
        }),
      ).rejects.toBe(error);
      expect(search).not.toHaveBeenCalled();
      expect(status).toHaveBeenLastCalledWith(false, {
        sources: [],
        images: [],
      });
      if (stage === "search")
        expect(update).toHaveBeenLastCalledWith({
          isSearching: false,
          results: { sources: [], images: [] },
        });
    },
  );
});
