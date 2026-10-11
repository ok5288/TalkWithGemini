import type { Message, Session, SessionMessageTree } from "@/types";
import { useChatStore } from "@/store/core/chatStore";
import { appDb } from "@/store/storage/storageConfig";
import { waitForSessionMessageWrites } from "@/store/sessionMessagePersistence";
import { createSessionExportPayload } from "@/lib/chat/sessionExport";

export async function readSessionForPresentation(
  session: Session,
  options: { flush?: boolean } = {},
) {
  if (options.flush !== false) await waitForSessionMessageWrites(session.id);
  const state = useChatStore.getState();
  return createSessionExportPayload({
    session,
    currentSessionId: state.currentSessionId,
    activeMessages: state.activeMessages,
    activeMessageTree:
      state.currentSessionId === session.id
        ? state.activeMessageTree
        : undefined,
    loadMessages: (id) =>
      appDb.getItem<Message[] | SessionMessageTree>(`session_messages_${id}`),
  });
}

/**
 * Read one rendered message only after the session's runtime and persistence
 * state have settled. Consumers that freeze a single-message export must use
 * this instead of the render-time prop: the latter can point at the message
 * from before an HTML runtime update was acknowledged.
 */
export async function readMessageForPresentation(
  sessionId: string,
  messageId: string,
  options: { flush?: boolean } = {},
): Promise<{ session: Session; message: Message }> {
  const state = useChatStore.getState();
  const session = state.sessions.find(
    (candidate) => candidate.id === sessionId,
  );
  if (!session) throw new Error("SESSION_NOT_FOUND");

  const snapshot = await readSessionForPresentation(session, options);
  const message = snapshot.messages.find(
    (candidate) => candidate.id === messageId,
  );
  if (!message) throw new Error("MESSAGE_NOT_FOUND");

  return { session: snapshot, message };
}
