import { GoogleGenAI } from "@google/genai";
import { describe, expect, it, vi } from "vitest";
import { streamGeminiResponse } from "@/lib/streaming/gemini";
import { convertSchemaToGemini } from "@/lib/utils/schema";

describe("Gemini SDK wire schema", () => {
  it.each(["v1beta", "v1"])(
    "serializes only the selected parameter format for %s",
    async (apiVersion) => {
      const schema = {
        type: "object",
        properties: { value: { type: ["string", "null"], minLength: 1 } },
        $defs: { x: { type: "string" } },
        additionalProperties: false,
      };
      const parameters =
        apiVersion === "v1beta"
          ? { parametersJsonSchema: schema }
          : {
              parameters: convertSchemaToGemini({
                type: "object",
                properties: schema.properties,
              }),
            };
      const fetchMock = vi.fn(
        async () =>
          new Response(
            'data: {"candidates":[{"content":{"role":"model","parts":[{"text":"ok"}]},"finishReason":"STOP"}]}\n\n',
            { headers: { "Content-Type": "text/event-stream" } },
          ),
      );
      vi.stubGlobal("fetch", fetchMock);
      try {
        const client = new GoogleGenAI({
          apiKey: "test-key",
          apiVersion,
          httpOptions: { baseUrl: "https://example.com" },
        });
        await streamGeminiResponse({
          client,
          model: "gemini-2.5-flash",
          contents: [{ role: "user", parts: [{ text: "hi" }] }],
          tools: [{ name: "lookup", ...parameters }, { name: "noop" }],
          onChunk: () => {},
        });
        const init = (
          fetchMock.mock.calls[0] as unknown as [string, RequestInit]
        )[1];
        const body = JSON.parse(String(init.body));
        expect(body.tools[0].functionDeclarations).toEqual([
          { name: "lookup", ...parameters },
          { name: "noop" },
        ]);
      } finally {
        vi.unstubAllGlobals();
      }
    },
  );
});
