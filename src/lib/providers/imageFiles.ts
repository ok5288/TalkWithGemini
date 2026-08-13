import type { Attachment, Message } from "@/types";
import { logDevWarn } from "@/lib/utils/devLogger";

export const ANTHROPIC_FILES_BETA = "files-api-2025-04-14";

export type ProviderImageAttachment = Attachment & {
  file?: File;
  providerFileId?: string;
  providerFileUri?: string;
};

interface PreparedProviderImageFiles {
  history: Message[];
  attachments: ProviderImageAttachment[];
  cleanup: () => Promise<void>;
}

interface UploadedImageReference {
  providerFileId?: string;
  providerFileUri?: string;
  mimeType?: string;
  cleanup?: () => Promise<unknown>;
}

type UploadImage = (
  attachment: ProviderImageAttachment,
) => Promise<UploadedImageReference>;

function isUploadedImageAttachment(
  attachment: ProviderImageAttachment,
): attachment is ProviderImageAttachment & { file: File } {
  return (
    attachment.mimeType.toLowerCase().startsWith("image/") &&
    attachment.file instanceof File
  );
}

async function prepareProviderImageFiles(
  history: Message[],
  attachments: ProviderImageAttachment[],
  upload: UploadImage,
): Promise<PreparedProviderImageFiles> {
  const referencesByFile = new Map<File, UploadedImageReference>();
  const cleanupCallbacks: Array<() => Promise<unknown>> = [];
  let cleanupPromise: Promise<void> | null = null;

  const prepareAttachment = async (
    attachment: ProviderImageAttachment,
  ): Promise<ProviderImageAttachment> => {
    if (!isUploadedImageAttachment(attachment)) return attachment;

    let reference = referencesByFile.get(attachment.file);
    if (!reference) {
      reference = await upload(attachment);
      referencesByFile.set(attachment.file, reference);
      if (reference.cleanup) cleanupCallbacks.push(reference.cleanup);
    }

    const prepared: ProviderImageAttachment = {
      ...attachment,
      ...(reference.mimeType ? { mimeType: reference.mimeType } : {}),
      ...(reference.providerFileId
        ? { providerFileId: reference.providerFileId }
        : {}),
      ...(reference.providerFileUri
        ? { providerFileUri: reference.providerFileUri }
        : {}),
    };
    delete prepared.file;
    delete prepared.data;
    delete prepared.url;
    return prepared;
  };

  const cleanup = () => {
    cleanupPromise ||= (async () => {
      const results = await Promise.allSettled(
        [...cleanupCallbacks].reverse().map((callback) => callback()),
      );
      for (const result of results) {
        if (result.status === "rejected") {
          logDevWarn(
            "Failed to remove a temporary provider image file",
            result.reason,
          );
        }
      }
    })();
    return cleanupPromise;
  };

  try {
    const preparedHistory: Message[] = [];
    for (const message of history) {
      const preparedAttachments: ProviderImageAttachment[] = [];
      for (const attachment of message.attachments || []) {
        preparedAttachments.push(
          await prepareAttachment(attachment as ProviderImageAttachment),
        );
      }
      preparedHistory.push({
        ...message,
        attachments:
          preparedAttachments.length > 0 ? preparedAttachments : undefined,
      });
    }

    const preparedAttachments: ProviderImageAttachment[] = [];
    for (const attachment of attachments) {
      preparedAttachments.push(await prepareAttachment(attachment));
    }

    return {
      history: preparedHistory,
      attachments: preparedAttachments,
      cleanup,
    };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

export async function uploadOpenAIImageFiles(
  client: any,
  history: Message[],
  attachments: ProviderImageAttachment[],
  signal?: AbortSignal,
): Promise<PreparedProviderImageFiles> {
  return prepareProviderImageFiles(history, attachments, async (attachment) => {
    const uploaded = await client.files.create(
      {
        file: attachment.file,
        purpose: "vision",
        expires_after: { anchor: "created_at", seconds: 3600 },
      },
      { signal },
    );
    return {
      providerFileId: uploaded.id,
      cleanup: () => client.files.delete(uploaded.id),
    };
  });
}

export async function uploadGoogleImageFiles(
  client: any,
  history: Message[],
  attachments: ProviderImageAttachment[],
  signal?: AbortSignal,
): Promise<PreparedProviderImageFiles> {
  return prepareProviderImageFiles(history, attachments, async (attachment) => {
    const uploaded = await client.files.upload({
      file: attachment.file,
      config: {
        mimeType: attachment.mimeType,
        displayName: attachment.fileName,
        abortSignal: signal,
      },
    });
    if (!uploaded.uri) {
      throw new Error("Google Files API did not return a file URI.");
    }
    return {
      providerFileUri: uploaded.uri,
      mimeType: uploaded.mimeType || attachment.mimeType,
    };
  });
}

export async function uploadAnthropicImageFiles(
  client: any,
  history: Message[],
  attachments: ProviderImageAttachment[],
  signal?: AbortSignal,
): Promise<PreparedProviderImageFiles> {
  return prepareProviderImageFiles(history, attachments, async (attachment) => {
    const uploaded = await client.beta.files.upload(
      {
        file: attachment.file,
        betas: [ANTHROPIC_FILES_BETA],
      },
      { signal },
    );
    return {
      providerFileId: uploaded.id,
      cleanup: () =>
        client.beta.files.delete(uploaded.id, {
          betas: [ANTHROPIC_FILES_BETA],
        }),
    };
  });
}

export function hasUploadedImageFiles(
  history: Message[],
  attachments: ProviderImageAttachment[],
): boolean {
  return [
    ...history.flatMap((message) => message.attachments || []),
    ...attachments,
  ].some((attachment) =>
    isUploadedImageAttachment(attachment as ProviderImageAttachment),
  );
}
