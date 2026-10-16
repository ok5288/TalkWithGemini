import { afterEach, describe, expect, it, vi } from "vitest";
import {
  classifyModelError,
  getResearchModelErrorCode,
} from "@/lib/chat/providerErrors";
import { runResearchModelWithRetry } from "@/lib/research/runtime/modelRetry";
import { StructuredOutputCapabilityError } from "@/lib/chat/responseFormat";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("research model failures", () => {
  it.each([
    [401, "auth"],
    [403, "auth"],
    [429, "rate_limit"],
    [404, "model_not_found"],
    [408, "timeout"],
    [503, "unavailable"],
  ])("classifies status %s", (status, kind) => {
    expect(
      classifyModelError(
        Object.assign(new Error("provider failed"), { status }),
      ),
    ).toBe(kind);
  });
  it("recognizes offline and fetch failures", () => {
    expect(getResearchModelErrorCode(new TypeError("Failed to fetch"))).toBe(
      "RESEARCH_MODEL_NETWORK",
    );
    vi.stubGlobal("navigator", { onLine: false });
    expect(classifyModelError(new Error("Failed to fetch"))).toBe("offline");
    expect(classifyModelError({ status: 429 })).toBe("rate_limit");
  });
  it("retries twice and preserves the original error", async () => {
    vi.useFakeTimers();
    const error = new TypeError("Failed to fetch");
    const run = vi.fn().mockRejectedValue(error);
    const result = expect(runResearchModelWithRetry({ run })).rejects.toBe(
      error,
    );
    await vi.runAllTimersAsync();
    await result;
    expect(run).toHaveBeenCalledTimes(3);
  });
  it.each([
    Object.assign(new Error("network rate limit"), { status: 429 }),
    Object.assign(new Error("connection auth"), { status: 401 }),
    Object.assign(new Error("network model missing"), { status: 404 }),
    new StructuredOutputCapabilityError(400),
    new TypeError("Cannot read properties of undefined"),
  ])("does not retry permanent errors: %s", async (error) => {
    const run = vi.fn().mockRejectedValue(error);
    await expect(runResearchModelWithRetry({ run })).rejects.toBe(error);
    expect(run).toHaveBeenCalledOnce();
  });
  it.each(["output", "tool"])(
    "does not replay after %s activity",
    async (activity) => {
      const error = new Error("Failed to fetch");
      const run = vi.fn().mockRejectedValue(error);
      await expect(
        runResearchModelWithRetry({
          run,
          hasVisibleOutput: () => activity === "output",
          hasToolActivity: () => activity === "tool",
        }),
      ).rejects.toBe(error);
      expect(run).toHaveBeenCalledOnce();
    },
  );
  it("aborts during retry backoff", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const run = vi.fn().mockRejectedValue(new Error("Failed to fetch"));
    const result = expect(
      runResearchModelWithRetry({ run, signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(1);
    controller.abort();
    await result;
    expect(run).toHaveBeenCalledOnce();
  });
});

it("recognizes temporary provider outage without treating unknown errors as connection loss", async () => {
  const { isResearchConnectionError } =
    await import("@/lib/research/runtime/connectionErrors");
  expect(
    isResearchConnectionError(
      Object.assign(new Error("Provider failed"), { statusCode: 503 }),
    ),
  ).toBe(true);
  expect(
    isResearchConnectionError(new Error("Service temporarily unavailable")),
  ).toBe(true);
  expect(isResearchConnectionError(new Error("Unknown runtime error"))).toBe(
    false,
  );
  expect(
    isResearchConnectionError(
      new TypeError("Cannot read properties of undefined"),
    ),
  ).toBe(false);
});
