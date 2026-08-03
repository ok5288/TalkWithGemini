import { NextRequest, NextResponse } from "next/server";
import { v7 as uuidv7 } from "uuid";
import {
  assertProviderOutboundAllowed,
  createGoogleClient,
} from "@/utils/apiHelpers";
import { createApiErrorResponse } from "@/lib/api/middleware";
import { ImageGenerateRequestSchema } from "@/lib/api/schemas";
import {
  hydrateChatImageUploads,
  readChatRequestBody,
} from "@/lib/api/chatMultipart";
import { safeFetchJson } from "@/lib/security/safeFetch";
import {
  getProviderApiKey,
  getSafeUrlPolicy,
  normalizeProviderBaseUrl,
} from "@/lib/security/urlPolicy";
import { resolveProviderRuntimeConfig } from "@/lib/byok/server";
import { normalizeGeneratedImageAttachments } from "@/lib/utils/generatedImages";
import { safeServerLogError } from "@/lib/utils/safeServerLog";
import {
  isGoogleProviderType,
  isOpenAIProviderType,
} from "@/lib/providers/providerTypes";
import { convertAttachmentsToGemini } from "@/lib/utils/attachments";
import {
  type ProviderImageAttachment,
  uploadGoogleImageFiles,
} from "@/lib/providers/imageFiles";

function appendOpenAIEditImages(
  formData: FormData,
  attachments: ProviderImageAttachment[],
) {
  const images = attachments.filter((attachment) =>
    attachment.mimeType.toLowerCase().startsWith("image/"),
  );
  if (images.length === 0) return false;

  for (const [index, attachment] of images.entries()) {
    if (!attachment.file) {
      throw new Error("Image editing requires uploaded image files.");
    }
    formData.append(
      "image",
      attachment.file,
      attachment.fileName || `edit-source-${index + 1}.png`,
    );
  }

  return true;
}

