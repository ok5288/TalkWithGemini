import { describe, expect, it } from "vitest";
import {
  createHtmlRuntimeGuards,
  HTML_RUNTIME_LIMITS,
} from "@/lib/intelligentUi/runtimeLimits";

const guards = createHtmlRuntimeGuards(HTML_RUNTIME_LIMITS);
describe("HTML runtime input limits", () => {
  it("copies accepted state at the call and preserves JSON keys safely", () => {
    const input = JSON.parse('{"nested":{"value":1},"__proto__":{"x":2}}');
    const saved = guards.state(input);
    input.nested.value = 99;
    expect(saved).toEqual({ nested: { value: 1 }, ["__proto__"]: { x: 2 } });
    expect(Object.getPrototypeOf(saved)).toBeNull();
  });
  it("uses the UTF-8 JSON size including escaping and key overhead", () => {
    const value = { message: '漢字😀\n"\\\ud800' };
    const size = new TextEncoder().encode(JSON.stringify(value)).length;
    expect(
      createHtmlRuntimeGuards({
        ...HTML_RUNTIME_LIMITS,
        stateBytes: size,
      }).state(value),
    ).toEqual(value);
    expect(() =>
      createHtmlRuntimeGuards({
        ...HTML_RUNTIME_LIMITS,
        stateBytes: size - 1,
      }).state(value),
    ).toThrow("runtime_limit");
  });
  it("rejects cycles, non-JSON values, accessors and excess depth", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const getter = {
      get x() {
        throw new Error("getter ran");
      },
    };
    for (const value of [
      cyclic,
      getter,
      { x: undefined },
      { x: Infinity },
      { x: new Date() },
      [],
    ])
      expect(() => guards.state(value)).toThrow("invalid_state");
    let deep: Record<string, unknown> = {};
    for (let index = 0; index < 25; index++) deep = { child: deep };
    expect(() => guards.state(deep)).toThrow("runtime_limit");
  });
  it("bounds arrays and strings without truncating the caller's content", () => {
    const value = { text: "x".repeat(HTML_RUNTIME_LIMITS.stateBytes) };
    expect(() => guards.state(value)).toThrow("runtime_limit");
    expect(value.text.length).toBe(HTML_RUNTIME_LIMITS.stateBytes);
    expect(() => guards.state({ rows: Array(100000).fill(null) })).toThrow(
      "runtime_limit",
    );
    expect(guards.text("😀", 4)).toBe("😀");
    expect(() => guards.text("😀", 3)).toThrow("runtime_limit");
  });
  it("clamps finite height and rejects invalid measurements", () => {
    expect(guards.height(999999)).toBe(16384);
    expect(guards.height(1.2)).toBe(2);
    for (const value of [-1, NaN, Infinity, "4"])
      expect(() => guards.height(value)).toThrow("invalid_update");
  });
});
