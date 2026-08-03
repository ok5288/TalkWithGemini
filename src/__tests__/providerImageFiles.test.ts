import { describe, expect, it, vi } from "vitest";
import {
  ANTHROPIC_FILES_BETA,
  uploadAnthropicImageFiles,
  uploadGoogleImageFiles,
  uploadOpenAIImageFiles,
} from "../lib/providers/imageFiles";

const fileAttachment = () => ({
  id: "photo",
  mimeType: "image/jpeg",
  fileName: "photo.jpg",
  file: new File([new Uint8Array([0xff, 0xd8, 0xff])], "photo.jpg", {
    type: "image/jpeg",
  }),
});

describe("provider image files", () => {
  it("uploads OpenAI vision files and returns request-only file IDs", async () => {
    const create = vi.fn(async () => ({ id: "file_openai" }));
    const remove = vi.fn(async () => ({}));
    const prepared = await uploadOpenAIImageFiles(
      { files: { create, delete: remove } },
      [],
      [fileAttachment()],
    );

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        purpose: "vision",
        expires_after: { anchor: "created_at", seconds: 3600 },
      }),
      expect.anything(),
    );
    expect(prepared.attachments[0]).toMatchObject({
      providerFileId: "file_openai",
    });
    expect(prepared.attachments[0]).not.toHaveProperty("file");
    await prepared.cleanup();
    expect(remove).toHaveBeenCalledWith("file_openai");
  });

  it("uploads Google files and returns file URIs", async () => {
    const upload = vi.fn(async () => ({
      name: "files/google",
      uri: "https://generativelanguage.googleapis.com/v1beta/files/google",
      mimeType: "image/jpeg",
    }));
    const prepared = await uploadGoogleImageFiles(
      { files: { upload } },
      [],
      [fileAttachment()],
    );

    expect(prepared.attachments[0]).toMatchObject({
      providerFileUri:
        "https://generativelanguage.googleapis.com/v1beta/files/google",
      mimeType: "image/jpeg",
    });
    await prepared.cleanup();
  });

  it("uploads Anthropic beta files and deletes them after streaming", async () => {
    const upload = vi.fn(async () => ({ id: "file_anthropic" }));
    const remove = vi.fn(async () => ({}));
    const prepared = await uploadAnthropicImageFiles(
      { beta: { files: { upload, delete: remove } } },
      [],
      [fileAttachment()],
    );

    expect(upload).toHaveBeenCalledWith(
      expect.objectContaining({ betas: [ANTHROPIC_FILES_BETA] }),
      expect.anything(),
    );
    expect(prepared.attachments[0]).toMatchObject({
      providerFileId: "file_anthropic",
    });
    await prepared.cleanup();
    expect(remove).toHaveBeenCalledWith("file_anthropic", {
      betas: [ANTHROPIC_FILES_BETA],
    });
  });
});
