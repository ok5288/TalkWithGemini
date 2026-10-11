// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { HtmlUiFrame } from "@/components/content/intelligentUi/HtmlUiFrame";
import { createRequire } from "node:module";

// jsdom is the installed test environment; its optional type package is absent.
const { JSDOM } = createRequire(import.meta.url)("jsdom") as {
  JSDOM: new (
    html: string,
    options: { runScripts: "dangerously" },
  ) => {
    window: Window & typeof globalThis;
  };
};
import { readFileSync } from "node:fs";
import {
  prepareIntelligentHtml,
  createIntelligentHtmlPreview,
} from "@/lib/intelligentUi/htmlPolicy";
import {
  getIntelligentUiSandboxDocument,
  INTELLIGENT_UI_SANDBOX_CSP,
} from "@/lib/intelligentUi/sandbox";
import { GET } from "@/app/intelligent-ui/sandbox/route";

describe("Intelligent UI HTML policy", () => {
  it("uses inert templates and preserves full-document head and body contents", () => {
    const parse = vi.spyOn(DOMParser.prototype, "parseFromString");
    try {
      const result = prepareIntelligentHtml(
        '<!doctype html><html><head><meta charset="utf-8"><style>p{color:red}</style><script>window.headLoaded=true</script></head><body><p>Body</p><script>window.bodyLoaded=true</script></body></html>',
        true,
      );
      expect(result.html).toContain("<style>p{color:red}</style>");
      expect(result.html).toContain("<p>Body</p>");
      expect(result.scripts).toEqual([
        { source: "window.headLoaded=true" },
        { source: "window.bodyLoaded=true" },
      ]);
      const preview = createIntelligentHtmlPreview(
        '<img src="https://example.com/tracker"><iframe src="https://example.com/frame"></iframe><p>Safe</p>',
      );
      expect(preview).not.toContain("https://example.com");
      expect(parse).not.toHaveBeenCalled();
    } finally {
      parse.mockRestore();
    }
  });
  it("produces an inert preview of incomplete HTML", () => {
    const preview = createIntelligentHtmlPreview(
      '<p>Hello<script>window.x=1</script><input onfocus="fetch(1)"><iframe src="/">',
    );
    const doc = new DOMParser().parseFromString(preview, "text/html");
    expect(doc.querySelector("script,iframe")).toBeNull();
    expect(doc.querySelector("input")?.hasAttribute("onfocus")).toBe(false);
    expect(doc.querySelector("input")?.disabled).toBe(true);
    expect(doc.body.textContent).toContain("Hello");
  });
  it.each([
    '<script src="/script.js"></script>',
    '<script type="importmap">{"imports":{}}</script>',
    '<iframe src="/"></iframe>',
    '<form action="/"></form>',
    '<a href="/">Link</a>',
    '<meta http-equiv="refresh" content="0;url=/">',
    '<svg><use href="/a.svg"></use></svg>',
  ])("rejects forbidden runtime markup: %s", (source) => {
    expect(() => prepareIntelligentHtml(source, true)).toThrow();
  });
  it("preserves self-contained controls, SVG, CSS and plain scripts", () => {
    const result = prepareIntelligentHtml(
      '<style>p{color:red}</style><label for="x">Value</label><input id="x" type="range"><svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="2"/></svg><canvas></canvas><script>window.intelligentUi.setState({x:1})</script>',
      true,
    );
    expect(result.scripts).toEqual([
      { source: "window.intelligentUi.setState({x:1})" },
    ]);
    expect(result.html).not.toContain("<script");
    expect(result.html).toContain("<canvas>");
    expect(result.html).toContain("viewBox");
  });
});

