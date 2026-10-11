import { describe, expect, it, vi } from "vitest";
import {
  generateImage,
  type ImageGenerationRuntime,
} from "@/lib/chat/generateImage";

describe("host authorization at direct image SDK boundaries", () => {
  it("blocks Google generation after a completed upload revokes authority", async () => {
    let allowed = true;
    const generateContent = vi.fn();
    const runtime: ImageGenerationRuntime = {
      assertOutboundAllowed: async () => undefined,
      beforeDispatch: async () => {
        if (!allowed) throw new Error("UI_SOURCE_STALE");
      },
      createGoogleClient: () =>
        ({
          files: {
            upload: async () => {
              allowed = false;
              return { uri: "https://example.com/file" };
            },
          },
          models: { generateContent },
        }) as never,
      fetchJson: vi.fn(),
    };
    await expect(
      generateImage(
        {
          provider: { type: "Google", apiKey: "test" },
          modelName: "gemini-image",
          prompt: "frozen source",
          attachments: [
            {
              id: "image",
              mimeType: "image/png",
              fileName: "image.png",
              file: new File(["image"], "image.png", { type: "image/png" }),
            },
          ],
        },
        runtime,
      ),
    ).rejects.toThrow("UI_SOURCE_STALE");
    expect(generateContent).not.toHaveBeenCalled();
  });
});
