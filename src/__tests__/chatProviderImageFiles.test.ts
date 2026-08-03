import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertProviderOutboundAllowed: vi.fn(),
  createOpenAIClient: vi.fn(),
  createAnthropicClient: vi.fn(),
  createGoogleClient: vi.fn(),
  uploadOpenAIImageFiles: vi.fn(),
  uploadAnthropicImageFiles: vi.fn(),
  uploadGoogleImageFiles: vi.fn(),
  streamOpenAIResponses: vi.fn(),
  streamAnthropicMessages: vi.fn(),
  streamGeminiResponse: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("../lib/providers/base", () => ({
  ProviderFactory: {
    assertProviderOutboundAllowed: mocks.assertProviderOutboundAllowed,
    createOpenAIClient: mocks.createOpenAIClient,
    createAnthropicClient: mocks.createAnthropicClient,
    createGoogleClient: mocks.createGoogleClient,
    getEffectiveBaseUrl: vi.fn((baseUrl) => baseUrl),
  },
}));

vi.mock("../lib/providers/imageFiles", () => ({
  ANTHROPIC_FILES_BETA: "files-api-2025-04-14",
  hasUploadedImageFiles: vi.fn(() => false),
  uploadOpenAIImageFiles: mocks.uploadOpenAIImageFiles,
  uploadAnthropicImageFiles: mocks.uploadAnthropicImageFiles,
  uploadGoogleImageFiles: mocks.uploadGoogleImageFiles,
}));

vi.mock("../lib/streaming/openai", () => ({
  streamOpenAIChatCompletions: vi.fn(),
  streamOpenAIResponses: mocks.streamOpenAIResponses,
}));

vi.mock("../lib/streaming/anthropic", async () => {
  const actual = await vi.importActual("../lib/streaming/anthropic");
  return {
    ...actual,
    streamAnthropicMessages: mocks.streamAnthropicMessages,
  };
});

vi.mock("../lib/streaming/gemini", () => ({
  streamGeminiResponse: mocks.streamGeminiResponse,
}));

const localImage = {
  id: "photo",
  mimeType: "image/jpeg",
  fileName: "photo.jpg",
  file: new File(["photo"], "photo.jpg", { type: "image/jpeg" }),
};

function preparedImage(reference: Record<string, string>) {
  return {
    history: [],
    attachments: [
      {
        id: "photo",
        mimeType: "image/jpeg",
        fileName: "photo.jpg",
        ...reference,
      },
    ],
    cleanup: vi.fn(async () => undefined),
  };
}

describe("chat provider image file wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertProviderOutboundAllowed.mockResolvedValue(undefined);
    mocks.createOpenAIClient.mockReturnValue({ provider: "openai" });
    mocks.createAnthropicClient.mockReturnValue({ provider: "anthropic" });
    mocks.createGoogleClient.mockReturnValue({ provider: "google" });
    mocks.streamOpenAIResponses.mockResolvedValue(undefined);
    mocks.streamAnthropicMessages.mockResolvedValue(undefined);
    mocks.streamGeminiResponse.mockResolvedValue(undefined);
  });

  it("uses native provider file references and cleans up request-scoped files", async () => {
    const openAI = preparedImage({ providerFileId: "file_openai" });
    const anthropic = preparedImage({ providerFileId: "file_anthropic" });
    const google = preparedImage({
      providerFileUri:
        "https://generativelanguage.googleapis.com/v1beta/files/google",
    });
    mocks.uploadOpenAIImageFiles.mockResolvedValue(openAI);
    mocks.uploadAnthropicImageFiles.mockResolvedValue(anthropic);
    mocks.uploadGoogleImageFiles.mockResolvedValue(google);

    const { handleChatStream } = await import("../lib/api/chat-handler");
    const requests = [
      handleChatStream({
        provider: { type: "OpenAI", apiKey: "key" },
        modelName: "gpt-test",
        history: [],
        newMessage: "Describe",
        attachments: [localImage] as any,
      }),
      handleChatStream({
        provider: { type: "Anthropic", apiKey: "key" },
        modelName: "claude-test",
        history: [],
        newMessage: "Describe",
        attachments: [localImage] as any,
      }),
      handleChatStream({
        provider: { type: "Google", apiKey: "key" },
        modelName: "gemini-test",
        history: [],
        newMessage: "Describe",
        attachments: [localImage] as any,
      }),
    ];
    await Promise.all(
      (await Promise.all(requests)).map((response) => response.text()),
    );

    expect(mocks.streamOpenAIResponses).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.arrayContaining([
          expect.objectContaining({
            content: expect.arrayContaining([
              expect.objectContaining({
                type: "input_image",
                file_id: "file_openai",
              }),
            ]),
          }),
        ]),
      }),
    );
    expect(mocks.streamAnthropicMessages).toHaveBeenCalledWith(
      expect.objectContaining({
        betas: ["files-api-2025-04-14"],
        messages: expect.arrayContaining([
          expect.objectContaining({
            content: expect.arrayContaining([
              expect.objectContaining({
                source: {
                  type: "file",
                  file_id: "file_anthropic",
                },
              }),
            ]),
          }),
        ]),
      }),
    );
    expect(mocks.streamGeminiResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        contents: expect.arrayContaining([
          expect.objectContaining({
            parts: expect.arrayContaining([
              expect.objectContaining({
                fileData: expect.objectContaining({
                  fileUri:
                    "https://generativelanguage.googleapis.com/v1beta/files/google",
                }),
              }),
            ]),
          }),
        ]),
      }),
    );
    expect(openAI.cleanup).toHaveBeenCalledOnce();
    expect(anthropic.cleanup).toHaveBeenCalledOnce();
    expect(google.cleanup).toHaveBeenCalledOnce();
  });
});
