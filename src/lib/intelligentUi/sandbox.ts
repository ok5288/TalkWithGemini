import { prepareIntelligentHtml } from "./htmlPolicy";
import type { UiEnvironment, UiSendResult } from "./bridgeTypes";
import { createHtmlRuntimeGuards, HTML_RUNTIME_LIMITS } from "./runtimeLimits";

export const INTELLIGENT_UI_SANDBOX_PATH = "/intelligent-ui/sandbox";
const cdns =
  "https://cdn.jsdelivr.net/npm/ https://cdnjs.cloudflare.com/ajax/libs/ https://unpkg.com";
export const INTELLIGENT_UI_SANDBOX_CSP = [
  "default-src 'none'",
  `script-src 'unsafe-inline' 'unsafe-eval' blob: ${cdns}`,
  "script-src-attr 'unsafe-inline'",
  `style-src 'unsafe-inline' ${cdns} https://fonts.googleapis.com`,
  "img-src data: https:",
  "connect-src 'none'",
  "frame-src 'none'",
  "worker-src 'none'",
  "font-src data: https:",
  "media-src data: https:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'self'",
  "sandbox allow-scripts allow-forms",
].join("; ");

/** Self-contained: its compiled source is embedded in the fixed runner response. */
function sandboxBootstrap(
  prepare: typeof prepareIntelligentHtml,
  createGuards: typeof createHtmlRuntimeGuards,
  limits: typeof HTML_RUNTIME_LIMITS,
) {
  let connected = false;
  window.addEventListener("message", (event: MessageEvent) => {
    if (
      connected ||
      event.source !== window.parent ||
      event.data?.type !== "intelligent-ui-connect" ||
      !event.ports[0]
    )
      return;
    connected = true;
    const port = event.ports[0];
    const post = port.postMessage.bind(port);
    const guards = createGuards(limits);
    const identity = event.data.identity;
    let started = false;
    let stopped = false;
    let gesture: MouseEvent | null = null;
    let usedGesture = false;
    let eligibleGesture = false;
    const eventPhase = Function.prototype.call.bind(
      Object.getOwnPropertyDescriptor(Event.prototype, "eventPhase")!.get!,
    ) as (event: Event) => number;
    const closest = Function.prototype.call.bind(Element.prototype.closest) as (
      element: Element,
      selector: string,
    ) => Element | null;
    let sequence = 0;
    let resizeTask: ReturnType<typeof setTimeout> | undefined;
    let startupTimer: ReturnType<typeof setTimeout> | undefined;
    let updateTask: ReturnType<typeof setTimeout> | undefined;
    const updates = new Map<string, unknown>();
    let observer: ResizeObserver | undefined;
    const requests = new Map<string, (result: UiSendResult) => void>();
    const cleanups = new Set<() => void>();
    const send = (type: string, value: unknown) => {
      if (!stopped) post({ type, identity, value });
    };
    const flushUpdates = () => {
      clearTimeout(updateTask);
      updateTask = undefined;
      for (const [type, value] of updates) send(type, value);
      updates.clear();
    };
    const update = (type: string, value: unknown) => {
      if (stopped) return;
      try {
        const clean =
          type === "state"
            ? guards.state(value)
            : type === "height"
              ? guards.height(value)
              : guards.text(
                  value,
                  type === "snapshot"
                    ? limits.snapshotBytes
                    : limits.summaryBytes,
                );
        // Reinsert so the latest calls retain their original cross-channel order.
        updates.delete(type);
        updates.set(type, clean);
        updateTask ??= setTimeout(flushUpdates, limits.updateMs);
      } catch {
        fail("invalid_update");
      }
    };
    const environment = (value: UiEnvironment) => {
      if (!value || typeof value !== "object") return;
      const style = document.documentElement.style;
      style.colorScheme = value.colorScheme;
      style.color = value.color;
      style.fontFamily = value.fontFamily;
      style.fontSize = value.fontSize;
      style.lineHeight = value.lineHeight;
      for (const [name, token] of Object.entries(value.variables || {}))
        if (name.startsWith("--")) style.setProperty(name, token);
    };
    const stop = () => {
      stopped = true;
      clearTimeout(startupTimer);
      clearTimeout(resizeTask);
      clearTimeout(updateTask);
      updates.clear();
      observer?.disconnect();
      for (const cleanup of cleanups) cleanup();
      for (const resolve of requests.values())
        resolve({ ok: false, code: "inactive" });
      requests.clear();
    };
    const fail = (code: string, error?: ErrorEvent) => {
      if (stopped) return;
      try {
        // Valid calls belong to the last legal state even when a later call fails.
        // Deliver them in their original channel order before revoking the runtime.
        flushUpdates();
        // Only locations are diagnostic; generated messages/stacks may contain user data.
        send("error", {
          code,
          name: error?.error?.name || "Error",
          file: error?.filename?.split(/[?#]/)[0],
          line: error?.lineno,
          column: error?.colno,
          stack:
            typeof error?.error?.stack === "string"
              ? error.error.stack
                  .split("\n")
                  .slice(1, 9)
                  .map((line: string) =>
                    line.replace(
                      /https?:\/\/[^\s)]+/g,
                      (url: string) => url.split(/[?#]/)[0],
                    ),
                  )
                  .join("\n")
              : undefined,
        });
      } finally {
        stop();
      }
    };
    window.addEventListener("pagehide", stop, { once: true });
    window.addEventListener("error", (error) => fail("script_error", error));
    window.addEventListener("unhandledrejection", () =>
      fail("unhandled_rejection"),
    );
    document.addEventListener(
      "click",
      (click) => {
        gesture = click;
        usedGesture = false;
        eligibleGesture =
          click.isTrusted &&
          click.target instanceof Element &&
          !!closest(click.target, "button[data-neo-ai-action]:not(:disabled)");
        if (click.target instanceof Element && closest(click.target, "a,area"))
          click.preventDefault();
      },
      true,
    );
    document.addEventListener(
      "submit",
      (submit) => submit.preventDefault(),
      true,
    );
    const root = document.getElementById("intelligent-ui-root")!;
    const reportHeight = () => {
      if (resizeTask !== undefined || stopped) return;
      resizeTask = setTimeout(() => {
        resizeTask = undefined;
        update("height", Math.ceil(root.getBoundingClientRect().height));
      }, 0);
    };
    const load = (node: HTMLScriptElement | HTMLLinkElement) =>
      new Promise<void>((resolve, reject) => {
        const finish = (error?: Error) => {
          clearTimeout(timer);
          node.onload = null;
          node.onerror = null;
          cleanups.delete(cancel);
          if (error) {
            node.remove();
            reject(error);
          } else resolve();
        };
        const cancel = () => finish(new Error("resource_cancelled"));
        const timer = setTimeout(
          () => finish(new Error("resource_timeout")),
          10000,
        );
        cleanups.add(cancel);
        node.onload = () => finish();
        node.onerror = () => finish(new Error("resource_failed"));
        root.appendChild(node);
      });
    port.onmessage = async (message) => {
      if (stopped || message.data?.identity !== identity) return;
      if (message.data.type === "flush-updates") {
        const requestId = message.data.value?.requestId;
        if (typeof requestId !== "string" || requestId.length > 64) return;
        flushUpdates();
        send("updates-flushed", { requestId });
        return;
      }
      if (message.data.type === "environment") {
        environment(message.data.value);
        return;
      }
      if (message.data.type === "send-result") {
        const { requestId, result } = message.data.value || {};
        requests.get(requestId)?.(result);
        requests.delete(requestId);
        return;
      }
      if (started || message.data.type !== "init") return;
      started = true;
      startupTimer = setTimeout(() => fail("initialization_timeout"), 30000);
      try {
        const { html, resources } = prepare(message.data.source, true);
        environment(message.data.environment);
        const api = Object.freeze({
          initialState: guards.state(message.data.state || {}),
          setState: (state: unknown) => update("state", state),
          reportSummary: (summary: string) => update("summary", summary),
          reportSnapshot: (snapshot: string) => update("snapshot", snapshot),
          reportHeight,
          sendMessage: (text: string): Promise<UiSendResult> => {
            if (stopped)
              return Promise.resolve({ ok: false, code: "inactive" });
            if (
              !gesture?.isTrusted ||
              eventPhase(gesture) === 0 ||
              usedGesture ||
              !eligibleGesture
            )
              return Promise.resolve({
                ok: false,
                code: "user_action_required",
              });
            usedGesture = true;
            if (
              typeof text !== "string" ||
              !text.trim() ||
              text.length > 200000
            )
              return Promise.resolve({ ok: false, code: "invalid_message" });
            if (sequence >= limits.requests) {
              fail("request_limit");
              return Promise.resolve({ ok: false, code: "inactive" });
            }
            const requestId = String(++sequence);
            return new Promise((resolve) => {
              requests.set(requestId, resolve);
              flushUpdates();
              send("send-message", { requestId, text });
            });
          },
        });
        Object.defineProperty(window, "intelligentUi", {
          value: api,
          writable: false,
          configurable: false,
        });
        root.innerHTML = html;
        for (const item of resources) {
          if (stopped) return;
          if (item.kind === "style") {
            const link = document.createElement("link");
            link.rel = "stylesheet";
            link.href = item.url!;
            link.crossOrigin = "anonymous";
            link.referrerPolicy = "no-referrer";
            if (item.integrity) link.integrity = item.integrity;
            await load(link);
          } else {
            const script = document.createElement("script");
            script.crossOrigin = "anonymous";
            script.referrerPolicy = "no-referrer";
            if (item.integrity) script.integrity = item.integrity;
            if (item.type) script.type = item.type;
            if (item.url) {
              script.src = item.url;
              script.async = false;
              await load(script);
            } else if (item.type === "module") {
              // Inline modules have no load event. An external Blob module does;
              // like native module loading, it does not await top-level await.
              const url = URL.createObjectURL(
                new Blob([item.source || ""], { type: "text/javascript" }),
              );
              script.src = url;
              try {
                await load(script);
              } finally {
                URL.revokeObjectURL(url);
              }
            } else {
              script.textContent = item.source || "";
              root.appendChild(script);
            }
          }
        }
        if (stopped) return;
        document.dispatchEvent(new Event("DOMContentLoaded"));
        observer = new ResizeObserver(reportHeight);
        observer.observe(root);
        reportHeight();
        clearTimeout(startupTimer);
        flushUpdates();
        send("ready", true);
      } catch (error) {
        if (!stopped)
          fail(
            error instanceof Error &&
              ["resource_timeout", "resource_failed"].includes(error.message)
              ? error.message
              : "invalid_interface",
          );
      }
    };
    port.start();
    send("connected", true);
  });
}

export function getIntelligentUiSandboxDocument(): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{background:transparent;margin:0}body{font:inherit;color:inherit;overflow-wrap:anywhere}#intelligent-ui-root{display:flow-root;width:100%}*{box-sizing:border-box}svg,canvas,img,video{max-width:100%}button,input,select,textarea{font:inherit}:focus-visible{outline:2px solid Highlight}@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important}}</style></head><body><div id="intelligent-ui-root"></div><script>(${sandboxBootstrap.toString()})(${prepareIntelligentHtml.toString()},${createHtmlRuntimeGuards.toString()},${JSON.stringify(HTML_RUNTIME_LIMITS)});</script></body></html>`;
}
