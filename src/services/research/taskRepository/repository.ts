import {
  ResearchPersistenceError,
  classifyResearchStorageFailure,
} from "./errors";
import type { ResearchTask } from "@/lib/research/types";

import { DEFAULT_DB_NAME } from "./constants";
import { IndexedDbResearchTaskBackend } from "./indexedDbBackend";
import { MemoryResearchTaskBackend } from "./memoryBackend";
import { createStoredRecord, parseStoredResearchTask } from "./persistedTask";
import type {
  CreateResearchTaskRepositoryOptions,
  ResearchTaskBackend,
  ResearchTaskRepository,
  ResearchTaskRepositoryFallbackReason,
  ResearchTaskRepositoryStatus,
} from "./types";

const taskListeners = new Set<() => void>();
let taskChannel: BroadcastChannel | undefined;
export function subscribeResearchTasks(listener: () => void): () => void {
  taskListeners.add(listener);
  if (
    !taskChannel &&
    typeof window !== "undefined" &&
    typeof BroadcastChannel !== "undefined"
  ) {
    taskChannel = new BroadcastChannel("neo-chat-research-tasks-changed");
    taskChannel.onmessage = () => taskListeners.forEach((notify) => notify());
  }
  return () => {
    taskListeners.delete(listener);
    if (!taskListeners.size) {
      taskChannel?.close();
      taskChannel = undefined;
    }
  };
}
function notifyTaskChange() {
  taskListeners.forEach((notify) => notify());
  if (taskChannel) taskChannel.postMessage("changed");
  else if (
    typeof window !== "undefined" &&
    typeof BroadcastChannel !== "undefined"
  ) {
    const notification = new BroadcastChannel(
      "neo-chat-research-tasks-changed",
    );
    notification.postMessage("changed");
    notification.close();
  }
}

class BrowserResearchTaskRepository implements ResearchTaskRepository {
  private readonly memory = new MemoryResearchTaskBackend();
  private persistent: ResearchTaskBackend | null;
  private readonly confirmed = new Map<string, string>();
  private readonly pending = new Set<string>();
  private saveQueue: Promise<void> = Promise.resolve();
  private status: ResearchTaskRepositoryStatus;

  constructor(
    private readonly factory: IDBFactory | null,
    private readonly dbName: string,
  ) {
    this.persistent = factory
      ? new IndexedDbResearchTaskBackend(factory, dbName)
      : null;
    this.status = factory
      ? { mode: "persistent", durable: true }
      : {
          mode: "memory",
          durable: false,
          fallbackReason: "indexeddb_unavailable",
        };
  }

  getStatus(): ResearchTaskRepositoryStatus {
    return { ...this.status };
  }

  private downgrade(reason: ResearchTaskRepositoryFallbackReason): void {
    this.persistent?.close();
    this.persistent = null;
    this.status = { mode: "memory", durable: false, fallbackReason: reason };
  }

  async save(task: ResearchTask): Promise<void> {
    const record = createStoredRecord(task);
    const saving = this.saveQueue
      .catch(() => undefined)
      .then(async () => {
        await this.memory.put(record);
        if (!this.confirmed.has(task.id)) this.confirmed.set(task.id, "absent");
        if (this.pending.has(task.id) && this.persistent)
          this.downgrade("indexeddb_operation_failed");
        if (!this.persistent) {
          this.pending.add(task.id);
          notifyTaskChange();
          if (this.factory)
            throw new ResearchPersistenceError(
              this.status.fallbackReason ?? "indexeddb_operation_failed",
            );
          return;
        }
        try {
          await this.persistent.put(record);
          this.confirmed.set(task.id, JSON.stringify(record));
          this.pending.delete(task.id);
        } catch (error) {
          this.pending.add(task.id);
          this.downgrade(classifyResearchStorageFailure(error));
          notifyTaskChange();
          throw new ResearchPersistenceError(
            classifyResearchStorageFailure(error),
          );
        }
        notifyTaskChange();
      });
    this.saveQueue = saving;
    return saving;
  }

  async recover(task: ResearchTask): Promise<void> {
    await this.saveQueue.catch(() => undefined);
    if (this.status.durable && !this.pending.has(task.id)) return;
    if (!this.factory)
      throw new ResearchPersistenceError("indexeddb_unavailable");
    const record = createStoredRecord(task);
    const backend = new IndexedDbResearchTaskBackend(this.factory, this.dbName);
    try {
      await backend.compareAndPut(
        record,
        this.confirmed.get(task.id) ?? "unknown",
      );
      // The transaction committed; keep this baseline even if the verification read fails.
      this.confirmed.set(task.id, JSON.stringify(record));
      const readback = parseStoredResearchTask(await backend.get(task.id));
      if (
        !readback ||
        JSON.stringify(createStoredRecord(readback)) !== JSON.stringify(record)
      )
        throw new ResearchPersistenceError("conflict");
      this.persistent?.close();
      this.persistent = backend;
      this.confirmed.set(task.id, JSON.stringify(record));
      this.pending.delete(task.id);
      await this.memory.put(record);
      this.status = { mode: "persistent", durable: true };
      notifyTaskChange();
    } catch (error) {
      backend.close();
      this.downgrade(classifyResearchStorageFailure(error));
      throw error instanceof ResearchPersistenceError
        ? error
        : new ResearchPersistenceError(classifyResearchStorageFailure(error));
    }
  }