describe("fixed sandbox runner", () => {
  it.each(["state", "snapshot", "summary"])(
    "delivers already validated updates before terminating on invalid %s",
    async (channel) => {
      const dom = new JSDOM(getIntelligentUiSandboxDocument(), {
        runScripts: "dangerously",
      });
      const win = dom.window;
      await new Promise<void>((resolve) =>
        win.addEventListener("load", () => resolve(), { once: true }),
      );
      win.ResizeObserver = class {
        observe() {}
        disconnect() {}
        unobserve() {}
      } as unknown as typeof ResizeObserver;
      const sent: Array<{ type: string; value?: unknown }> = [];
      const port = {
        onmessage: null as null | ((event: { data: unknown }) => void),
        start() {},
        postMessage(value: { type: string; value?: unknown }) {
          sent.push(value);
        },
      };
      try {
        win.dispatchEvent(
          new win.MessageEvent("message", {
            source: win,
            data: { type: "intelligent-ui-connect", identity: "failure" },
            ports: [port as unknown as MessagePort],
          }),
        );
        port.onmessage!({
          data: {
            type: "init",
            identity: "failure",
            state: {},
            source: "<p>Ready</p>",
          },
        });
        const api = (
          win as unknown as {
            intelligentUi: {
              setState(value: unknown): void;
              reportSnapshot(value: string): void;
              reportSummary(value: string): void;
            };
          }
        ).intelligentUi;
        sent.length = 0;
        api.setState({ lastLegal: 42 });
        api.reportSnapshot("Last legal result");
        api.reportSummary("Last legal summary");
        if (channel === "state")
          api.setState({ invalid: "x".repeat(256 * 1024) });
        else if (channel === "snapshot")
          api.reportSnapshot("x".repeat(64 * 1024 + 1));
        else api.reportSummary("x".repeat(8 * 1024 + 1));
        expect(sent.map((message) => message.type)).toEqual([
          "state",
          "snapshot",
          "summary",
          "error",
        ]);
        expect(sent[0]?.value).toEqual({ lastLegal: 42 });
        api.setState({ tooLate: true });
        expect(sent).toHaveLength(4);
      } finally {
        dom.window.close();
      }
    },
  );
  it("binds transport before generated code and copies coalesced state immediately", async () => {
    const dom = new JSDOM(getIntelligentUiSandboxDocument(), {
      runScripts: "dangerously",
    });
    const win = dom.window;
    await new Promise<void>((resolve) =>
      win.addEventListener("load", () => resolve(), { once: true }),
    );
    win.ResizeObserver = class {
      observe() {}
      disconnect() {}
      unobserve() {}
    } as unknown as typeof ResizeObserver;
    const sent: Array<{ type: string; value?: unknown }> = [];
    class Port {
      onmessage: null | ((event: { data: unknown }) => void) = null;
      start() {}
      postMessage(value: { type: string; value?: unknown }) {
        sent.push(value);
      }
    }
    Object.defineProperty(win, "MessagePort", { value: Port });
    const port = new Port();
    win.dispatchEvent(
      new win.MessageEvent("message", {
        source: win,
        data: { type: "intelligent-ui-connect", identity: "guarded" },
        ports: [port as unknown as MessagePort],
      }),
    );
    port.onmessage!({
      data: {
        type: "init",
        identity: "guarded",
        state: {},
        source: `<p>Safe</p><script>
      MessagePort.prototype.postMessage = function(value) { window.stolen = value; };
      const state = { value: 1 };
      window.intelligentUi.setState(state);
      state.value = 2;
      window.intelligentUi.reportSnapshot("one");
      window.intelligentUi.setState({ value: 3 });
      </script>`,
      },
    });
    expect((win as unknown as { stolen?: unknown }).stolen).toBeUndefined();
    expect(
      sent.filter((message) => ["state", "snapshot"].includes(message.type)),
    ).toEqual([
      { type: "snapshot", identity: "guarded", value: "one" },
      { type: "state", identity: "guarded", value: { value: 3 } },
    ]);
    const api = (
      win as unknown as {
        intelligentUi: {
          setState(value: unknown): void;
          reportSnapshot(value: string): void;
        };
      }
    ).intelligentUi;
    const mutable = { value: 4 };
    api.setState(mutable);
    mutable.value = 99;
    api.reportSnapshot("four");
    port.onmessage!({
      data: {
        type: "flush-updates",
        identity: "guarded",
        value: { requestId: "host-flush" },
      },
    });
    expect(sent.slice(-3)).toEqual([
      { type: "state", identity: "guarded", value: { value: 4 } },
      { type: "snapshot", identity: "guarded", value: "four" },
      {
        type: "updates-flushed",
        identity: "guarded",
        value: { requestId: "host-flush" },
      },
    ]);
    dom.window.close();
  });
  it("serves a private fixed shell with an independent restrictive CSP", async () => {
    const response = GET();
    expect(response.headers.get("X-Frame-Options")).toBeNull();
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Content-Security-Policy")).toBe(
      INTELLIGENT_UI_SANDBOX_CSP,
    );
    expect(INTELLIGENT_UI_SANDBOX_CSP).toContain(
      "sandbox allow-scripts allow-forms",
    );
    expect(INTELLIGENT_UI_SANDBOX_CSP).not.toContain("allow-same-origin");
    expect(INTELLIGENT_UI_SANDBOX_CSP).toContain("unsafe-eval");
    for (const directive of [
      "connect-src 'none'",
      "frame-src 'none'",
      "worker-src 'none'",
      "form-action 'none'",
    ])
      expect(INTELLIGENT_UI_SANDBOX_CSP).toContain(directive);
    expect(await response.text()).not.toContain("document.write");
  });
  it("initializes once only over its parent-bound port and rejects stale identities", async () => {
    const dom = new JSDOM(getIntelligentUiSandboxDocument(), {
      runScripts: "dangerously",
    });
    const win = dom.window;
    await new Promise<void>((resolve) =>
      win.addEventListener("load", () => resolve(), { once: true }),
    );
    win.ResizeObserver = class {
      observe() {}
      disconnect() {}
      unobserve() {}
    } as unknown as typeof ResizeObserver;
    const sent: unknown[] = [];
    const port = {
      onmessage: null as null | ((e: { data: unknown }) => void),
      start() {},
      postMessage(value: unknown) {
        sent.push(value);
      },
    };
    const connect = (source: unknown) =>
      win.dispatchEvent(
        new win.MessageEvent("message", {
          source: source as Window,
          data: {
            type: "intelligent-ui-connect",
            identity: "session:message:block:epoch",
          },
          ports: [port as unknown as MessagePort],
        }),
      );
    connect(null);
    expect(port.onmessage).toBeNull();
    connect(win);
    expect(sent).toContainEqual({
      type: "connected",
      identity: "session:message:block:epoch",
      value: true,
    });
    const source =
      "<p>Loaded</p><script>window.executions=(window.executions||0)+1;window.intelligentUi.setState({count:3});document.addEventListener('DOMContentLoaded',()=>{window.readyExecutions=(window.readyExecutions||0)+1})</script>";
    port.onmessage!({ data: { type: "init", identity: "stale", source } });
    expect(
      win.document.getElementById("intelligent-ui-root")?.textContent,
    ).toBe("");
    const init = {
      data: {
        type: "init",
        identity: "session:message:block:epoch",
        source,
        state: { count: 2 },
      },
    };
    port.onmessage!(init);
    port.onmessage!(init);
    expect((win as unknown as { executions: number }).executions).toBe(1);
    expect(
      (win as unknown as { readyExecutions: number }).readyExecutions,
    ).toBe(1);
    expect(sent).toContainEqual({
      type: "state",
      identity: "session:message:block:epoch",
      value: { count: 3 },
    });
    dom.window.close();
  });
  it("excludes the exact runner from global headers and PWA shell fallback", () => {
    const config = readFileSync("next.config.ts", "utf8");
    expect(config).toContain("/((?!intelligent-ui/sandbox/?$).*)");
    const worker = readFileSync("public/sw-runtime.js", "utf8");
    expect(worker).toContain('url.pathname === "/intelligent-ui/sandbox" ||');
    expect(worker).toContain('url.pathname === "/intelligent-ui/sandbox/" ||');
  });
});

