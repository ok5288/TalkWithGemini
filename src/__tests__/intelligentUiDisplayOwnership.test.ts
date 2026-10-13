import { describe, expect, it, vi } from "vitest";
import {
  createUiDisplayOwnership,
  type UiDisplayTarget,
} from "@/lib/intelligentUi/displayOwnership";
const target: UiDisplayTarget = {
  sessionId: "s",
  messageId: "m",
  blockId: "b",
  definitionRevision: 1,
};
const adapter = () => ({
  eligible: () => true,
  pendingImport: () => false,
  release: vi.fn(),
});
const deferred = () => {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
};
describe("exclusive UI display transactions", () => {
  it("revokes old proposals permanently even after failed save rollback", async () => {
    const pending = deferred();
    const display = createUiDisplayOwnership({
      flush: () => pending.promise,
      valid: () => true,
    });
    const old = adapter();
    const grant = display.register(target, "inline", old);
    const proposed = grant.captureInteraction();
    const epoch = grant.epoch();
    const move = display.move(target);
    expect(proposed()).toBe(false);
    expect(grant.owns()).toBe(true);
    expect(grant.epoch()).toBe(epoch);
    pending.reject(Error("write failed"));
    expect(await move).toBe(false);
    expect(grant.interactive()).toBe(true);
    expect(proposed()).toBe(false);
    expect(grant.captureInteraction()()).toBe(true);
    expect(old.release).not.toHaveBeenCalled();
  });
  it("serializes rapid requests and releases before another adapter can acquire", async () => {
    const pending = deferred();
    const display = createUiDisplayOwnership({
      flush: () => pending.promise,
      valid: () => true,
    });
    const old = adapter();
    const inline = display.register(target, "inline", old);
    const move = display.move(target);
    expect(await display.move(null)).toBe(false);
    expect(display.register(target, "viewer", adapter()).owns()).toBe(false);
    pending.resolve();
    expect(await move).toBe(true);
    const current = display.register(target, "viewer", adapter());
    expect(old.release).toHaveBeenCalledTimes(1);
    expect(inline.owns()).toBe(false);
    expect(current.owns()).toBe(true);
    expect(display.register(target, "inline", adapter()).owns()).toBe(false);
  });
  it("does not resurrect an invalid owner after authority returns and flush settles", async () => {
    const pending = deferred();
    let valid = true;
    const display = createUiDisplayOwnership({
      flush: () => pending.promise,
      valid: () => valid,
    });
    const old = adapter();
    display.register(target, "inline", old);
    const move = display.move(target);
    valid = false;
    display.revalidate();
    valid = true;
    pending.resolve();
    expect(await move).toBe(false);
    expect(display.getSnapshot().viewer).toBeNull();
    expect(display.getSnapshot().transitioning).toBe(false);
    expect(old.release).toHaveBeenCalledTimes(1);
  });
  it("does not close an unrelated viewer when another inline block expires", async () => {
    const second = { ...target, blockId: "other" };
    let secondValid = true;
    const display = createUiDisplayOwnership({
      flush: () => undefined,
      valid: (value) => value.blockId !== second.blockId || secondValid,
    });
    display.register(target, "inline", adapter());
    display.register(second, "inline", adapter());
    await display.move(target);
    const viewer = display.register(target, "viewer", adapter());
    secondValid = false;
    display.revalidate();
    expect(display.getSnapshot().viewer).toEqual(target);
    expect(viewer.interactive()).toBe(true);
  });
});
