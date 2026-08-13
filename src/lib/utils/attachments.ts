/**
 * 附件处理工具
 */

import type { Attachment } from "@/types";
import {
  appendPromptContextFile,
  createPromptContextBudget,
} from "./promptContext";
import { withResolvedObjectUrl } from "./objectUrlLifecycle";
import { logDevError } from "./devLogger";
import {
  decodeBase64Text,
  isTextDocumentMimeType,
} from "./documentAttachments";
import {
  stripAttachmentDisplayCacheForModel,
  stripAttachmentsDisplayCacheForModel,
} from "./imageDisplayCache";
import {
  isKnowledgeAttachment,
  isKnowledgeCollectionAttachment,
  parseKnowledgeFileAttachmentData,
} from "./knowledgeAttachments";

type ProviderImageAttachment = Attachment & {
  providerFileId?: string;
  providerFileUri?: string;
};

/**
 * 将附件转换为 Gemini 格式
 */
export function convertAttachmentsToGemini(attachments: Attachment[]) {
  return attachments
    .map((attachment) => {
      const att = attachment as ProviderImageAttachment;
      if (att.providerFileUri) {
        return {
          fileData: {
            mimeType: att.mimeType,
            fileUri: att.providerFileUri,
          },
        };
      }
      if (att.url) {
        return {
          fileData: {
            mimeType: att.mimeType,
            fileUri: att.url,
          },
        };
      }

      if (att.mimeType.toLowerCase().startsWith("image/")) return null;

      return {
        inlineData: {
          mimeType: att.mimeType,
          data: att.data || "",
        },
      };
    })
    .filter(Boolean);
}

/**
 * 将附件转换为 OpenAI 格式
 */
export function convertAttachmentsToOpenAI(attachments: Attachment[]) {
  return attachments
    .map((attachment) => {
      const att = attachment as ProviderImageAttachment;
      if (att.mimeType.startsWith("image/")) {
        if (!att.url) return null;
        return {
          type: "image_url" as const,
          image_url: { url: att.url },
        };
      }

      // 其他类型暂不支持
      return null;
    })
    .filter(Boolean);
}

/**
 * 将附件转换为 OpenAI Responses API 输入格式
 */
export function convertAttachmentsToOpenAIResponses(attachments: Attachment[]) {
  return attachments
    .map((attachment) => {
      const att = attachment as ProviderImageAttachment;
      if (att.mimeType.startsWith("image/")) {
        if (att.providerFileId) {
          return {
            type: "input_image" as const,
            file_id: att.providerFileId,
            detail: "auto" as const,
          };
        }
        if (!att.url) return null;
        return {
          type: "input_image" as const,
          image_url: att.url,
        };
      }

      return null;
    })
    .filter(Boolean);
}

/**
 * 将附件转换为 Anthropic Messages API 输入格式
 */
export function convertAttachmentsToAnthropic(attachments: Attachment[]) {
  return attachments
    .map((attachment) => {
      const att = attachment as ProviderImageAttachment;
      if (!att.mimeType.startsWith("image/")) return null;

      if (att.providerFileId) {
        return {
          type: "image" as const,
          source: {
            type: "file" as const,
            file_id: att.providerFileId,
          },
        };
      }

      if (att.url) {
        return {
          type: "image" as const,
          source: {
            type: "url" as const,
            url: att.url,
          },
        };
      }

      return null;
    })
    .filter(Boolean);
}

/**
 * 检查附件是否为图片
 */
export function isImageAttachment(attachment: Attachment): boolean {
  return attachment.mimeType.startsWith("image/");
}

/**
 * 检查附件是否为音频
 */
export function isAudioAttachment(attachment: Attachment): boolean {
  return attachment.mimeType.startsWith("audio/");
}

/**
 * 获取附件大小（字节）
 */
export function getAttachmentSize(attachment: Attachment): number {
  if (attachment.data) {
    // Base64 编码后的大小约为原始大小的 4/3
    return Math.ceil((attachment.data.length * 3) / 4);
  }
  return 0;
}

/**
 * 验证附件大小
 */
export function validateAttachmentSize(
  attachment: Attachment,
  maxSize: number = 10 * 1024 * 1024, // 10MB
): boolean {
  return getAttachmentSize(attachment) <= maxSize;
}

/**
 * Process non-KB attachments for model consumption
 */
export async function processAttachmentsForModel(
  attachments: Attachment[],
  supportAttachment: boolean,
  resolveOPFSUrl: (path: string) => Promise<string | null>,
): Promise<{
  finalAttachments: Attachment[];
  convertedContent: string;
}> {
  const finalAttachments: Attachment[] = [];
  let convertedContent = "";
  const contextBudget = createPromptContextBudget();

  for (const att of attachments) {
    const processedAtt = await stripAttachmentDisplayCacheForModel(att, {
      resolveOPFSBlob: async (path) => {
        const resolvedBlob = await withResolvedObjectUrl({
          source: path,
          resolveObjectUrl: resolveOPFSUrl,
          read: async (blobUrl) => {
            const response = await fetch(blobUrl);
            return response.blob();
          },
        });
        return resolvedBlob;
      },
    });

    if (processedAtt.mimeType.startsWith("image/")) {
      finalAttachments.push(processedAtt);
      continue;
    }

    // Resolve OPFS URLs to Base64
    if (
      processedAtt.url &&
      !processedAtt.url.startsWith("http") &&
      !processedAtt.data
    ) {
      try {
        const resolvedBlob = await withResolvedObjectUrl({
          source: processedAtt.url,
          resolveObjectUrl: resolveOPFSUrl,
          read: async (blobUrl) => {
            const response = await fetch(blobUrl);
            return response.blob();
          },
        });

        if (resolvedBlob) {
          const base64 = await new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () =>
              resolve((reader.result as string).split(",")[1]);
            reader.readAsDataURL(resolvedBlob);
          });
          processedAtt.data = base64;
          delete processedAtt.url;
        }
      } catch (e) {
        logDevError("Failed to read attachment content", e);
      }
    }

    if (
      processedAtt.mimeType.startsWith("audio/") ||
      processedAtt.mimeType.startsWith("video/")
    ) {
      finalAttachments.push(processedAtt);
      continue;
    }

    const isTextType = isTextDocumentMimeType(processedAtt.mimeType);
    if (isTextType && processedAtt.data) {
      try {
        const decodedContent = decodeBase64Text(processedAtt.data);
        const parts: string[] = [];
        appendPromptContextFile(parts, contextBudget, {
          fileName: processedAtt.fileName,
          mimeType: processedAtt.mimeType,
          content: decodedContent,
        });
        convertedContent += parts.join("");
        continue;
      } catch (e) {
        logDevError("Failed to decode text file attachment", e);
      }
    }

    if (processedAtt.url || supportAttachment) {
      finalAttachments.push(processedAtt);
    }
  }

  return { finalAttachments, convertedContent };
}

/**
 * Separate Knowledge Base attachments from other attachments
 */
export function separateKBAttachments(attachments: Attachment[]): {
  kbAttachments: Attachment[];
  otherAttachments: Attachment[];
} {
  const kbAttachments = attachments.filter(isKnowledgeAttachment);
  const otherAttachments = attachments.filter((a) => !isKnowledgeAttachment(a));

  return { kbAttachments, otherAttachments };
}

export {
  isKnowledgeAttachment,
  isKnowledgeCollectionAttachment,
  parseKnowledgeFileAttachmentData,
  stripAttachmentsDisplayCacheForModel,
};