describe("HTML frame lifecycle", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });
  it("never opens a bridge or grants scripts to a partial preview", () => {
    const channel = vi.fn();
    vi.stubGlobal("MessageChannel", channel);
    const { container } = render(
      createElement(HtmlUiFrame, {
        source: "<p>Partial<script>bad()",
        complete: false,
        instanceId: "partial",
        title: "Preview",
        onStateChange: vi.fn(),
      }),
    );
    const iframe = container.querySelector("iframe")!;
    fireEvent.load(iframe);
    expect(iframe.getAttribute("sandbox")).toBe("");
    expect(iframe.getAttribute("src")).toBeNull();
    expect(iframe.srcdoc).not.toContain("<script>");
    expect(channel).not.toHaveBeenCalled();
  });
  it("rejects wrong identities and drops late state after cleanup", () => {
    const port = {
      onmessage: null as null | ((event: { data: unknown }) => void),
      postMessage: vi.fn(),
      start: vi.fn(),
      close: vi.fn(),
    };
    vi.stubGlobal(
      "MessageChannel",
      class {
        port1 = port;
        port2 = {};
      },
    );
    const onStateChange = vi.fn();
    const onSnapshot = vi.fn();
    const { container, unmount } = render(
      createElement(HtmlUiFrame, {
        source: "<p>Ready</p>",
        complete: true,
        instanceId: "session:message:block:v1",
        title: "Ready",
        onStateChange,
        onSnapshot,
      }),
    );
    const iframe = container.querySelector("iframe")!;
    expect(iframe.getAttribute("sandbox")).toBe("allow-scripts allow-forms");
    const post = vi
      .spyOn(iframe.contentWindow!, "postMessage")
      .mockImplementation(() => {});
    fireEvent.load(iframe);
    const identity = (post.mock.calls[0][0] as { identity: string }).identity;
    port.onmessage!({ data: { type: "connected", identity } });
    port.onmessage!({ data: { type: "ready", identity } });
    port.onmessage!({
      data: { type: "state", identity: "other", value: { secret: 1 } },
    });
    expect(onStateChange).not.toHaveBeenCalled();
    port.onmessage!({ data: { type: "state", identity, value: { count: 1 } } });
    expect(onStateChange).toHaveBeenCalledWith({ count: 1 });
    const snapshot = "x < y; <input> is literal text, not HTML";
    port.onmessage!({ data: { type: "snapshot", identity, value: snapshot } });
    expect(onSnapshot).toHaveBeenCalledWith(snapshot);
    act(() =>
      port.onmessage!({ data: { type: "height", identity, value: 1400 } }),
    );
    expect(iframe.style.height).toBe("1400px");
    act(() =>
      port.onmessage!({ data: { type: "height", identity, value: 45 } }),
    );
    expect(iframe.style.height).toBe("45px");
    act(() =>
      port.onmessage!({ data: { type: "height", identity, value: -1 } }),
    );
    expect(iframe.style.height).toBe("45px");

    unmount();
    port.onmessage!({ data: { type: "state", identity, value: { count: 2 } } });
    expect(onStateChange).toHaveBeenCalledTimes(1);
    expect(port.close).toHaveBeenCalled();
  });
});

