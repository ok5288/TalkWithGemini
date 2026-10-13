import type { UiEnvironment, UiSendMessage, UiSendResult } from "./bridgeTypes";
import type { IntelligentUiBlock } from "./types";
import { createHtmlRuntimeGuards, HTML_RUNTIME_LIMITS } from "./runtimeLimits";
import { registerHtmlRuntimeFlusher } from "./runtimeFlush";

export interface UiInstanceIdentity {
  sessionId: string;
  messageId: string;
  blockId: string;
  definitionRevision: number;
  epoch: number;
}
export type HtmlRuntimeStatus = "starting" | "active" | "failed" | "disposed";
export function getUiInstanceKey(identity: UiInstanceIdentity): string {
  return JSON.stringify([
    identity.sessionId,
    identity.messageId,
    identity.blockId,
    identity.definitionRevision,
    identity.epoch,
  ]);
}
export function isUiInstanceEligible(
  block: IntelligentUiBlock,
  enabled: boolean,
  writable: boolean,
): boolean {
  if (block.renderer === "html") {
    try {
      createHtmlRuntimeGuards(HTML_RUNTIME_LIMITS).state(block.state);
    } catch {
      return false;
    }
  }
  return (
    enabled &&
    writable &&
    !!block.definition &&
    (block.status === "ready" || block.status === "preview")
  );
}
export function matchesUiStateTarget(
  block: IntelligentUiBlock,
  blockId: string,
  revision: number,
): boolean {
  return (
    block.id === blockId &&
    block.definitionRevision === revision &&
    block.status === "ready"
  );
}
/** One mount owns one transport. Disposing invalidates every queued callback. */
export function createHtmlRuntime(options: {
  instanceId: string;
  sessionId?: string;
  source: string;
  state: Record<string, unknown>;
  onStatus: (status: HtmlRuntimeStatus) => void;
  onError: (code: string) => void;
  onMessage: (type: string, value: unknown) => void;
  onSendMessage?: UiSendMessage;
  onEscape?: () => void;
  environment?: UiEnvironment;
  onDiagnostic?: (value: unknown) => void;
}) {
  let status: HtmlRuntimeStatus = "starting";
  let port: MessagePort | null = null;
  let loaded = false;
  let initialized = false;
  const pending = new Map<string, unknown>();
  const identity = `${options.instanceId}:${crypto.randomUUID()}`;
  let environment = options.environment;
  let sending = false;
  const seenRequests = new Set<string>();
  const guards = createHtmlRuntimeGuards(HTML_RUNTIME_LIMITS);
  let tokens: number = HTML_RUNTIME_LIMITS.burst;
  let tokenTime = Date.now();
  let timer = setTimeout(() => fail("startup_timeout"), 5000);
  let unregisterFlush: (() => void) | undefined;
  let flushSequence = 0;
  let flushing:
    | {
        id: string;
        promise: Promise<void>;
        resolve: () => void;
        reject: (error: Error) => void;
        timer: ReturnType<typeof setTimeout>;
      }
    | undefined;
  function flushUpdates(): Promise<void> {
    if (flushing) return flushing.promise;
    if (status !== "active" || !port)
      return Promise.reject(new Error("instance_expired"));
    let resolve!: () => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<void>((done, failed) => {
      resolve = done;
      reject = failed;
    });
    const id = `flush-${++flushSequence}`;
    flushing = {
      id,
      promise,
      resolve,
      reject,
      timer: setTimeout(() => fail("flush_timeout"), 1500),
    };
    try {
      port.postMessage({
        type: "flush-updates",
        identity,
        value: { requestId: id },
      });
    } catch {
      fail("connection_failed");
    }
    return promise;
  }
  function release() {
    clearTimeout(timer);
    pending.clear();
    seenRequests.clear();
    unregisterFlush?.();
    unregisterFlush = undefined;
    if (flushing) {
      clearTimeout(flushing.timer);
      flushing.reject(new Error("runtime_flush_failed"));
      flushing = undefined;
    }
    port?.close();
    port = null;
  }
  function fail(code: string) {
    if (status === "disposed" || status === "failed") return;
    status = "failed";
    // Initialization can report valid updates before the ready acknowledgement.
    // Keep those values when a later update or script fails, without activating it.
    try {
      for (const [type, value] of pending) options.onMessage(type, value);
    } finally {
      release();
      options.onStatus(status);
      options.onError(code);
    }
  }
  return {
    connect(target: Window) {
      if (status !== "starting" && status !== "active") return;
      if (loaded) {
        fail("unexpected_reload");
        return;
      }
      loaded = true;
      try {
        const channel = new MessageChannel();
        port = channel.port1;
        port.onmessage = (event) => {
          if (
            status === "disposed" ||
            status === "failed" ||
            event.data?.identity !== identity
          )
            return;
          const now = Date.now();
          tokens = Math.min(
            HTML_RUNTIME_LIMITS.burst,
            tokens +
              (Math.max(0, now - tokenTime) *
                HTML_RUNTIME_LIMITS.messagesPerSecond) /
                1000,
          );
          tokenTime = now;
          if (tokens < 1) {
            fail("message_rate_limit");
            return;
          }
          tokens--;
          const { type, value } = event.data;
          if (type === "connected" && !initialized) {
            initialized = true;
            clearTimeout(timer);
            timer = setTimeout(() => fail("initialization_timeout"), 30000);
            let state: Record<string, unknown>;
            try {
              state = guards.state(options.state);
            } catch {
              fail("invalid_state");
              return;
            }
            port?.postMessage({
              type: "init",
              identity,
              source: options.source,
              state,
              environment,
            });
          } else if (type === "ready" && initialized && status === "starting") {
            status = "active";
            clearTimeout(timer);
            options.onStatus(status);
            for (const [type, value] of pending) options.onMessage(type, value);
            pending.clear();
            if (options.sessionId)
              unregisterFlush = registerHtmlRuntimeFlusher(
                options.sessionId,
                flushUpdates,
              );
          } else if (type === "updates-flushed" && status === "active") {
            if (flushing && value?.requestId === flushing.id) {
              clearTimeout(flushing.timer);
              flushing.resolve();
              flushing = undefined;
            }
          } else if (
            type === "host-escape" &&
            status === "active" &&
            value === true
          ) {
            options.onEscape?.();
          } else if (type === "error") {
            options.onDiagnostic?.(value);
            fail("runtime_error");
          } else if (type === "send-message" && initialized) {
            const requestId = value?.requestId;
            const text = value?.text;
            if (
              typeof requestId !== "string" ||
              requestId.length > 64 ||
              seenRequests.has(requestId)
            )
              return;
            if (seenRequests.size >= HTML_RUNTIME_LIMITS.requests) {
              fail("request_limit");
              return;
            }
            seenRequests.add(requestId);
            const reply = (result: UiSendResult) => {
              if (status === "active" || status === "starting")
                port?.postMessage({
                  type: "send-result",
                  identity,
                  value: { requestId, result },
                });
            };
            if (status !== "active") {
              reply({ ok: false, code: "inactive" });
              return;
            }
            if (
              typeof text !== "string" ||
              !text.trim() ||
              text.length > 200000
            ) {
              reply({ ok: false, code: "invalid_message" });
              return;
            }
            if (!navigator.userActivation?.isActive) {
              reply({ ok: false, code: "user_action_required" });
              return;
            }
            if (sending) {
              reply({ ok: false, code: "busy" });
              return;
            }
            if (!options.onSendMessage) {
              reply({ ok: false, code: "inactive" });
              return;
            }
            sending = true;
            // Earlier state/snapshot messages have already run synchronously.
            Promise.resolve()
              .then(() =>
                status === "active"
                  ? options.onSendMessage!(text)
                  : ({ ok: false, code: "inactive" } as const),
              )
              .then(reply, () => reply({ ok: false, code: "send_failed" }))
              .finally(() => {
                sending = false;
              });
          } else if (
            initialized &&
            ["height", "state", "snapshot", "summary"].includes(type)
          ) {
            let clean: unknown;
            try {
              clean =
                type === "state"
                  ? guards.state(value)
                  : type === "height"
                    ? guards.height(value)
                    : guards.text(
                        value,
                        type === "snapshot"
                          ? HTML_RUNTIME_LIMITS.snapshotBytes
                          : HTML_RUNTIME_LIMITS.summaryBytes,
                      );
            } catch {
              fail("invalid_update");
              return;
            }
            if (status === "active") options.onMessage(type, clean);
            else {
              pending.delete(type);
              pending.set(type, clean);
            }
          }
        };
        port.onmessageerror = () => fail("connection_failed");
        port.start();
        target.postMessage({ type: "intelligent-ui-connect", identity }, "*", [
          channel.port2,
        ]);
      } catch {
        fail("connection_failed");
      }
    },
    updateEnvironment(value: UiEnvironment) {
      environment = value;
      if (initialized && status !== "disposed" && status !== "failed")
        port?.postMessage({ type: "environment", identity, value });
    },
    dispose() {
      if (status === "disposed") return;
      status = "disposed";
      release();
    },
  };
}

/** The view's lease guards both delayed adapter callbacks and synchronous events. */
export function createUiInstanceLease(
  identity: UiInstanceIdentity,
  eligible: () => boolean,
) {
  let disposed = false;
  return {
    identity,
    accepts: () => !disposed && eligible(),
    activate: () => {
      disposed = false;
    },
    dispose: () => {
      disposed = true;
    },
  };
}
