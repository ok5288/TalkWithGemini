import { describe, expect, it, vi } from "vitest";
import { convertSchemaToGemini } from "@/lib/utils/schema";

describe("legacy Gemini schema conversion", () => {
  it("preserves nullable unions and supported constraints without mutation", () => {
    const schema = {
      type: ["string", "number", "null"],
      minLength: 2,
      minimum: 0,
      default: 0,
      anyOf: [{ type: "string", pattern: "^a" }, { type: "number" }],
    };
    const before = JSON.stringify(schema);
    expect(convertSchemaToGemini(schema)).toMatchObject({
      nullable: true,
      anyOf: [
        { type: "STRING", minLength: "2", minimum: 0 },
        { type: "NUMBER", minLength: "2", minimum: 0 },
      ],
    });
    expect(JSON.stringify(schema)).toBe(before);
  });
  it("resolves escaped local pointers", () => {
    expect(
      convertSchemaToGemini({
        type: "object",
        $defs: { "a/b~c": { type: ["string", "null"], maxLength: 10 } },
        properties: { value: { $ref: "#/$defs/a~1b~0c" } },
      }),
    ).toEqual({
      type: "OBJECT",
      properties: {
        value: { type: "STRING", nullable: true, maxLength: "10" },
      },
    });
  });
  it("preserves nested anyOf and SDK constraints including zero values", () => {
    expect(
      convertSchemaToGemini({
        type: "object",
        minProperties: 0,
        maxProperties: 2,
        required: ["items"],
        properties: {
          items: {
            type: "array",
            minItems: 0,
            maxItems: 3,
            items: {
              anyOf: [
                {
                  type: "string",
                  enum: ["a"],
                  format: "enum",
                  minLength: 0,
                  maxLength: 5,
                },
                { type: "null" },
              ],
            },
          },
        },
      }),
    ).toEqual({
      type: "OBJECT",
      minProperties: "0",
      maxProperties: "2",
      required: ["items"],
      properties: {
        items: {
          type: "ARRAY",
          minItems: "0",
          maxItems: "3",
          items: {
            anyOf: [
              {
                type: "STRING",
                enum: ["a"],
                format: "enum",
                minLength: "0",
                maxLength: "5",
              },
              { type: "NULL" },
            ],
          },
        },
      },
    });
  });
  it("resolves array pointers and repeated references independently", () => {
    const schema = {
      anyOf: [{ type: "string" }],
      properties: {
        a: { $ref: "#/anyOf/0", description: "a" },
        b: { $ref: "#/anyOf/0" },
      },
    };
    expect(convertSchemaToGemini(schema)).toMatchObject({
      properties: {
        a: { type: "STRING", description: "a" },
        b: { type: "STRING" },
      },
    });
  });
  it.each([
    { $ref: "https://example.com/schema" },
    { $ref: "#/$defs/missing" },
    { $ref: "#" },
    {
      $defs: { a: { $ref: "#/$defs/b" }, b: { $ref: "#/$defs/a" } },
      $ref: "#/$defs/a",
    },
    { $defs: { x: { type: "string" } }, $ref: "#/$defs/x", type: "number" },
  ])("rejects incompatible references with tool and path", (schema) => {
    expect(() => convertSchemaToGemini(schema, "lookup")).toThrow(/lookup.*#/);
  });
  it("logs only unsupported keyword paths", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    convertSchemaToGemini({
      type: "object",
      additionalProperties: { description: "secret-value" },
    });
    expect(warn).toHaveBeenCalled();
    expect(JSON.stringify(warn.mock.calls)).not.toContain("secret-value");
    warn.mockRestore();
  });
});
