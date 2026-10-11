import { describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
const { JSDOM } = createRequire(import.meta.url)("jsdom") as {
  JSDOM: new (
    html: string,
    options?: {
      url?: string;
      runScripts?: string;
      beforeParse?: (window: Window) => void;
    },
  ) => { window: Window & typeof globalThis };
};
import { sandboxResponse } from "../../deploy/mcp-app-sandbox/worker.mjs";

describe("fixed sandbox proxy program", () => {
  it("requires exact parent origin, hardens the inner document, and rejects replacement", async () => {
    const response = sandboxResponse(
      new Request("https://sandbox.example/sandbox"),
      { MCP_APPS_HOST_ORIGIN: "https://chat.example" },
    );
    const post = vi.fn();
    const dom = new JSDOM(await response.text(), {
      url: "https://sandbox.example/sandbox",
      runScripts: "dangerously",
      beforeParse(window) {
        window.postMessage = post;
      },
    });
    try {
      const { window } = dom;
      expect(post).toHaveBeenCalledWith(
        {
          jsonrpc: "2.0",
          method: "ui/notifications/sandbox-proxy-ready",
          params: {},
        },
        "https://chat.example",
      );
      const data = {
        jsonrpc: "2.0",
        method: "ui/notifications/sandbox-resource-ready",
        params: {
          html: '<html><head><base href="https://evil.example"><meta http-equiv="refresh" content="0;url=https://evil.example"></head><body><iframe src="https://evil.example"></iframe><form action="https://evil.example"><button formaction="https://evil.example">Go</button></form><img src="https://evil.example/a"><script>window.localApp = true</script></body></html>',
          sandbox: "allow-scripts allow-same-origin",
        },
      };
      const send = (origin: string) =>
        window.dispatchEvent(
          new window.MessageEvent("message", {
            data,
            origin,
            source: window as unknown as Window,
          }),
        );
      send("https://evil.example");
      expect(window.document.querySelector("iframe")).toBeNull();
      send("https://chat.example");
      const inner = window.document.querySelector("iframe")!;
      expect(inner.getAttribute("sandbox")).toBe("allow-scripts");
      const content = new JSDOM(inner.srcdoc);
      try {
        expect(
          content.window.document.querySelector(
            "iframe,base,meta[http-equiv=refresh]",
          ),
        ).toBeNull();
        expect(
          content.window.document.querySelector("form")?.hasAttribute("action"),
        ).toBe(false);
        expect(
          content.window.document.querySelector("img")?.hasAttribute("src"),
        ).toBe(false);
        expect(
          content.window.document.querySelector("meta")?.content,
        ).toContain("form-action 'none'");
        expect(inner.srcdoc).toContain("window.localApp = true");
      } finally {
        content.window.close();
      }
      const forward = vi.spyOn(inner.contentWindow!, "postMessage");
      const error = vi.fn((event: ErrorEvent) => event.preventDefault());
      window.addEventListener("error", error);
      post.mockClear();
      const cyclic: Record<string, unknown> = {};
      cyclic.self = cyclic;
      for (const params of [cyclic, { value: BigInt(1) }]) {
        for (const [source, origin] of [
          [window, "https://chat.example"],
          [inner.contentWindow, "null"],
        ] as const) {
          window.dispatchEvent(
            new window.MessageEvent("message", {
              data: { jsonrpc: "2.0", id: 5, method: "ping", params },
              source: source as Window,
              origin,
            }),
          );
        }
      }
      expect(error).not.toHaveBeenCalled();
      expect(post).not.toHaveBeenCalled();
      expect(forward).not.toHaveBeenCalled();
      expect(window.document.querySelector("iframe")).toBe(inner);
      window.removeEventListener("error", error);
      forward.mockRestore();
      send("https://chat.example");
      expect(window.document.querySelector("iframe")).toBeNull();
      expect(post).toHaveBeenLastCalledWith(
        { jsonrpc: "2.0", method: "neo/mcp-app-failed" },
        "https://chat.example",
      );
    } finally {
      dom.window.close();
    }
  });
});