  async get(taskId: string): Promise<ResearchTask | null> {
    if (this.pending.has(taskId)) {
      if (this.status.durable) this.downgrade("indexeddb_operation_failed");
      return parseStoredResearchTask(await this.memory.get(taskId));
    }
    if (this.persistent) {
      try {
        const stored = await this.persistent.get(taskId);
        // A failed save may have replaced the local snapshot while this read was pending.
        if (this.pending.has(taskId)) {
          if (this.status.durable) this.downgrade("indexeddb_operation_failed");
          return parseStoredResearchTask(await this.memory.get(taskId));
        }
        const task = parseStoredResearchTask(stored);
        this.confirmed.set(
          taskId,
          task
            ? JSON.stringify(createStoredRecord(task))
            : stored == null
              ? "absent"
              : "invalid",
        );
        if (task) await this.memory.put(createStoredRecord(task));
        else if (stored !== undefined && stored !== null) {
          await this.persistent.remove(taskId);
        }
        return task;
      } catch (error) {
        this.downgrade(classifyResearchStorageFailure(error));
      }
    }
    return parseStoredResearchTask(await this.memory.get(taskId));
  }

  async list(sessionId?: string): Promise<ResearchTask[]> {
    let values: unknown[];
    if (this.persistent) {
      try {
        values = await this.persistent.getAll();
        const tasks = values
          .map(parseStoredResearchTask)
          .filter((task): task is ResearchTask => Boolean(task));
        const invalidTaskIds = values.flatMap((value) => {
          if (parseStoredResearchTask(value)) return [];
          if (!value || typeof value !== "object" || Array.isArray(value)) {
            return [];
          }
          const taskId = (value as { taskId?: unknown }).taskId;
          return typeof taskId === "string" && taskId ? [taskId] : [];
        });
        await Promise.all(
          invalidTaskIds.map((taskId) => this.persistent!.remove(taskId)),
        );
        await Promise.all(
          tasks
            .filter((task) => !this.pending.has(task.id))
            .map((task) => {
              const record = createStoredRecord(task);
              this.confirmed.set(task.id, JSON.stringify(record));
              return this.memory.put(record);
            }),
        );
      } catch (error) {
        this.downgrade(classifyResearchStorageFailure(error));
        values = await this.memory.getAll();
      }
    } else {
      values = await this.memory.getAll();
    }
    const pending = (await this.memory.getAll()).filter((value) => {
      const task = parseStoredResearchTask(value);
      return task && this.pending.has(task.id);
    });
    values = [
      ...values.filter((value) => {
        const task = parseStoredResearchTask(value);
        return !task || !this.pending.has(task.id);
      }),
      ...pending,
    ];
    return values
      .map(parseStoredResearchTask)
      .filter((task): task is ResearchTask => Boolean(task))
      .filter((task) => !sessionId || task.sessionId === sessionId)
      .sort((left, right) => right.updatedAt - left.updatedAt);
  }

  async remove(taskId: string): Promise<void> {
    await this.saveQueue.catch(() => undefined);
    await this.memory.remove(taskId);
    this.pending.delete(taskId);
    this.confirmed.delete(taskId);
    if (!this.persistent) {
      notifyTaskChange();
      return;
    }
    try {
      await this.persistent.remove(taskId);
    } catch (error) {
      this.downgrade(classifyResearchStorageFailure(error));
    }
    notifyTaskChange();
  }

  async clearSession(sessionId: string): Promise<void> {
    await this.saveQueue.catch(() => undefined);
    const sessionTaskIds = (await this.memory.getAll())
      .map(parseStoredResearchTask)
      .filter((task) => task?.sessionId === sessionId)
      .map((task) => task!.id);
    await this.memory.clearSession(sessionId);
    if (!this.persistent) {
      notifyTaskChange();
      return;
    }
    try {
      await this.persistent.clearSession(sessionId);
      for (const id of sessionTaskIds) {
        this.confirmed.delete(id);
        this.pending.delete(id);
      }
    } catch (error) {
      this.downgrade(classifyResearchStorageFailure(error));
    }
    notifyTaskChange();
  }

  async clear(): Promise<void> {
    await this.saveQueue.catch(() => undefined);
    await this.memory.clear();
    if (!this.persistent) {
      notifyTaskChange();
      return;
    }
    try {
      await this.persistent.clear();
      this.confirmed.clear();
      this.pending.clear();
    } catch (error) {
      this.downgrade(classifyResearchStorageFailure(error));
    }
    notifyTaskChange();
  }

  close(): void {
    this.persistent?.close();
  }
}

function resolveIndexedDbFactory(
  options: CreateResearchTaskRepositoryOptions,
): IDBFactory | null {
  if (Object.prototype.hasOwnProperty.call(options, "indexedDb")) {
    return options.indexedDb ?? null;
  }
  return typeof indexedDB === "undefined" ? null : indexedDB;
}

export function createResearchTaskRepository(
  options: CreateResearchTaskRepositoryOptions = {},
): ResearchTaskRepository {
  return new BrowserResearchTaskRepository(
    resolveIndexedDbFactory(options),
    options.dbName ?? DEFAULT_DB_NAME,
  );
}
