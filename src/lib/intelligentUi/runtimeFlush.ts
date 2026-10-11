type Flusher = () => Promise<void>;
const sessions = new Map<string, Set<Flusher>>();

/** Active HTML transports own their registration; this module has no store access. */
export function registerHtmlRuntimeFlusher(sessionId: string, flush: Flusher) {
  const entries = sessions.get(sessionId) ?? new Set<Flusher>();
  entries.add(flush);
  sessions.set(sessionId, entries);
  return () => {
    entries.delete(flush);
    if (!entries.size && sessions.get(sessionId) === entries)
      sessions.delete(sessionId);
  };
}

/** A port ACK follows all buffered updates, which may then be durably drained. */
export function flushHtmlRuntimeUpdates(
  sessionId?: string,
): Promise<void> | undefined {
  const entries = sessionId
    ? [...(sessions.get(sessionId) ?? [])]
    : [...sessions.values()].flatMap((values) => [...values]);
  if (!entries.length) return undefined;
  return Promise.all(entries.map((flush) => flush())).then(() => undefined);
}