it("fails a runner that never acknowledges readiness within five seconds", () => {
  vi.useFakeTimers();
  const onError = vi.fn();
  const view = render(
    createElement(HtmlUiFrame, {
      source: "<p>Safe</p>",
      complete: true,
      instanceId: "timeout",
      title: "Timeout",
      onStateChange: vi.fn(),
      onError,
    }),
  );
  act(() => {
    vi.advanceTimersByTime(5000);
  });
  expect(onError).toHaveBeenCalledWith("startup_timeout");
  expect(view.getByTitle("Timeout").getAttribute("sandbox")).toBe("");
  view.unmount();
  vi.useRealTimers();
});

describe("local forms", () => {
  it("preserves forms, association and constraints but strips activity in previews", () => {
    const source =
      '<form id="f"><input name="goal" required pattern="[A-Z]+"><button type="submit">Save</button><button type="reset">Reset</button></form><input form="f" name="extra">';
    const result = prepareIntelligentHtml(source, true);
    expect(result.html).toContain('<form id="f">');
    expect(result.html).toContain('form="f"');
    expect(result.html).toContain('pattern="[A-Z]+"');
    const template = document.createElement("template");
    template.innerHTML = createIntelligentHtmlPreview(source);
    expect(
      template.content.querySelectorAll("input:disabled,button:disabled"),
    ).toHaveLength(4);
  });
  it.each([
    "action",
    "target",
    "method",
    "enctype",
    "formaction",
    "formtarget",
    "formmethod",
    "formenctype",
  ])("rejects navigation attribute %s", (attribute) => {
    expect(() =>
      prepareIntelligentHtml(
        `<form><button ${attribute}="/">Submit</button></form>`,
        true,
      ),
    ).toThrow();
  });
  it("prevents native navigation while preserving local submit, validation and reset", async () => {
    const dom = new JSDOM(getIntelligentUiSandboxDocument(), {
      runScripts: "dangerously",
    });
    const win = dom.window;
    await new Promise<void>((resolve) =>
      win.addEventListener("load", () => resolve(), { once: true }),
    );
    win.ResizeObserver = class {
      observe() {}
      disconnect() {}
      unobserve() {}
    } as unknown as typeof ResizeObserver;
    const sent: { type: string; value: unknown }[] = [];
    const port = {
      onmessage: null as null | ((event: { data: unknown }) => void),
      start() {},
      postMessage(value: { type: string; value: unknown }) {
        sent.push(value);
      },
    };
    win.dispatchEvent(
      new win.MessageEvent("message", {
        source: win,
        data: { type: "intelligent-ui-connect", identity: "form" },
        ports: [port as unknown as MessagePort],
      }),
    );
    port.onmessage!({
      data: {
        type: "init",
        identity: "form",
        source:
          '<form id="f"><input id="goal" required><button type="submit">Submit</button><button type="reset">Reset</button></form><script>document.querySelector("form").addEventListener("submit",e=>intelligentUi.setState({goal:document.querySelector("input").value,prevented:e.defaultPrevented}));document.querySelector("form").addEventListener("reset",()=>intelligentUi.reportSummary("reset"));</script>',
      },
    });
    const form = win.document.querySelector("form")!;
    const input = win.document.querySelector("input")!;
    expect(form.checkValidity()).toBe(false);
    expect(sent.filter((item) => item.type === "state")).toHaveLength(0);
    input.value = "Study";
    expect(form.checkValidity()).toBe(true);
    const submit = new win.Event("submit", { bubbles: true, cancelable: true });
    form.dispatchEvent(submit);
    expect(submit.defaultPrevented).toBe(true);
    await new Promise((resolve) => win.setTimeout(resolve, 110));
    expect(sent).toContainEqual({
      type: "state",
      identity: "form",
      value: { goal: "Study", prevented: true },
    });
    form.reset();
    expect(input.value).toBe("");
    await new Promise((resolve) => win.setTimeout(resolve, 110));
    expect(sent).toContainEqual({
      type: "summary",
      identity: "form",
      value: "reset",
    });
    dom.window.close();
  });
});

