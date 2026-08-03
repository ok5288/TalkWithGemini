import {
  API_INPUT_LIMITS,
  ATTACHMENT_LIMIT_HARD_MAX_FILE_BYTES,
  ATTACHMENT_LIMITS,
  IMAGE_ATTACHMENT_LIMITS,
  getRuntimeMaxAttachmentFileBytes,
} from "@/config/limits";
import { PayloadTooLargeError, ValidationError } from "@/lib/errors";
import {
  assertMultipartRequestContentLengthUnderLimit,
  parseJsonFormValue,
  readJsonRequestBody,
} from "./middleware";
import {
  CHAT_IMAGE_UPLOAD_FIELD_PREFIX,
  CHAT_IMAGE_UPLOAD_ID_PATTERN,
  CHAT_UPLOAD_PAYLOAD_FIELD,
} from "./chatUploadProtocol";

export interface ChatRequestBody {
  payload: unknown;
  files: Map<string, File>;
}

const IMAGE_SIGNATURES: Record<string, (bytes: Uint8Array) => boolean> = {
  "image/jpeg": (bytes) =>
    bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
  "image/png": (bytes) =>
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a,
  "image/gif": (bytes) => {
    const header = new TextDecoder().decode(bytes.slice(0, 6));
    return header === "GIF87a" || header === "GIF89a";
  },
  "image/webp": (bytes) =>
    new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" &&
    new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP",
  "image/bmp": (bytes) => bytes[0] === 0x42 && bytes[1] === 0x4d,
};

function isMultipartRequest(request: Request): boolean {
  return (
    request.headers
      .get("content-type")
      ?.toLowerCase()
      .startsWith("multipart/form-data") === true
  );
}

export async function readChatRequestBody(
  request: Request,
): Promise<ChatRequestBody> {
  if (!isMultipartRequest(request)) {
    return { payload: await readJsonRequestBody(request), files: new Map() };
  }

  assertMultipartRequestContentLengthUnderLimit(
    request,
    API_INPUT_LIMITS.maxJsonBodyBytes,
  );
  const formData = await request.formData();
  const payloadValues = formData.getAll(CHAT_UPLOAD_PAYLOAD_FIELD);
  if (payloadValues.length !== 1) {
    throw new ValidationError("Exactly one chat payload is required");
  }
  const payload = parseJsonFormValue(payloadValues[0], "chat payload");
  if (payload === undefined) {
    throw new ValidationError("Missing chat payload");
  }

  const files = new Map<string, File>();
  for (const [field, value] of formData.entries()) {
    if (field === CHAT_UPLOAD_PAYLOAD_FIELD) continue;
    if (!field.startsWith(CHAT_IMAGE_UPLOAD_FIELD_PREFIX)) {
      throw new ValidationError(`Unexpected multipart field: ${field}`);
    }
    const uploadId = field.slice(CHAT_IMAGE_UPLOAD_FIELD_PREFIX.length);
    if (!CHAT_IMAGE_UPLOAD_ID_PATTERN.test(uploadId)) {
      throw new ValidationError("Invalid image upload identifier");
    }
    if (typeof value === "string") {
      throw new ValidationError("Image upload must be a file");
    }
    if (files.has(uploadId)) {
      throw new ValidationError("Duplicate image upload identifier");
    }
    files.set(uploadId, value);
  }

  if (files.size > ATTACHMENT_LIMITS.maxCount) {
    throw new ValidationError("Too many image uploads");
  }
  const totalFileBytes = [...files.values()].reduce(
    (total, file) => total + file.size,
    0,
  );
  if (totalFileBytes > ATTACHMENT_LIMIT_HARD_MAX_FILE_BYTES) {
    throw new PayloadTooLargeError("Image attachments are too large");
  }

  return { payload, files };
}

async function validateImageFile(
  file: File,
  mimeType: string,
  fileName: string,
): Promise<File> {
  if (file.size === 0) {
    throw new ValidationError(`Image "${fileName}" is empty`);
  }
  const maxFileBytes = Math.min(
    getRuntimeMaxAttachmentFileBytes(),
    IMAGE_ATTACHMENT_LIMITS.maxRequestFileBytes,
  );
  if (file.size > maxFileBytes) {
    throw new PayloadTooLargeError(`Image "${fileName}" is too large`);
  }

  const normalizedMimeType = mimeType.trim().toLowerCase();
  const matchesSignature = IMAGE_SIGNATURES[normalizedMimeType];
  if (!matchesSignature || file.type.toLowerCase() !== normalizedMimeType) {
    throw new ValidationError(`Unsupported image type for "${fileName}"`);
  }
  const header = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  if (!matchesSignature(header)) {
    throw new ValidationError(
      `Image content does not match its declared type: "${fileName}"`,
    );
  }

  return new File([file], fileName, { type: normalizedMimeType });
}

export async function hydrateChatImageUploads(
  payload: any,
  files: Map<string, File> = new Map(),
): Promise<any> {
  const referencedUploadIds = new Set<string>();
  const validatedFiles = new Map<string, File>();

  const hydrateAttachment = async (attachment: any) => {
    const uploadId = attachment?.uploadId;
    if (!uploadId) return attachment;
    if (
      typeof uploadId !== "string" ||
      !CHAT_IMAGE_UPLOAD_ID_PATTERN.test(uploadId)
    ) {
      throw new ValidationError("Invalid image upload identifier");
    }
    if (
      typeof attachment.mimeType !== "string" ||
      !attachment.mimeType.toLowerCase().startsWith("image/")
    ) {
      throw new ValidationError("Only image attachments may reference uploads");
    }
    if (attachment.data || attachment.url) {
      throw new ValidationError(
        "Uploaded image descriptors cannot include inline data or URLs",
      );
    }

    const uploaded = files.get(uploadId);
    if (!uploaded) {
      throw new ValidationError(`Missing image upload: ${uploadId}`);
    }
    referencedUploadIds.add(uploadId);
    let file = validatedFiles.get(uploadId);
    if (!file) {
      file = await validateImageFile(
        uploaded,
        attachment.mimeType,
        attachment.fileName,
      );
      validatedFiles.set(uploadId, file);
    }

    const hydrated = { ...attachment, file };
    delete hydrated.uploadId;
    return hydrated;
  };

  const history = Array.isArray(payload?.history)
    ? await Promise.all(
        payload.history.map(async (message: any) => ({
          ...message,
          attachments: Array.isArray(message.attachments)
            ? await Promise.all(message.attachments.map(hydrateAttachment))
            : message.attachments,
        })),
      )
    : payload?.history;
  const attachments = Array.isArray(payload?.attachments)
    ? await Promise.all(payload.attachments.map(hydrateAttachment))
    : payload?.attachments;

  for (const uploadId of files.keys()) {
    if (!referencedUploadIds.has(uploadId)) {
      throw new ValidationError(`Unreferenced image upload: ${uploadId}`);
    }
  }

  return { ...payload, history, attachments };
}
