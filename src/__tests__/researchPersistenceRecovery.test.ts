import { afterEach, describe, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { createResearchTask } from "@/lib/research/task";
import { createResearchTaskRepository } from "@/services/research/taskRepository";
import { IndexedDbResearchTaskBackend } from "@/services/research/taskRepository/indexedDbBackend";

const task = () =>
  createResearchTask({
    id: "task",
    sessionId: "session",
    goal: "Research",
    now: 100,
  });
afterEach(() => vi.restoreAllMocks());
describe("research persistence recovery", () => {
  it("reopens after a temporary write failure and verifies the current task", async () => {
    const repository = createResearchTaskRepository({
      indexedDb: new IDBFactory(),
    });
    await repository.save(task());
    vi.spyOn(
      IndexedDbResearchTaskBackend.prototype,
      "put",
    ).mockRejectedValueOnce(new Error("temporary"));
    const next = { ...task(), goal: "Local progress", updatedAt: 101 };
    await expect(repository.save(next)).rejects.toMatchObject({
      reason: "indexeddb_operation_failed",
    });
    expect(repository.getStatus().durable).toBe(false);
    await repository.recover!(next);
    expect(repository.getStatus().durable).toBe(true);
    expect((await repository.get(next.id))?.goal).toBe("Local progress");
    repository.close();
  });
  it("rejects recovery when another tab advanced the confirmed snapshot", async () => {
    const factory = new IDBFactory();
    const repository = createResearchTaskRepository({ indexedDb: factory });
    const other = createResearchTaskRepository({ indexedDb: factory });
    await repository.save(task());
    vi.spyOn(
      IndexedDbResearchTaskBackend.prototype,
      "put",
    ).mockRejectedValueOnce(new Error("temporary"));
    const local = { ...task(), goal: "Local progress", updatedAt: 101 };
    await expect(repository.save(local)).rejects.toMatchObject({
      reason: "indexeddb_operation_failed",
    });
    await other.save({ ...task(), goal: "Other tab", updatedAt: 102 });
    await expect(repository.recover!(local)).rejects.toMatchObject({
      reason: "conflict",
    });
    expect((await other.get("task"))?.goal).toBe("Other tab");
    expect((await repository.get("task"))?.goal).toBe("Local progress");
    repository.close();
    other.close();
  });
  it("does not claim recovery when storage remains unavailable", async () => {
    const repository = createResearchTaskRepository({
      indexedDb: {
        open: () => {
          throw new DOMException("Full", "QuotaExceededError");
        },
      } as unknown as IDBFactory,
    });
    await expect(repository.save(task())).rejects.toMatchObject({
      reason: "quota",
    });
    expect(repository.getStatus().fallbackReason).toBe("quota");
    await expect(repository.recover!(task())).rejects.toMatchObject({
      reason: "quota",
    });
    expect(repository.getStatus().durable).toBe(false);
  });
});

it("serializes overlapping writes without treating an in-flight save as failure", async () => {
  const repository = createResearchTaskRepository({
    indexedDb: new IDBFactory(),
  });
  await Promise.all([
    repository.save(task()),
    repository.save({ ...task(), goal: "Latest", updatedAt: 101 }),
  ]);
  expect(repository.getStatus().durable).toBe(true);
  expect((await repository.get("task"))?.goal).toBe("Latest");
  repository.close();
});

it.each(["delete", "cancel"])(
  "does not overwrite another tab's %s during recovery",
  async (action) => {
    const factory = new IDBFactory();
    const repository = createResearchTaskRepository({ indexedDb: factory });
    const other = createResearchTaskRepository({ indexedDb: factory });
    await repository.save(task());
    vi.spyOn(
      IndexedDbResearchTaskBackend.prototype,
      "put",
    ).mockRejectedValueOnce(new Error("temporary"));
    await expect(
      repository.save({ ...task(), goal: "Local" }),
    ).rejects.toThrow();
    if (action === "delete") await other.remove("task");
    else await other.save({ ...task(), status: "cancelled" });
    await expect(
      repository.recover!({ ...task(), goal: "Local" }),
    ).rejects.toMatchObject({ reason: "conflict" });
    expect(await other.get("task")).toEqual(
      action === "delete"
        ? null
        : expect.objectContaining({ status: "cancelled" }),
    );
    repository.close();
    other.close();
  },
);

it("refuses an unknown baseline even when a candidate has the same timestamp", async () => {
  const factory = new IDBFactory();
  const other = createResearchTaskRepository({ indexedDb: factory });
  await other.save(task());
  const repository = createResearchTaskRepository({ indexedDb: factory });
  vi.spyOn(IndexedDbResearchTaskBackend.prototype, "put").mockRejectedValueOnce(
    new Error("temporary"),
  );
  const candidate = { ...task(), goal: "Unconfirmed" };
  await expect(repository.save(candidate)).rejects.toThrow();
  await expect(repository.recover!(candidate)).rejects.toMatchObject({
    reason: "conflict",
  });
  expect((await other.get("task"))?.goal).toBe("Research");
  repository.close();
  other.close();
});

it("creates a new task after its first failed write and does not replay other pending tasks", async () => {
  const factory = new IDBFactory();
  const repository = createResearchTaskRepository({ indexedDb: factory });
  vi.spyOn(IndexedDbResearchTaskBackend.prototype, "put").mockRejectedValueOnce(
    new Error("temporary"),
  );
  await expect(repository.save(task())).rejects.toThrow();
  const second = { ...task(), id: "second" };
  await expect(repository.save(second)).rejects.toThrow();
  await repository.recover!(task());
  const observer = createResearchTaskRepository({ indexedDb: factory });
  expect(await observer.get("second")).toBeNull();
  expect(await repository.get("second")).toEqual(second);
  expect(repository.getStatus().durable).toBe(false);
  await repository.recover!(second);
  expect(await observer.get("second")).toEqual(second);
  repository.close();
  observer.close();
});

it("classifies missing IndexedDB and rejects malformed data without downgrading a healthy backend", async () => {
  const unavailable = createResearchTaskRepository({ indexedDb: null });
  await unavailable.save(task());
  await expect(unavailable.recover!(task())).rejects.toMatchObject({
    reason: "indexeddb_unavailable",
  });
  const repository = createResearchTaskRepository({
    indexedDb: new IDBFactory(),
  });
  const invalid = { ...task(), checkpoint: { createdAt: 100 } } as ReturnType<
    typeof task
  >;
  await expect(repository.save(invalid)).rejects.toMatchObject({
    reason: "validation",
  });
  expect(repository.getStatus().durable).toBe(true);
  repository.close();
});

it("classifies blocked opens and closes a late successful connection", async () => {
  const close = vi.fn();
  const request = {
    result: { close },
    onblocked: null,
    onsuccess: null,
  } as unknown as IDBOpenDBRequest;
  const repository = createResearchTaskRepository({
    indexedDb: {
      open: () => {
        queueMicrotask(() =>
          request.onblocked?.call(
            request,
            new Event("blocked") as IDBVersionChangeEvent,
          ),
        );
        return request;
      },
    } as unknown as IDBFactory,
  });
  await expect(repository.save(task())).rejects.toMatchObject({
    reason: "blocked",
  });
  request.onsuccess?.call(request, new Event("success"));
  expect(close).toHaveBeenCalledOnce();
  expect(repository.getStatus().durable).toBe(false);
});

it.each(["clear", "clearSession"] as const)(
  "forgets deleted baselines after a successful %s",
  async (method) => {
    const repository = createResearchTaskRepository({
      indexedDb: new IDBFactory(),
    });
    await repository.save(task());
    if (method === "clear") await repository.clear();
    else await repository.clearSession("session");
    vi.spyOn(
      IndexedDbResearchTaskBackend.prototype,
      "put",
    ).mockRejectedValueOnce(new Error("temporary"));
    await expect(repository.save(task())).rejects.toThrow();
    await expect(repository.recover!(task())).resolves.toBeUndefined();
    expect(repository.getStatus().durable).toBe(true);
    repository.close();
  },
);

it("requires readback before declaring recovery durable and can retry a failed verification read", async () => {
  const repository = createResearchTaskRepository({
    indexedDb: new IDBFactory(),
  });
  await repository.save(task());
  vi.spyOn(IndexedDbResearchTaskBackend.prototype, "put").mockRejectedValueOnce(
    new Error("temporary"),
  );
  const next = { ...task(), goal: "Recovered" };
  await expect(repository.save(next)).rejects.toThrow();
  vi.spyOn(IndexedDbResearchTaskBackend.prototype, "get").mockRejectedValueOnce(
    new Error("read unavailable"),
  );
  await expect(repository.recover!(next)).rejects.toMatchObject({
    reason: "indexeddb_operation_failed",
  });
  expect(repository.getStatus().durable).toBe(false);
  await repository.recover!(next);
  expect(repository.getStatus().durable).toBe(true);
  expect((await repository.get("task"))?.goal).toBe("Recovered");
  repository.close();
});

it("does not resurrect a deleted task from an earlier queued save", async () => {
  const repository = createResearchTaskRepository({
    indexedDb: new IDBFactory(),
  });
  const otherSave = repository.save({ ...task(), id: "other" });
  const pendingSave = repository.save(task());
  const removal = repository.remove("task");
  await Promise.all([otherSave, pendingSave, removal]);
  expect(await repository.get("task")).toBeNull();
  repository.close();
});

it("keeps failed local progress when an older database read finishes later", async () => {
  const repository = createResearchTaskRepository({
    indexedDb: new IDBFactory(),
  });
  await repository.save(task());
  let release!: (record: unknown) => void;
  const delayed = new Promise<unknown>((resolve) => {
    release = resolve;
  });
  const { createStoredRecord } =
    await import("@/services/research/taskRepository/persistedTask");
  vi.spyOn(IndexedDbResearchTaskBackend.prototype, "get").mockReturnValueOnce(
    delayed,
  );
  const reading = repository.get("task");
  vi.spyOn(IndexedDbResearchTaskBackend.prototype, "put").mockRejectedValueOnce(
    new Error("temporary"),
  );
  const next = { ...task(), goal: "Unsaved local progress", updatedAt: 101 };
  await expect(repository.save(next)).rejects.toThrow();
  const other = { ...task(), id: "other" };
  await expect(repository.save(other)).rejects.toThrow();
  await repository.recover!(other);
  expect(repository.getStatus().durable).toBe(true);
  release(createStoredRecord(task()));
  expect((await reading)?.goal).toBe(next.goal);
  expect(repository.getStatus().durable).toBe(false);
  expect((await repository.get("task"))?.goal).toBe(next.goal);
  repository.close();
});
