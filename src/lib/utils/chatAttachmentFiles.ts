import {
  ATTACHMENT_LIMITS,
  IMAGE_ATTACHMENT_LIMITS,
  formatBytes,
} from "@/config/limits";

export interface ChatAttachmentFileCandidate {
  name: string;
  size: number;
  type?: string;
}

export interface ChatAttachmentFileSelection<
  T extends ChatAttachmentFileCandidate,
> {
  accepted: T[];
  rejectedByCount: T[];
  rejectedBySize: T[];
}

interface ChatAttachmentFileSelectionOptions {
  maxFileBytes?: number;
  maxImageFileBytes?: number;
}

type FileListLike = Iterable<File> | ArrayLike<File>;

const IMAGE_MIME_TYPES_BY_EXTENSION: Record<string, string> = {
  bmp: "image/bmp",
  gif: "image/gif",
  heic: "image/heic",
  heif: "image/heif",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

interface ClipboardItemLike {
  kind?: string;
  getAsFile?: () => File | null;
}

interface ClipboardDataLike {
  items?: ArrayLike<ClipboardItemLike> | null;
  files?: FileListLike | null;
}

interface DropDataLike {
  files?: FileListLike | null;
  items?: ArrayLike<ClipboardItemLike> | null;
}

function filesFromList(files: FileListLike | null | undefined): File[] {
  return files ? Array.from(files) : [];
}

function filesFromItems(
  items: ArrayLike<ClipboardItemLike> | null | undefined,
): File[] {
  if (!items) return [];

  return Array.from(items).flatMap((item) => {
    if (item.kind && item.kind !== "file") return [];
    const file = item.getAsFile?.();
    return file ? [file] : [];
  });
}

export function isHeicImageFile(
  candidate: Pick<ChatAttachmentFileCandidate, "name" | "type">,
): boolean {
  const mimeType = candidate.type?.trim().toLowerCase();
  return (
    mimeType === "image/heic" ||
    mimeType === "image/heif" ||
    mimeType === "image/heic-sequence" ||
    mimeType === "image/heif-sequence" ||
    /\.(?:heic|heif)$/i.test(candidate.name)
  );
}

export function getChatImageMimeType(
  candidate: Pick<ChatAttachmentFileCandidate, "name" | "type">,
): string | null {
  const mimeType = candidate.type?.trim().toLowerCase();
  if (mimeType?.startsWith("image/")) {
    return mimeType === "image/jpg" ? "image/jpeg" : mimeType;
  }

  const extension = candidate.name.split(".").pop()?.toLowerCase();
  return extension ? IMAGE_MIME_TYPES_BY_EXTENSION[extension] || null : null;
}

export function isChatImageFileCandidate(
  candidate: Pick<ChatAttachmentFileCandidate, "name" | "type">,
): boolean {
  return getChatImageMimeType(candidate) !== null;
}

function getCandidateMaxFileBytes(
  candidate: ChatAttachmentFileCandidate,
  options: ChatAttachmentFileSelectionOptions,
): number {
  if (isChatImageFileCandidate(candidate)) {
    return options.maxImageFileBytes ?? IMAGE_ATTACHMENT_LIMITS.maxSourceBytes;
  }
  return options.maxFileBytes ?? ATTACHMENT_LIMITS.maxFileBytes;
}

export function extractChatAttachmentFilesFromDrop(
  dataTransfer: DropDataLike,
): File[] {
  const files = filesFromList(dataTransfer.files);
  return files.length > 0 ? files : filesFromItems(dataTransfer.items);
}

export function extractChatAttachmentFilesFromClipboard(
  clipboardData: ClipboardDataLike,
): File[] {
  const itemFiles = filesFromItems(clipboardData.items);
  return itemFiles.length > 0 ? itemFiles : filesFromList(clipboardData.files);
}

export function selectChatAttachmentFiles<
  T extends ChatAttachmentFileCandidate,
>(
  existingCount: number,
  candidates: T[],
  options: ChatAttachmentFileSelectionOptions = {},
): ChatAttachmentFileSelection<T> {
  const accepted: T[] = [];
  const rejectedByCount: T[] = [];
  const rejectedBySize: T[] = [];
  for (const candidate of candidates) {
    if (candidate.size > getCandidateMaxFileBytes(candidate, options)) {
      rejectedBySize.push(candidate);
      continue;
    }

    if (existingCount + accepted.length >= ATTACHMENT_LIMITS.maxCount) {
      rejectedByCount.push(candidate);
      continue;
    }

    accepted.push(candidate);
  }

  return { accepted, rejectedByCount, rejectedBySize };
}

export function getChatAttachmentFileSelectionMessage(
  selection: Pick<
    ChatAttachmentFileSelection<ChatAttachmentFileCandidate>,
    "rejectedByCount" | "rejectedBySize"
  >,
  options: ChatAttachmentFileSelectionOptions = {},
): string {
  const messages: string[] = [];
  const maxFileBytes = options.maxFileBytes ?? ATTACHMENT_LIMITS.maxFileBytes;

  if (selection.rejectedByCount.length > 0) {
    messages.push(
      `Attachment limit reached (${ATTACHMENT_LIMITS.maxCount} max).`,
    );
  }

  if (selection.rejectedBySize.length === 1) {
    const rejected = selection.rejectedBySize[0];
    messages.push(
      `File "${rejected.name}" exceeds ${formatBytes(
        getCandidateMaxFileBytes(rejected, options),
      )}.`,
    );
  } else if (selection.rejectedBySize.length > 1) {
    const rejectedLimits = new Set(
      selection.rejectedBySize.map((candidate) =>
        getCandidateMaxFileBytes(candidate, options),
      ),
    );
    if (rejectedLimits.size === 1) {
      messages.push(
        `Skipped ${selection.rejectedBySize.length} file(s): each file must be ${formatBytes(
          [...rejectedLimits][0] ?? maxFileBytes,
        )} or smaller.`,
      );
    } else {
      messages.push(
        `Skipped ${selection.rejectedBySize.length} file(s): images must be ${formatBytes(
          options.maxImageFileBytes ?? IMAGE_ATTACHMENT_LIMITS.maxSourceBytes,
        )} or smaller, and other files must be ${formatBytes(
          maxFileBytes,
        )} or smaller.`,
      );
    }
  }

  return messages.join(" ");
}
