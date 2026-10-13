/** A location never owns domain state. It holds an exclusive, revocable display grant. */
export interface UiDisplayTarget {
  sessionId: string;
  messageId: string;
  blockId: string;
  definitionRevision: number;
}
export type UiDisplayLocation = "inline" | "viewer";
export interface UiDisplayAdapter {
  eligible(): boolean;
  pendingImport(): boolean;
  ready?(): boolean;
  /** Must return only after the actual transport has been disposed. */
  release(): void;
}
export const uiDisplayKey = (target: UiDisplayTarget) =>
  JSON.stringify([
    target.sessionId,
    target.messageId,
    target.blockId,
    target.definitionRevision,
  ]);

type Owner = {
  id: symbol;
  target: UiDisplayTarget;
  location: UiDisplayLocation;
  adapter: UiDisplayAdapter;
  paused: boolean;
  epoch: number;
  mountEpoch: number;
};
export interface UiDisplaySnapshot {
  viewer: UiDisplayTarget | null;
  transitioning: boolean;
  error: "save" | "import" | null;
  revision: number;
}

export function createUiDisplayOwnership(options: {
  flush(sessionId: string): Promise<void> | undefined;
  valid(target: UiDisplayTarget): boolean;
}) {
  const owners = new Map<string, Owner>();
  const listeners = new Set<() => void>();
  let snapshot: UiDisplaySnapshot = {
    viewer: null,
    transitioning: false,
    error: null,
    revision: 0,
  };
  let operation = 0;
  let nextEpoch = 0;
  const emit = (patch: Partial<UiDisplaySnapshot> = {}) => {
    snapshot = { ...snapshot, ...patch, revision: snapshot.revision + 1 };
    listeners.forEach((listener) => listener());
  };
  const desired = (target: UiDisplayTarget): UiDisplayLocation =>
    snapshot.viewer && uiDisplayKey(snapshot.viewer) === uiDisplayKey(target)
      ? "viewer"
      : "inline";
  const dispose = (owner: Owner) => {
    owner.paused = true;
    owner.epoch = ++nextEpoch;
    // Explicit release is essential: React parent cleanup is not child effect cleanup.
    owner.adapter.release();
    if (owners.get(uiDisplayKey(owner.target)) === owner)
      owners.delete(uiDisplayKey(owner.target));
  };
  const api = {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => snapshot,
    register(
      target: UiDisplayTarget,
      location: UiDisplayLocation,
      adapter: UiDisplayAdapter,
      id = Symbol(),
    ) {
      const key = uiDisplayKey(target);
      if (
        !snapshot.transitioning &&
        desired(target) === location &&
        !owners.has(key) &&
        adapter.eligible() &&
        options.valid(target)
      ) {
        owners.set(key, {
          id,
          target,
          location,
          adapter,
          paused: false,
          epoch: ++nextEpoch,
          mountEpoch: nextEpoch,
        });
        emit();
      }
      const grant = {
        owns: () => owners.get(key)?.id === id,
        epoch: () =>
          owners.get(key)?.id === id ? owners.get(key)!.mountEpoch : 0,
        interactive: () => {
          const owner = owners.get(key);
          return (
            owner?.id === id &&
            !owner.paused &&
            adapter.eligible() &&
            options.valid(target)
          );
        },
        captureInteraction() {
          const epoch = owners.get(key)?.epoch;
          return () => owners.get(key)?.epoch === epoch && grant.interactive();
        },
        unregister() {
          const owner = owners.get(key);
          if (owner?.id !== id) return;
          dispose(owner);
          emit();
        },
      };
      return grant;
    },
    inspect(target: UiDisplayTarget, id: symbol) {
      const owner = owners.get(uiDisplayKey(target));
      return owner?.id === id
        ? { owns: true, paused: owner.paused, epoch: owner.mountEpoch }
        : { owns: false, paused: false, epoch: 0 };
    },
    async move(target: UiDisplayTarget | null): Promise<boolean> {
      if (snapshot.transitioning) return false;
      const previous = snapshot.viewer;
      if (
        (target && !options.valid(target)) ||
        (target && previous && uiDisplayKey(target) === uiDisplayKey(previous))
      )
        return false;
      const affected = [previous, target].filter(
        (item): item is UiDisplayTarget => !!item,
      );
      const releasing = [
        ...new Set(
          affected
            .map((item) => owners.get(uiDisplayKey(item)))
            .filter((item): item is Owner => !!item),
        ),
      ];
      if (releasing.some((owner) => owner.adapter.ready?.() === false))
        return false;
      if (releasing.some((owner) => owner.adapter.pendingImport())) {
        emit({ error: "import" });
        return false;
      }
      if (target && !owners.get(uiDisplayKey(target))?.adapter.eligible())
        return false;
      const token = ++operation;
      releasing.forEach((owner) => {
        owner.paused = true;
        owner.epoch = ++nextEpoch;
      });
      emit({ transitioning: true, error: null });
      const valid = () =>
        token === operation &&
        affected.every(options.valid) &&
        releasing.every(
          (owner) =>
            owners.get(uiDisplayKey(owner.target)) === owner &&
            owner.adapter.eligible(),
        );
      try {
        for (const session of new Set(affected.map((item) => item.sessionId)))
          await options.flush(session);
        if (!valid()) throw new Error("display_invalidated");
        releasing.forEach(dispose);
        emit({ viewer: target, transitioning: false, error: null });
        return true;
      } catch {
        if (token !== operation) return false;
        releasing.forEach((owner) => {
          if (owners.get(uiDisplayKey(owner.target)) === owner)
            owner.paused = false;
        });
        emit({ transitioning: false, error: "save" });
        api.revalidate();
        return false;
      }
    },
    revalidate() {
      let changed = false;
      let viewerInvalid = !!snapshot.viewer && !options.valid(snapshot.viewer);
      for (const owner of owners.values()) {
        if (!options.valid(owner.target) || !owner.adapter.eligible()) {
          if (
            snapshot.viewer &&
            uiDisplayKey(owner.target) === uiDisplayKey(snapshot.viewer)
          )
            viewerInvalid = true;
          dispose(owner);
          changed = true;
        }
      }
      if (viewerInvalid || (changed && snapshot.transitioning)) {
        operation++;
        owners.forEach((owner) => {
          owner.paused = false;
        });
        emit({
          ...(viewerInvalid ? { viewer: null } : {}),
          transitioning: false,
          error: null,
        });
      } else if (changed) emit();
    },
    destroy() {
      operation++;
      [...owners.values()].forEach(dispose);
      emit({ viewer: null, transitioning: false, error: null });
    },
  };
  return api;
}
export type UiDisplayOwnership = ReturnType<typeof createUiDisplayOwnership>;
export type UiDisplayGrant = ReturnType<UiDisplayOwnership["register"]>;
