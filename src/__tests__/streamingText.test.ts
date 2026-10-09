import { describe, expect, it } from "vitest";
import { createStreamingReplacement } from "../lib/utils/streamingText";

describe("streaming text helpers", () => {
  it("replaces the displayed value with each cumulative stream snapshot", () => {
    const stream = createStreamingReplacement("old prompt");

    expect(stream.replace("A")).toBe("A");
    expect(stream.replace("AB")).toBe("AB");
    expect(stream.replace("ABC")).toBe("ABC");
    expect(stream.value()).toBe("ABC");
  });

  it("keeps the original available for rollback", () => {
    const stream = createStreamingReplacement("stable prompt");
    stream.replace("partial");

    expect(stream.restore()).toBe("stable prompt");
  });
});