describe("expanded HTML and runtime resources", () => {
  it("preserves semantic HTML, MathML, local SVG, templates, media and responsive images", () => {
    const result = prepareIntelligentHtml(
      '<dialog open><datalist id="v"><option value="A"></datalist><math><mi>x</mi></math><svg><use href="#shape"/></svg><video controls poster="https://example.com/poster.jpg"><source src="https://example.com/movie.mp4"></video><img srcset="https://example.com/one.png 1x, https://example.com/two.png 2x"><template><p data-test="yes">Inner</p></template></dialog>',
      true,
    );
    expect(result.html).toContain('<dialog open="">');
    expect(result.html).toContain("<math>");
    expect(result.html).toContain('href="#shape"');
    expect(result.html).toContain(
      'srcset="https://example.com/one.png 1x, https://example.com/two.png 2x"',
    );
    expect(result.html).toContain("<template>");
    expect(
      prepareIntelligentHtml(
        '<template><button onclick="this.textContent=1">Count</button></template>',
        true,
      ).html,
    ).toContain('onclick="this.textContent=1"');
    expect(
      createIntelligentHtmlPreview(
        '<template><img onerror="evil()"></template>',
      ),
    ).not.toContain("onerror");
    expect(
      createIntelligentHtmlPreview(
        '<template><img src="https://example.com/a"></template>',
      ),
    ).not.toContain("https://example.com");
  });
  it("preserves ordered CDN resources and integrity, while rejecting spoofed origins", () => {
    const result = prepareIntelligentHtml(
      '<script>first()</script><link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/a/1/a.css" integrity="sha384-test"><script src="https://cdn.jsdelivr.net/npm/a@1/a.js"></script><script>last()</script>',
      true,
    );
    expect(result.resources.map((item) => item.kind)).toEqual([
      "script",
      "style",
      "script",
      "script",
    ]);
    expect(result.resources[1].integrity).toBe("sha384-test");
    for (const url of [
      "https://unpkg.com.evil.test/a",
      "https://unpkg.com:444/a",
      "https://cdn.jsdelivr.net/gh/a",
      "http://unpkg.com/a",
    ])
      expect(() =>
        prepareIntelligentHtml(`<script src="${url}"></script>`, true),
      ).toThrow();
  });
});

