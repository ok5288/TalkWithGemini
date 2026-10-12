import type { Attachment } from "@/lib/chat/types";

export const COMPOSER_DRAFT_EVENT = "neo-chat:composer-draft";

export interface ComposerUiSend {
  id: string;
  cancel: () => void;
}

export interface ComposerDraftRequest {
  sessionId: string;
  text: string;
  attachments?: Attachment[];
  intelligentUiSend?: ComposerUiSend;
}

/** Host-owned actions may stage a draft; this event never sends a message. */
export function requestComposerDraft(request: ComposerDraftRequest): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<ComposerDraftRequest>(COMPOSER_DRAFT_EVENT, {
      detail: request,
    }),
  );
}
