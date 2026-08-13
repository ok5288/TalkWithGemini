"use client";

import type { Attachment, Message } from "@/types";
import {
  API_INPUT_LIMITS,
  ATTACHMENT_LIMIT_HARD_MAX_FILE_BYTES,
  ATTACHMENT_LIMITS,
  IMAGE_ATTACHMENT_LIMITS,
} from "@/config/limits";
import { base64ToBytes, bytesToArrayBuffer } from "@/lib/utils/binary";
import { isOPFSUrl, resolveOPFSBlob } from "@/utils/opfs";
import {
  CHAT_IMAGE_UPLOAD_FIELD_PREFIX,
  CHAT_UPLOAD_PAYLOAD_FIELD,
} from "./chatUploadProtocol";

type ResolveOPFSBlob = (url: string) => Promise<Blob | null>;

interface ChatRequestPayload {
  history?: Message[];
  attachments?: Attachment[];
  [key: string]: unknown;
}

interface RequestBodyOptions {
  resolveOPFSBlob?: ResolveOPFSBlob;
  signal?: AbortSignal;
}

interface RequestBodyResult {
  body: BodyInit;
  headers?: HeadersInit;
}

interface PendingUpload {
  id: string;
  file: File;
}

type LocalImageAttachment = Attachment & { file?: File };
type WireAttachment = LocalImageAttachment & { uploadId?: string };

function createFile(blob: Blob, attachment: Attachment): File {
  return new File([blob], attachment.fileName, {
    type: attachment.mimeType || blob.type,
  });
}

function createInlineImageFile(attachment: Attachment): File {
  const bytes = base64ToBytes(attachment.data || "");
  return createFile(
    new Blob([bytesToArrayBuffer(bytes)], { type: attachment.mimeType }),
    attachment,
  );
}

function isLocalImageAttachment(attachment: Attachment): boolean {
  if (!attachment.mimeType.toLowerCase().startsWith("image/")) return false;
  const local = attachment as LocalImageAttachment;
  return Boolean(
    local.file || local.data || (local.url && isOPFSUrl(local.url)),
  );
}

function getUploadSourceKey(attachment: Attachment): string {
  if (attachment.url && isOPFSUrl(attachment.url)) {
    return `opfs:${attachment.url}`;
  }
  return `inline:${attachment.id}:${attachment.mimeType}:${attachment.fileName}:${attachment.data?.length || 0}`;
}

function stripLocalImageSource(
  attachment: LocalImageAttachment,
  uploadId: string,
): WireAttachment {
  const wire: WireAttachment = { ...attachment, uploadId };
  delete wire.file;
  delete wire.data;
  delete wire.url;
  delete wire.displayCache;
  return wire;
}

export async function createChatRequestBody<T extends ChatRequestPayload>(
  payload: T,
  options: RequestBodyOptions = {},
): Promise<RequestBodyResult> {
  const uploads: PendingUpload[] = [];
  let totalUploadBytes = 0;
  const uploadIdsBySource = new Map<string, string>();
  const uploadIdsByFile = new Map<File, string>();
  const readOPFSBlob = options.resolveOPFSBlob || resolveOPFSBlob;

  const prepareAttachment = async (
    attachment: LocalImageAttachment,
  ): Promise<WireAttachment> => {
    options.signal?.throwIfAborted();
    const withoutDisplayCache = { ...attachment };
    delete withoutDisplayCache.displayCache;
    if (!isLocalImageAttachment(withoutDisplayCache)) {
      return withoutDisplayCache;
    }

    const sourceKey = withoutDisplayCache.file
      ? undefined
      : getUploadSourceKey(withoutDisplayCache);
    const existingUploadId = withoutDisplayCache.file
      ? uploadIdsByFile.get(withoutDisplayCache.file)
      : uploadIdsBySource.get(sourceKey || "");
    if (existingUploadId) {
      return stripLocalImageSource(withoutDisplayCache, existingUploadId);
    }
    if (uploads.length >= ATTACHMENT_LIMITS.maxCount) {
      throw new Error("Too many local image attachments in this request.");
    }

    const blob =
      withoutDisplayCache.file ||
      (withoutDisplayCache.data
        ? createInlineImageFile(withoutDisplayCache)
        : await readOPFSBlob(withoutDisplayCache.url || ""));
    options.signal?.throwIfAborted();
    if (!blob) {
      throw new Error(
        `The local image "${withoutDisplayCache.fileName}" is no longer available. Please attach it again.`,
      );
    }
    if (blob.size > IMAGE_ATTACHMENT_LIMITS.maxRequestFileBytes) {
      throw new Error(
        `The prepared image "${withoutDisplayCache.fileName}" exceeds the file size limit.`,
      );
    }
    if (totalUploadBytes + blob.size > ATTACHMENT_LIMIT_HARD_MAX_FILE_BYTES) {
      throw new Error("The image attachments exceed the request size limit.");
    }

    const uploadId = `image-${uploads.length}`;
    if (withoutDisplayCache.file) {
      uploadIdsByFile.set(withoutDisplayCache.file, uploadId);
    } else if (sourceKey) {
      uploadIdsBySource.set(sourceKey, uploadId);
    }
    uploads.push({
      id: uploadId,
      file: createFile(blob, withoutDisplayCache),
    });
    totalUploadBytes += blob.size;
    return stripLocalImageSource(withoutDisplayCache, uploadId);
  };

  const prepareAttachments = async (
    attachments: Attachment[] | undefined,
  ): Promise<WireAttachment[] | undefined> => {
    if (!attachments) return undefined;
    const prepared: WireAttachment[] = [];
    for (const attachment of attachments) {
      prepared.push(
        await prepareAttachment(attachment as LocalImageAttachment),
      );
    }
    return prepared;
  };

  const history: Message[] | undefined = payload.history ? [] : undefined;
  for (const message of payload.history || []) {
    history?.push({
      ...message,
      attachments: await prepareAttachments(message.attachments),
    });
  }
  const attachments = await prepareAttachments(payload.attachments);
  const wirePayload = {
    ...payload,
    ...(history ? { history } : {}),
    ...(attachments ? { attachments } : {}),
  };

  if (uploads.length === 0) {
    return {
      body: JSON.stringify(wirePayload),
      headers: { "Content-Type": "application/json" },
    };
  }
  const payloadJson = JSON.stringify(wirePayload);
  if (
    totalUploadBytes +
      new TextEncoder().encode(payloadJson).byteLength +
      API_INPUT_LIMITS.maxMultipartOverheadBytes >
    API_INPUT_LIMITS.maxJsonBodyBytes
  ) {
    throw new Error("The chat request is too large.");
  }

  const formData = new FormData();
  formData.set(CHAT_UPLOAD_PAYLOAD_FIELD, payloadJson);
  for (const upload of uploads) {
    formData.set(
      `${CHAT_IMAGE_UPLOAD_FIELD_PREFIX}${upload.id}`,
      upload.file,
      upload.file.name,
    );
  }
  return { body: formData };
}