async function bootRuntime(
  source: string,
  beforeInit?: (win: Window & typeof globalThis) => void,
) {
  const dom = new JSDOM(getIntelligentUiSandboxDocument(), {
    runScripts: "dangerously",
  });
  const win = dom.window;
  await new Promise<void>((resolve) =>
    win.addEventListener("load", () => resolve(), { once: true }),
  );
  win.ResizeObserver = class {
    observe() {}
    disconnect() {}
    unobserve() {}
  } as unknown as typeof ResizeObserver;
  win.URL.createObjectURL = vi.fn(() => "blob:https://example.test/module");
  win.URL.revokeObjectURL = vi.fn();
  const sent: Array<{ type: string; value: unknown }> = [];
  const port = {
    onmessage: null as null | ((event: { data: unknown }) => Promise<void>),
    start() {},
    postMessage(value: { type: string; value: unknown }) {
      sent.push(value);
    },
  };
  win.dispatchEvent(
    new win.MessageEvent("message", {
      source: win,
      data: { type: "intelligent-ui-connect", identity: "test" },
      ports: [port as unknown as MessagePort],
    }),
  );
  beforeInit?.(win);
  const ready = port.onmessage!({
    data: { type: "init", identity: "test", source },
  });
  return { dom, win, sent, ready };
}

it("waits for styles and scripts in document order before continuing", async () => {
  const r = await bootRuntime(
    '<script>window.order=["first"]</script><link rel="stylesheet" href="https://unpkg.com/a@1/a.css" integrity="sha384-test"><script src="https://unpkg.com/a@1/a.js"></script><script>window.order.push("last")</script>',
  );
  try {
    const link = r.win.document.querySelector("link")!;
    expect(link.integrity).toBe("sha384-test");
    expect(link.crossOrigin).toBe("anonymous");
    expect(r.win.document.querySelector("script[src]")).toBeNull();
    link.dispatchEvent(new r.win.Event("load"));
    await Promise.resolve();
    const script = r.win.document.querySelector("script[src]")!;
    expect(script).not.toBeNull();
    script.dispatchEvent(new r.win.Event("load"));
    await r.ready;
    expect((r.win as unknown as { order: string[] }).order).toEqual([
      "first",
      "last",
    ]);
    expect(r.sent).toContainEqual(expect.objectContaining({ type: "ready" }));
  } finally {
    r.dom.window.close();
  }
});

it("stops initialization after a failed external resource", async () => {
  const r = await bootRuntime(
    '<script src="https://unpkg.com/a@1/a.js"></script><script>window.afterFailure=true</script>',
  );
  try {
    r.win.document
      .querySelector("script[src]")!
      .dispatchEvent(new r.win.Event("error"));
    await r.ready;
    expect(
      (r.win as unknown as { afterFailure?: boolean }).afterFailure,
    ).toBeUndefined();
    expect(r.sent).toContainEqual(
      expect.objectContaining({
        type: "error",
        value: expect.objectContaining({ code: "resource_failed" }),
      }),
    );
    expect(r.sent.some((message) => message.type === "ready")).toBe(false);
  } finally {
    r.dom.window.close();
  }
});