export async function POST(request: NextRequest) {
  try {
    const requestBody = await readChatRequestBody(request);
    const body = await hydrateChatImageUploads(
      ImageGenerateRequestSchema.parse(requestBody.payload),
      requestBody.files,
    );
    const { modelName, prompt, imageCount, attachments } = body;
    const provider = await resolveProviderRuntimeConfig(body.provider);

    if (isOpenAIProviderType(provider.type)) {
      const apiKey = getProviderApiKey(provider);
      if (!apiKey) {
        return NextResponse.json(
          { error: "OpenAI API key is not configured" },
          { status: 401 },
        );
      }
      const baseUrl = normalizeProviderBaseUrl(provider.baseUrl, provider.type);
      const isEditRequest = Boolean(attachments?.length);
      const url = `${baseUrl}/images/${isEditRequest ? "edits" : "generations"}`;
      const shouldRequestBase64Response = provider.type === "OpenAI";
      const requestOptions = {
        policy: getSafeUrlPolicy("provider"),
        timeoutMs: 120_000,
        maxResponseBytes: 36 * 1024 * 1024,
      };

      const { response, data } = isEditRequest
        ? await (async () => {
            const formData = new FormData();
            formData.append("model", modelName);
            formData.append("prompt", prompt);
            if (imageCount) formData.append("n", String(imageCount));
            formData.append("size", "1024x1024");
            if (shouldRequestBase64Response) {
              formData.append("response_format", "b64_json");
            }
            if (
              !appendOpenAIEditImages(
                formData,
                (attachments || []) as ProviderImageAttachment[],
              )
            ) {
              throw new Error("Image editing requires at least one image.");
            }
            return safeFetchJson<any>(
              url,
              {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${apiKey}`,
                },
                body: formData,
                signal: request.signal,
              },
              requestOptions,
            );
          })()
        : await safeFetchJson<any>(
            url,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${apiKey}`,
              },
              body: JSON.stringify({
                model: modelName,
                prompt: prompt,
                ...(imageCount ? { n: imageCount } : {}),
                size: "1024x1024",
                ...(shouldRequestBase64Response
                  ? { response_format: "b64_json" }
                  : {}),
              }),
              signal: request.signal,
            },
            requestOptions,
          );

      if (!response.ok) {
        throw new Error(
          `OpenAI Image Error: ${data.error?.message || response.statusText}`,
        );
      }

      if (data.data && data.data.length > 0) {
        const images = normalizeGeneratedImageAttachments(
          data.data.map((item: any) => ({
            id: uuidv7(),
            mimeType: "image/png",
            data: item.b64_json,
            url: item.url,
            fileName: `generated-${Date.now()}.png`,
          })),
        );

        if (images.length > 0) {
          return NextResponse.json({
            images,
            message: `${isEditRequest ? "Edited" : "Generated"} ${images.length} image(s) for prompt: "${prompt}"`,
          });
        }
      }

      return NextResponse.json({
        images: [],
        message: "No images generated.",
      });
    } else if (isGoogleProviderType(provider.type)) {
      // Google
      await assertProviderOutboundAllowed(provider, request.signal);
      const ai = createGoogleClient(provider);

      if (attachments?.length) {
        const prepared = await uploadGoogleImageFiles(
          ai,
          [],
          attachments as ProviderImageAttachment[],
          request.signal,
        );
        try {
          const response: any = await ai.models.generateContent({
            model: modelName,
            contents: {
              parts: [
                { text: prompt },
                ...(convertAttachmentsToGemini(prepared.attachments) as any[]),
              ],
            },
            config: {
              responseModalities: ["TEXT", "IMAGE"],
              abortSignal: request.signal,
            },
          });
          const parts = response.candidates?.[0]?.content?.parts || [];
          const images = normalizeGeneratedImageAttachments(
            parts
              .filter((part: any) => part.inlineData)
              .map((part: any) => ({
                id: uuidv7(),
                mimeType: part.inlineData.mimeType || "image/png",
                data: part.inlineData.data,
                fileName: `gemini-edit-${Date.now()}.png`,
              })),
          );
          const text = parts
            .map((part: any) =>
              typeof part.text === "string" ? part.text : "",
            )
            .join("")
            .trim();

          if (images.length > 0) {
            return NextResponse.json({
              images,
              message: text || `Generated image for: "${prompt}"`,
            });
          }

          return NextResponse.json({
            images: [],
            message: text || "No images generated.",
          });
        } finally {
          await prepared.cleanup();
        }
      }

      const response: any = await ai.models.generateImages({
        model: modelName,
        prompt: prompt,
        config: {
          ...(imageCount ? { numberOfImages: imageCount } : {}),
          aspectRatio: "1:1",
          abortSignal: request.signal,
        },
      });

      if (response.generatedImages && response.generatedImages.length > 0) {
        const images = normalizeGeneratedImageAttachments(
          response.generatedImages.map((img: any) => ({
            id: uuidv7(),
            mimeType: img.image?.mimeType || "image/png",
            data: img.image?.imageBytes,
            fileName: `imagen-${Date.now()}.png`,
          })),
        );

        if (images.length > 0) {
          return NextResponse.json({
            images,
            message: `Generated image for: "${prompt}"`,
          });
        }
      }

      return NextResponse.json({
        images: [],
        message: "No images generated.",
      });
    }

    return NextResponse.json(
      { error: `${provider.type} does not support image generation` },
      { status: 400 },
    );
  } catch (error: any) {
    if (
      request.signal.aborted ||
      (error instanceof Error && error.name === "AbortError")
    ) {
      return new Response(null, { status: 499 });
    }
    safeServerLogError("Image generation error:", error);
    if (error instanceof Error && error.name === "ZodError") {
      return createApiErrorResponse(error, "Invalid image generation request");
    }
    return createApiErrorResponse(error, "Image generation failed");
  }
}
