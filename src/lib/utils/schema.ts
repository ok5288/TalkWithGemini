/**
 * Schema 转换工具
 */

import { Type, type FunctionDeclaration, type Schema } from "@google/genai";
import { logDevWarn } from "./devLogger";

const scalarKeys = new Set([
  "description",
  "title",
  "format",
  "pattern",
  "minimum",
  "maximum",
  "nullable",
  "default",
  "example",
  "required",
  "propertyOrdering",
]);
const countKeys = new Set([
  "minItems",
  "maxItems",
  "minLength",
  "maxLength",
  "minProperties",
  "maxProperties",
]);
const structuralKeys = new Set([
  "type",
  "properties",
  "items",
  "anyOf",
  "enum",
]);
const metadataKeys = new Set([
  "$defs",
  "definitions",
  "$schema",
  "$id",
  "$comment",
]);
const pointerToken = (key: string) =>
  key.replace(/~/g, "~0").replace(/\//g, "~1");
const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/** Convert only for explicitly configured legacy API versions. The executor
 * retains the original JSON Schema; unsupported constraints are never removed
 * from execution-time validation. */
export function convertSchemaToGemini(
  openAISchema: unknown,
  toolName = "anonymous",
): FunctionDeclaration["parameters"] {
  if (openAISchema == null) return undefined;
  const fail = (path: string, reason: string): never => {
    throw new Error(
      `Gemini schema compatibility error for tool "${toolName}" at ${path}: ${reason}`,
    );
  };
  const warn = (path: string, keyword: string) =>
    logDevWarn("[Gemini schema] Unsupported keyword", { path, keyword });

  const convert = (input: unknown, path: string, refs: Set<string>): Schema => {
    if (!isRecord(input)) return fail(path, "expected an object schema");
    let schema = input;
    if ("$ref" in schema) {
      const ref = schema.$ref;
      if (typeof ref !== "string" || (ref !== "#" && !ref.startsWith("#/")))
        return fail(path, "only local JSON Pointer references are supported");
      if (refs.has(ref)) return fail(path, "circular reference");
      let target: unknown = openAISchema;
      let tokens: string[];
      try {
        tokens = decodeURIComponent(ref.slice(1)).split("/").slice(1);
      } catch {
        return fail(path, "invalid reference encoding");
      }
      for (const token of tokens) {
        if (/~(?:[^01]|$)/.test(token))
          return fail(path, "invalid JSON Pointer");
        const key = token.replace(/~1/g, "/").replace(/~0/g, "~");
        if (
          (!isRecord(target) && !Array.isArray(target)) ||
          !Object.hasOwn(target, key) ||
          (Array.isArray(target) && !/^(0|[1-9][0-9]*)$/.test(key))
        )
          return fail(path, "missing reference target");
        target = (target as Record<string, unknown>)[key];
      }
      if (!isRecord(target)) return fail(path, "invalid reference target");
      const siblings = Object.fromEntries(
        Object.entries(schema).filter(
          ([key]) => key !== "$ref" && !metadataKeys.has(key),
        ),
      );
      for (const key of Object.keys(siblings)) {
        if (
          Object.hasOwn(target, key) &&
          JSON.stringify(target[key]) !== JSON.stringify(siblings[key])
        )
          return fail(path, `conflicting reference sibling: ${key}`);
      }
      return convert({ ...target, ...siblings }, path, new Set([...refs, ref]));
    }
    if (Array.isArray(schema.type)) {
      const types = [...new Set(schema.type)];
      const nonNull = types.filter((type) => type !== "null");
      if (nonNull.length > 1) {
        return {
          anyOf: nonNull.map((type) =>
            convert({ ...schema, type }, path, refs),
          ),
          ...(types.includes("null") ? { nullable: true } : {}),
        };
      }
      schema = {
        ...schema,
        type: nonNull[0] ?? "null",
        ...(types.includes("null") && nonNull.length ? { nullable: true } : {}),
      };
    }
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(schema)) {
      if (scalarKeys.has(key)) result[key] = structuredClone(value);
      else if (countKeys.has(key)) result[key] = String(value);
      else if (!structuralKeys.has(key) && !metadataKeys.has(key))
        warn(path, key);
    }
    if (schema.type !== undefined) {
      if (
        typeof schema.type !== "string" ||
        !Object.values(Type).includes(schema.type.toUpperCase() as Type)
      )
        return fail(path, "unsupported schema type");
      result.type = schema.type.toUpperCase();
    }
    if (schema.enum !== undefined) {
      if (
        Array.isArray(schema.enum) &&
        schema.enum.every((value) => typeof value === "string")
      )
        result.enum = [...schema.enum];
      else warn(path, "enum");
    }
    if (schema.properties !== undefined) {
      if (!isRecord(schema.properties)) return fail(path, "invalid properties");
      result.properties = Object.fromEntries(
        Object.entries(schema.properties).map(([key, value]) => [
          key,
          convert(value, `${path}/properties/${pointerToken(key)}`, refs),
        ]),
      );
    }
    if (schema.items !== undefined)
      result.items = convert(schema.items, `${path}/items`, refs);
    if (schema.anyOf !== undefined) {
      if (!Array.isArray(schema.anyOf)) return fail(path, "invalid anyOf");
      result.anyOf = schema.anyOf.map((value, index) =>
        convert(value, `${path}/anyOf/${index}`, refs),
      );
    }
    return result as Schema;
  };
  return convert(openAISchema, "#", new Set());
}

/**
 * 将 Gemini 格式的工具转换为 OpenAI 格式
 */
export function convertGeminiToolsToOpenAI(geminiTools: any[]): any[] {
  return geminiTools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: convertGeminiSchemaToOpenAI(tool.parameters),
    },
  }));
}

/**
 * 将 Gemini Schema 转换为 OpenAI 格式
 */
function convertGeminiSchemaToOpenAI(geminiSchema: any): any {
  if (!geminiSchema) return {};

  const convert = (schema: any): any => {
    if (!schema || typeof schema !== "object") return schema;

    const result: any = {};

    if (schema.type) {
      result.type = schema.type.toLowerCase();
    }

    if (schema.description) result.description = schema.description;
    if (schema.enum) result.enum = schema.enum;

    if (schema.properties) {
      result.properties = {};
      for (const [key, value] of Object.entries(schema.properties)) {
        result.properties[key] = convert(value);
      }
    }

    if (schema.items) {
      result.items = convert(schema.items);
    }

    if (schema.required) {
      result.required = schema.required;
    }

    return result;
  };

  return convert(geminiSchema);
}