it("refuses startup calls and synthetic button activation", async () => {
  const r = await bootRuntime(
    '<button data-neo-ai-action>Ask</button><script>window.results=[];intelligentUi.sendMessage("startup").then(r=>results.push(r));document.querySelector("button").addEventListener("click",()=>intelligentUi.sendMessage("synthetic").then(r=>results.push(r)));document.querySelector("button").click()</script>',
  );
  try {
    await r.ready;
    expect((r.win as unknown as { results: unknown[] }).results).toEqual([
      { ok: false, code: "user_action_required" },
      { ok: false, code: "user_action_required" },
    ]);
    expect(r.sent.some((message) => message.type === "send-message")).toBe(
      false,
    );
  } finally {
    r.dom.window.close();
  }
});

it("enforces per-resource and overall startup deadlines and cancels pending loads", async () => {
  for (const deadline of [10000, 30000]) {
    const timers = new Map<number, () => void>();
    const r = await bootRuntime(
      '<script src="https://unpkg.com/a@1/a.js"></script><script>window.afterTimeout=true</script>',
      (win) => {
        vi.spyOn(win, "setTimeout").mockImplementation(((
          handler: () => void,
          delay: number,
        ) => {
          timers.set(delay, handler);
          return delay;
        }) as typeof win.setTimeout);
      },
    );
    try {
      timers.get(deadline)!();
      await r.ready;
      expect(r.win.document.querySelector("script[src]")).toBeNull();
      expect(
        (r.win as unknown as { afterTimeout?: boolean }).afterTimeout,
      ).toBeUndefined();
      expect(r.sent).toContainEqual(
        expect.objectContaining({
          type: "error",
          value: expect.objectContaining({
            code:
              deadline === 10000
                ? "resource_timeout"
                : "initialization_timeout",
          }),
        }),
      );
    } finally {
      r.dom.window.close();
    }
  }
});

describe("HTML syntax compatibility", () => {
  it("keeps inline events executable while removing them from previews", async () => {
    const source =
      "<button onclick=\"this.textContent = new Function('return 6 * 7')()\">Calculate</button>";
    expect(prepareIntelligentHtml(source, true).html).toContain("onclick=");
    expect(createIntelligentHtmlPreview(source)).not.toContain("onclick=");
    const r = await bootRuntime(source);
    try {
      await r.ready;
      const button = r.win.document.querySelector("button")!;
      button.click();
      expect(button.textContent).toBe("42");
      expect(r.sent.some((message) => message.type === "error")).toBe(false);
    } finally {
      r.dom.window.close();
    }
  });

  it("keeps JSON data blocks readable without executing them", async () => {
    const source =
      '<script id="data" type="application/json">{"answer":42}</script><script>window.intelligentUi.setState(JSON.parse(document.getElementById("data").textContent))</script>';
    const r = await bootRuntime(source);
    try {
      await r.ready;
      expect(r.sent).toContainEqual({
        type: "state",
        identity: "test",
        value: { answer: 42 },
      });
      expect(r.sent.some((message) => message.type === "error")).toBe(false);
      expect(createIntelligentHtmlPreview(source)).not.toContain("<script");
    } finally {
      r.dom.window.close();
    }
  });

  it.each([
    '<script type="module">window.moduleLoaded = true</script>',
    '<script type="module" src="https://cdn.jsdelivr.net/npm/example@1/module.js"></script>',
  ])("waits for the module load event before readiness: %s", async (module) => {
    const r = await bootRuntime(
      module +
        "<script>window.intelligentUi.setState({afterModule:true})</script>",
    );
    try {
      const script = r.win.document.querySelector('script[type="module"]');
      expect(script).not.toBeNull();
      if (!module.includes(" src=")) {
        expect(script!.getAttribute("src")).toBe(
          "blob:https://example.test/module",
        );
        expect(r.win.URL.createObjectURL).toHaveBeenCalledOnce();
      }
      expect(r.sent.some((message) => message.type === "ready")).toBe(false);
      expect(r.sent.some((message) => message.type === "state")).toBe(false);
      // jsdom does not execute modules; simulate the browser's module load event.
      script!.dispatchEvent(new r.win.Event("load"));
      await r.ready;
      if (!module.includes(" src="))
        expect(r.win.URL.revokeObjectURL).toHaveBeenCalledWith(
          "blob:https://example.test/module",
        );
      expect(r.sent).toContainEqual({
        type: "state",
        identity: "test",
        value: { afterModule: true },
      });
      expect(r.sent.some((message) => message.type === "ready")).toBe(true);
    } finally {
      r.dom.window.close();
    }
  });

  it("allows event handlers and dynamic compilation only inside the isolated runner", () => {
    expect(INTELLIGENT_UI_SANDBOX_CSP).toContain(
      "script-src-attr 'unsafe-inline'",
    );
    expect(INTELLIGENT_UI_SANDBOX_CSP).toContain("'unsafe-eval'");
    expect(INTELLIGENT_UI_SANDBOX_CSP).toContain("blob:");
    expect(INTELLIGENT_UI_SANDBOX_CSP).not.toContain("allow-same-origin");
    expect(INTELLIGENT_UI_SANDBOX_CSP).toContain("connect-src 'none'");
  });
});

