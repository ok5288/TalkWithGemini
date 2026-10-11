import {
  assertAppDataWritesAllowed,
  runWithAppDataWriteLock,
} from "@/lib/data/appRestoreJournal";
import { flushHtmlRuntimeUpdates } from "@/lib/intelligentUi/runtimeFlush";
import type { SessionMessageTree } from "@/types";

export type SessionMessageSaveMode = "immediate" | "coalesced";
export type SessionMessageSavePolicy = { retainOnFailure?: boolean };
type Snapshot = {
  tree: SessionMessageTree;
  write: (tree: SessionMessageTree) => Promise<void>;
  retainOnFailure: boolean;
};
type Slot = {
  snapshot: Snapshot;
  release: () => void;
  promise: Promise<void>;
  cancelled: boolean;
};
const queues = new Map<string, Promise<void>>();
const tails = new Map<string, Slot>();
const pendingSnapshots = new Map<string, Set<Slot>>();
const dirty = new Map<string, Snapshot>();
const deleted = new Set<string>();

function seal(sessionId: string) {
  const slot = tails.get(sessionId);
  if (slot) {
    tails.delete(sessionId);
    slot.release();
  }
}

function queue(sessionId: string, write: () => Promise<void>): Promise<void> {
  assertAppDataWritesAllowed();
  const previous = queues.get(sessionId);
  // Register the restore lock now, including the coalescing delay.
  const result = runWithAppDataWriteLock(async () => {
    if (previous) await previous.catch(() => undefined);
    await write();
  });
  queues.set(sessionId, result);
  void result.then(
    () => {
      if (queues.get(sessionId) === result) queues.delete(sessionId);
    },
    () => {
      if (queues.get(sessionId) === result) queues.delete(sessionId);
    },
  );
  return result;
}

export async function enqueueSessionMessageWrite(
  sessionId: string,
  write: () => Promise<void>,
): Promise<void> {
  assertAppDataWritesAllowed();
  if (deleted.has(sessionId)) throw new Error("Session was deleted.");
  seal(sessionId);
  await queue(sessionId, async () => {
    if (deleted.has(sessionId)) return;
    const failed = dirty.get(sessionId);
    if (failed) {
      await failed.write(failed.tree);
      if (dirty.get(sessionId) === failed) dirty.delete(sessionId);
    }
    if (deleted.has(sessionId)) return;
    await write();
  });
}

/** Immutable full-tree snapshots may replace only the unstarted UI tail. */
export function enqueueSessionMessageTreeWrite(
  sessionId: string,
  tree: SessionMessageTree,
  write: Snapshot["write"],
  mode: SessionMessageSaveMode = "immediate",
  policy: SessionMessageSavePolicy = {},
): Promise<void> {
  assertAppDataWritesAllowed();
  if (deleted.has(sessionId))
    return Promise.reject(new Error("Session was deleted."));
  const snapshot: Snapshot = {
    tree: structuredClone(tree),
    write,
    retainOnFailure: policy.retainOnFailure ?? mode === "coalesced",
  };
  const tail = tails.get(sessionId);
  if (mode === "coalesced" && tail) {
    tail.snapshot = snapshot;
    return tail.promise;
  }
  seal(sessionId);
  let release!: () => void;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const ready = new Promise<void>((resolve) => {
    release = () => {
      clearTimeout(timer);
      resolve();
    };
    if (mode === "coalesced") timer = setTimeout(release, 100);
    else resolve();
  });
  const slot: Slot = {
    snapshot,
    release,
    cancelled: false,
    promise: Promise.resolve(),
  };
  slot.promise = queue(sessionId, async () => {
    if (mode === "coalesced") await ready;
    if (tails.get(sessionId) === slot) tails.delete(sessionId);
    if (slot.cancelled || deleted.has(sessionId)) {
      throw new Error("Session save was cancelled by deletion.");
    }
    const saved = slot.snapshot;
    try {
      await saved.write(saved.tree);
      dirty.delete(sessionId);
    } catch (error) {
      if (saved.retainOnFailure) dirty.set(sessionId, saved);
      throw error;
    }
  });
  const pending = pendingSnapshots.get(sessionId) ?? new Set<Slot>();
  pending.add(slot);
  pendingSnapshots.set(sessionId, pending);
  const settled = () => {
    pending.delete(slot);
    if (pending.size === 0 && pendingSnapshots.get(sessionId) === pending)
      pendingSnapshots.delete(sessionId);
  };
  void slot.promise.then(settled, settled);
  if (mode === "coalesced") tails.set(sessionId, slot);
  return slot.promise;
}

/** Explicit consumption retries an already failed latest snapshot once. */
export function waitForSessionMessageWrites(
  sessionId: string,
): Promise<void> | undefined {
  const runtimeFlush = flushHtmlRuntimeUpdates(sessionId);
  return runtimeFlush
    ? runtimeFlush.then(() => drainSessionMessageWrites(sessionId))
    : drainSessionMessageWrites(sessionId);
}

function drainSessionMessageWrites(
  sessionId: string,
): Promise<void> | undefined {
  seal(sessionId);
  const current = queues.get(sessionId);
  if (current)
    return (async () => {
      let pending: Promise<void> | undefined = current;
      while (pending) {
        await pending;
        seal(sessionId);
        const latest = queues.get(sessionId);
        pending = latest === pending ? undefined : latest;
      }
    })();
  const failed = dirty.get(sessionId);
  if (failed && !deleted.has(sessionId)) {
    return enqueueSessionMessageTreeWrite(
      sessionId,
      failed.tree,
      failed.write,
      "immediate",
      { retainOnFailure: true },
    );
  }
}

export async function flushSessionMessageWrites(): Promise<void> {
  const runtimeFlush = flushHtmlRuntimeUpdates();
  if (runtimeFlush) await runtimeFlush;
  const ids = new Set([...queues.keys(), ...dirty.keys()]);
  await Promise.all([...ids].map((id) => drainSessionMessageWrites(id)));
  while (queues.size) {
    for (const id of queues.keys()) seal(id);
    await Promise.all([...queues.values()]);
  }
}

/** Tombstone first; pending UI writes are discarded, in-flight writes drain. */
export async function deleteSessionMessageWrites(
  sessionId: string,
  remove: () => Promise<void>,
): Promise<void> {
  assertAppDataWritesAllowed();
  // Keep the latest accepted full tree until deletion is durable. A sealed
  // snapshot behind another queue item is no longer in tails, but is still
  // newer than dirty state and must survive a failed remove operation.
  const pending = pendingSnapshots.get(sessionId);
  const rollbackSnapshot = pending?.size
    ? [...pending].at(-1)!.snapshot
    : dirty.get(sessionId);
  deleted.add(sessionId);
  const tail = tails.get(sessionId);
  if (tail) tail.cancelled = true;
  seal(sessionId);
  dirty.delete(sessionId);
  try {
    await queue(sessionId, async () => {
      await remove();
      dirty.delete(sessionId);
    });
  } catch (error) {
    deleted.delete(sessionId);
    if (rollbackSnapshot) dirty.set(sessionId, rollbackSnapshot);
    throw error;
  }
}

/** A restored/imported session may intentionally reuse an old identifier. */
export function reopenSessionMessageWrites(sessionId: string): void {
  if (!queues.has(sessionId)) deleted.delete(sessionId);
}
