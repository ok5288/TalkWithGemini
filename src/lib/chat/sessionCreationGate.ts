/** Coordinates asynchronous preparation before synchronous session creation. */
export function createSessionCreationGate(deps: {
  selection: () => {
    currentSessionId: string | null;
    pendingSessionId: string | null;
    isActiveSessionLoading: boolean;
  };
  subscribe: (onChange: () => void) => () => void;
  waitForWrites: (sessionId: string) => Promise<void> | undefined;
}) {
  let intent = 0;
  return {
    cancel() {
      intent++;
    },
    async run<T>(
      prepare: () => Promise<T>,
      commit: (prepared: T) => void,
      onError: (error: unknown) => void,
    ): Promise<void> {
      const token = ++intent;
      const leaving = deps.selection();
      if (leaving.isActiveSessionLoading || leaving.pendingSessionId) return;
      let changed = false;
      const checkSelection = () => {
        const current = deps.selection();
        if (
          current.currentSessionId !== leaving.currentSessionId ||
          current.pendingSessionId !== leaving.pendingSessionId ||
          current.isActiveSessionLoading !== leaving.isActiveSessionLoading
        )
          changed = true;
      };
      const unsubscribe = deps.subscribe(checkSelection);
      const current = () => {
        checkSelection();
        return token === intent && !changed;
      };
      try {
        const prepared = await prepare();
        if (!current()) return;
        if (leaving.currentSessionId)
          await deps.waitForWrites(leaving.currentSessionId);
        if (!current()) return;
        commit(prepared);
      } catch (error) {
        if (current()) onError(error);
      } finally {
        unsubscribe();
      }
    },
  };
}