it.each([
  '<script type="module">import "https://unpkg.com/example@1/module.js"</script>',
  '<script type="module" src="https://unpkg.com/example@1/module.js"></script>',
])("stops module initialization on resource failure: %s", async (source) => {
  const r = await bootRuntime(
    source +
      "<script>window.intelligentUi.setState({unexpected:true})</script>",
  );
  try {
    r.win.document
      .querySelector('script[type="module"]')!
      .dispatchEvent(new r.win.Event("error"));
    await r.ready;
    if (!source.includes(" src="))
      expect(r.win.URL.revokeObjectURL).toHaveBeenCalledWith(
        "blob:https://example.test/module",
      );
    expect(r.sent).toContainEqual(
      expect.objectContaining({
        type: "error",
        value: expect.objectContaining({ code: "resource_failed" }),
      }),
    );
    expect(
      r.sent.some((message) => ["state", "ready"].includes(message.type)),
    ).toBe(false);
  } finally {
    r.dom.window.close();
  }
});

it("cancels an inline module that never finishes loading", async () => {
  const timers = new Map<number, () => void>();
  const r = await bootRuntime(
    '<script type="module">import "https://unpkg.com/example@1/module.js"</script>',
    (win) => {
      vi.spyOn(win, "setTimeout").mockImplementation(((
        handler: () => void,
        delay: number,
      ) => {
        timers.set(delay, handler);
        return delay;
      }) as typeof win.setTimeout);
    },
  );
  try {
    timers.get(10000)!();
    await r.ready;
    expect(r.win.document.querySelector('script[type="module"]')).toBeNull();
    expect(r.win.URL.revokeObjectURL).toHaveBeenCalledWith(
      "blob:https://example.test/module",
    );
    expect(r.sent).toContainEqual(
      expect.objectContaining({
        type: "error",
        value: expect.objectContaining({ code: "resource_timeout" }),
      }),
    );
    expect(r.sent.some((message) => message.type === "ready")).toBe(false);
  } finally {
    r.dom.window.close();
  }
});

it("does not grant send authority to synthetic inline handlers", async () => {
  const r = await bootRuntime(
    "<button data-neo-ai-action onclick=\"intelligentUi.sendMessage('synthetic').then(result => window.result = result)\">Ask</button>",
  );
  try {
    await r.ready;
    r.win.document.querySelector("button")!.click();
    await Promise.resolve();
    expect((r.win as unknown as { result: unknown }).result).toEqual({
      ok: false,
      code: "user_action_required",
    });
    expect(r.sent.some((message) => message.type === "send-message")).toBe(
      false,
    );
  } finally {
    r.dom.window.close();
  }
});

it("releases a pending inline module on page hide", async () => {
  const r = await bootRuntime(
    '<script type="module">import "https://unpkg.com/example@1/module.js"</script>',
  );
  try {
    r.win.dispatchEvent(new r.win.Event("pagehide"));
    await r.ready;
    expect(r.win.URL.revokeObjectURL).toHaveBeenCalledWith(
      "blob:https://example.test/module",
    );
    expect(r.win.document.querySelector('script[type="module"]')).toBeNull();
    expect(r.sent.some((message) => message.type === "ready")).toBe(false);
  } finally {
    r.dom.window.close();
  }
});
