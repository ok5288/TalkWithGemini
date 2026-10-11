import { afterEach, describe, expect, it, vi } from "vitest";
import { registerHtmlRuntimeFlusher } from "@/lib/intelligentUi/runtimeFlush";
import { normalizeSessionMessageTree } from "@/lib/chat/messageTree";
import {
  enqueueSessionMessageWrite,
  enqueueSessionMessageTreeWrite,
  waitForSessionMessageWrites,
  flushSessionMessageWrites,
  deleteSessionMessageWrites,
} from "@/store/sessionMessagePersistence";

const tree = () => normalizeSessionMessageTree([]);
afterEach(() => vi.useRealTimers());

describe("session message snapshot queue", () => {
  it("flushes runtime buffers even when no database write has been queued", async () => {
    const write = vi.fn(async () => {});
    let saved: Promise<void> | undefined;
    const unregister = registerHtmlRuntimeFlusher("buffer-only", async () => {
      saved = enqueueSessionMessageTreeWrite(
        "buffer-only",
        tree(),
        write,
        "coalesced",
      );
    });
    try {
      await flushSessionMessageWrites();
      await saved;
      expect(write).toHaveBeenCalledOnce();
    } finally {
      unregister();
    }
  });

  it("waits for frame acknowledgment before draining the latest accepted updates", async () => {
    let acknowledge!: () => void;
    const ack = new Promise<void>((resolve) => {
      acknowledge = resolve;
    });
    const unregister = registerHtmlRuntimeFlusher("frame-ack", () => ack);
    const write = vi.fn(async () => {});
    try {
      const flushing = waitForSessionMessageWrites("frame-ack");
      const saved = enqueueSessionMessageTreeWrite(
        "frame-ack",
        tree(),
        write,
        "coalesced",
      );
      expect(write).not.toHaveBeenCalled();
      acknowledge();
      await flushing;
      await saved;
      expect(write).toHaveBeenCalledOnce();
    } finally {
      unregister();
    }
  });

  it("drains in-flight writes before deletion and cancels the trailing snapshot", async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const calls: string[] = [];
    const running = enqueueSessionMessageTreeWrite(
      "delete-inflight",
      tree(),
      async () => {
        calls.push("write");
        await held;
      },
    );
    const trailing = enqueueSessionMessageTreeWrite(
      "delete-inflight",
      tree(),
      async () => {
        calls.push("trailing");
      },
      "coalesced",
    );
    const removal = deleteSessionMessageWrites("delete-inflight", async () => {
      calls.push("delete");
    });
    expect(calls).toEqual(["write"]);
    const cancelled = expect(trailing).rejects.toThrow("cancelled");
    release();
    await Promise.all([running, cancelled, removal]);
    expect(calls).toEqual(["write", "delete"]);
  });

  it("coalesces a burst at a fixed first deadline and copies inputs", async () => {
    vi.useFakeTimers();
    const saved: unknown[] = [];
    const write = vi.fn(async (value) => {
      saved.push(value);
    });
    const initial = tree();
    const first = enqueueSessionMessageTreeWrite(
      "burst",
      initial,
      write,
      "coalesced",
    );
    await vi.advanceTimersByTimeAsync(90);
    for (let i = 0; i < 100; i++)
      enqueueSessionMessageTreeWrite("burst", tree(), write, "coalesced");
    const last = tree();
    enqueueSessionMessageTreeWrite("burst", last, write, "coalesced");
    last.rootMessageIds.push("mutation");
    await vi.advanceTimersByTimeAsync(10);
    await first;
    expect(write).toHaveBeenCalledTimes(1);
    expect(saved[0]).toEqual(tree());
  });

  it("preserves U1 / ordinary write / U2 and flush forces all", async () => {
    vi.useFakeTimers();
    const calls: string[] = [];
    const a = enqueueSessionMessageTreeWrite(
      "order",
      tree(),
      async () => {
        calls.push("U1");
      },
      "coalesced",
    );
    const g = enqueueSessionMessageWrite("order", async () => {
      calls.push("G");
    });
    const b = enqueueSessionMessageTreeWrite(
      "order",
      tree(),
      async () => {
        calls.push("U2");
      },
      "coalesced",
    );
    await flushSessionMessageWrites();
    await Promise.all([a, g, b]);
    expect(calls).toEqual(["U1", "G", "U2"]);
  });

  it("keeps in-flight snapshot sealed and sessions independent", async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const calls: string[] = [];
    const a = enqueueSessionMessageTreeWrite("inflight", tree(), async () => {
      calls.push("first");
      await held;
    });
    await Promise.resolve();
    const b = enqueueSessionMessageTreeWrite(
      "inflight",
      tree(),
      async () => {
        calls.push("trailing");
      },
      "coalesced",
    );
    await enqueueSessionMessageTreeWrite("other", tree(), async () => {
      calls.push("other");
    });
    expect(calls).toEqual(["first", "other"]);
    release();
    await waitForSessionMessageWrites("inflight");
    await Promise.all([a, b]);
    expect(calls).toEqual(["first", "other", "trailing"]);
  });

  it("retains failures, blocks stale ordinary writes and retries once explicitly", async () => {
    const write = vi
      .fn()
      .mockRejectedValueOnce(new Error("disk full"))
      .mockRejectedValueOnce(new Error("disk full"))
      .mockResolvedValue(undefined);
    await expect(
      enqueueSessionMessageTreeWrite("failure", tree(), write, "coalesced"),
    ).rejects.toThrow("disk full");
    const ordinary = vi.fn(async () => {});
    await expect(
      enqueueSessionMessageWrite("failure", ordinary),
    ).rejects.toThrow("disk full");
    expect(ordinary).not.toHaveBeenCalled();
    await waitForSessionMessageWrites("failure");
    expect(write).toHaveBeenCalledTimes(3);
    await enqueueSessionMessageWrite("failure", ordinary);
    expect(ordinary).toHaveBeenCalledOnce();
  });

  it("retries dirty state before an ordinary operation can read persisted data", async () => {
    const calls: string[] = [];
    const write = vi
      .fn()
      .mockRejectedValueOnce(new Error("quota"))
      .mockImplementation(async () => {
        calls.push("retry");
      });
    await expect(
      enqueueSessionMessageTreeWrite(
        "ordinary-retry",
        tree(),
        write,
        "coalesced",
      ),
    ).rejects.toThrow("quota");
    await enqueueSessionMessageWrite("ordinary-retry", async () => {
      calls.push("ordinary");
    });
    expect(calls).toEqual(["retry", "ordinary"]);
    expect(write).toHaveBeenCalledTimes(2);
  });

  it("deletion during an ordinary retry drains the retry but skips the operation", async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const calls: string[] = [];
    const write = vi
      .fn()
      .mockRejectedValueOnce(new Error("quota"))
      .mockImplementation(async () => {
        calls.push("retry");
        await held;
      });
    await expect(
      enqueueSessionMessageTreeWrite(
        "delete-retry",
        tree(),
        write,
        "coalesced",
      ),
    ).rejects.toThrow("quota");
    const ordinary = enqueueSessionMessageWrite("delete-retry", async () => {
      calls.push("ordinary");
    });
    const deletion = deleteSessionMessageWrites("delete-retry", async () => {
      calls.push("delete");
    });
    release();
    await Promise.all([ordinary, deletion]);
    expect(calls).toEqual(["retry", "delete"]);
  });

  it("a newer full snapshot covers failed dirty state", async () => {
    await expect(
      enqueueSessionMessageTreeWrite(
        "newer",
        tree(),
        async () => {
          throw new Error("failed");
        },
        "coalesced",
      ),
    ).rejects.toThrow();
    const newest = vi.fn(async () => {});
    await enqueueSessionMessageTreeWrite("newer", tree(), newest);
    await flushSessionMessageWrites();
    expect(newest).toHaveBeenCalledOnce();
  });

  it("retains a pending snapshot when deletion fails and does not report durable success", async () => {
    const latest = tree();
    latest.rootMessageIds.push("latest");
    const write = vi.fn(async () => {});
    const pending = enqueueSessionMessageTreeWrite(
      "delete-rollback",
      latest,
      write,
      "coalesced",
    );
    const cancelled = expect(pending).rejects.toThrow("cancelled");
    await expect(
      deleteSessionMessageWrites("delete-rollback", async () => {
        throw new Error("remove failed");
      }),
    ).rejects.toThrow("remove failed");
    await cancelled;
    expect(write).not.toHaveBeenCalled();
    await waitForSessionMessageWrites("delete-rollback");
    expect(write).toHaveBeenCalledExactlyOnceWith(latest);
  });

  it("restores already dirty state after failed deletion", async () => {
    const latest = tree();
    latest.rootMessageIds.push("unsaved");
    const write = vi
      .fn()
      .mockRejectedValueOnce(new Error("quota"))
      .mockResolvedValue(undefined);
    await expect(
      enqueueSessionMessageTreeWrite(
        "delete-dirty",
        latest,
        write,
        "coalesced",
      ),
    ).rejects.toThrow("quota");
    await expect(
      deleteSessionMessageWrites("delete-dirty", async () => {
        throw new Error("remove failed");
      }),
    ).rejects.toThrow("remove failed");
    await waitForSessionMessageWrites("delete-dirty");
    expect(write).toHaveBeenCalledTimes(2);
    expect(write).toHaveBeenLastCalledWith(latest);
  });

  it("restores a newer sealed queued snapshot after failed deletion", async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const running = enqueueSessionMessageWrite("delete-sealed", () => held);
    const latest = tree();
    latest.rootMessageIds.push("sealed");
    const write = vi.fn(async () => {});
    const pending = enqueueSessionMessageTreeWrite(
      "delete-sealed",
      latest,
      write,
      "coalesced",
    );
    const ordinary = enqueueSessionMessageWrite(
      "delete-sealed",
      async () => {},
    );
    const cancelled = expect(pending).rejects.toThrow("cancelled");
    const deletion = expect(
      deleteSessionMessageWrites("delete-sealed", async () => {
        throw new Error("remove failed");
      }),
    ).rejects.toThrow("remove failed");
    release();
    await Promise.all([running, cancelled, ordinary, deletion]);
    await waitForSessionMessageWrites("delete-sealed");
    expect(write).toHaveBeenCalledExactlyOnceWith(latest);
  });

  it("deletion cancels pending writes and rejects late resurrection", async () => {
    vi.useFakeTimers();
    const write = vi.fn(async () => {});
    const pending = enqueueSessionMessageTreeWrite(
      "deleted",
      tree(),
      write,
      "coalesced",
    );
    const remove = vi.fn(async () => {});
    const cancelled = expect(pending).rejects.toThrow("cancelled");
    await deleteSessionMessageWrites("deleted", remove);
    await cancelled;
    expect(write).not.toHaveBeenCalled();
    expect(remove).toHaveBeenCalledOnce();
    await expect(
      enqueueSessionMessageTreeWrite("deleted", tree(), write),
    ).rejects.toThrow("deleted");
  });
});
