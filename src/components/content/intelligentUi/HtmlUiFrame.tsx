"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  createIntelligentHtmlPreview,
  prepareIntelligentHtml,
} from "@/lib/intelligentUi/htmlPolicy";
import {
  createHtmlRuntime,
  type HtmlRuntimeStatus,
} from "@/lib/intelligentUi/instance";
import { INTELLIGENT_UI_SANDBOX_PATH } from "@/lib/intelligentUi/sandbox";

import type {
  UiEnvironment,
  UiSendMessage,
} from "@/lib/intelligentUi/bridgeTypes";

export interface HtmlUiFrameProps {
  onSendMessage?: (
    text: string,
    isRuntimeActive: () => boolean,
  ) => ReturnType<UiSendMessage>;
  source: string;
  complete: boolean;
  instanceId: string;
  sessionId?: string;
  initialState?: Record<string, unknown>;
  title: string;
  onStateChange: (state: Record<string, unknown>) => void;
  /** Snapshots are plain text, never trusted HTML. */
  onSnapshot?: (snapshot: string) => void;
  onSummary?: (summary: string) => void;
  onError?: (message: string) => void;
  onStatus?: (status: HtmlRuntimeStatus) => void;
}

export function HtmlUiFrame(props: HtmlUiFrameProps) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const runtimeRef = useRef<ReturnType<typeof createHtmlRuntime> | null>(null);
  const callbacks = useRef(props);
  const [height, setHeight] = useState(320);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    callbacks.current = props;
  });
  const prepared = useMemo(() => {
    if (typeof document === "undefined") return null;
    try {
      if (props.complete) prepareIntelligentHtml(props.source, true);
      return {
        preview: createIntelligentHtmlPreview(props.source),
        error: null,
      };
    } catch (error) {
      return {
        preview: createIntelligentHtmlPreview(props.source),
        error: error instanceof Error ? error.message : "Invalid interface",
      };
    }
  }, [props.source, props.complete]);

  useEffect(() => {
    if (prepared?.error) {
      callbacks.current.onError?.("invalid_definition");
      return;
    }
    if (!props.complete || !prepared) return;
    let live = true;
    let active = false;
    const isRuntimeActive = () => live && active;
    setFailed(false);
    callbacks.current.onStatus?.("starting");
    const runtime = createHtmlRuntime({
      instanceId: props.instanceId,
      sessionId: props.sessionId,
      source: props.source,
      state: callbacks.current.initialState || {},
      onSendMessage: (text) =>
        callbacks.current.onSendMessage?.(text, isRuntimeActive) ??
        Promise.resolve({ ok: false, code: "inactive" }),
      onDiagnostic: (diagnostic) =>
        console.error("Intelligent UI runtime", diagnostic),
      onStatus: (status) => {
        active = status === "active";
        if (status === "failed") setFailed(true);
        callbacks.current.onStatus?.(status);
      },
      onError: (code) => callbacks.current.onError?.(code),
      onMessage: (type, value) => {
        if (type === "state") {
          // The runtime validates and copies JSON before invoking this adapter.
          callbacks.current.onStateChange(value as Record<string, unknown>);
        } else if (
          type === "height" &&
          typeof value === "number" &&
          Number.isFinite(value) &&
          value >= 0
        )
          setHeight(Math.ceil(value));
        else if (type === "summary" && typeof value === "string")
          callbacks.current.onSummary?.(value);
        else if (type === "snapshot" && typeof value === "string")
          callbacks.current.onSnapshot?.(value);
      },
    });
    runtimeRef.current = runtime;
    const syncEnvironment = () => {
      const element = frameRef.current?.parentElement;
      if (!element) return;
      const computed = getComputedStyle(element);
      const variables: Record<string, string> = {};
      for (let index = 0; index < computed.length; index++) {
        const name = computed.item(index);
        if (name.startsWith("--"))
          variables[name] = computed.getPropertyValue(name);
      }
      const environment: UiEnvironment = {
        colorScheme:
          document.documentElement.classList.contains("dark") ||
          computed.colorScheme === "dark"
            ? "dark"
            : "light",
        color: computed.color,
        fontFamily: computed.fontFamily,
        fontSize: computed.fontSize,
        lineHeight: computed.lineHeight,
        variables,
      };
      runtime.updateEnvironment(environment);
    };
    syncEnvironment();
    const observer = new MutationObserver(syncEnvironment);
    for (
      let element: HTMLElement | null =
        frameRef.current?.parentElement || document.body;
      element;
      element = element.parentElement
    ) {
      observer.observe(element, {
        attributes: true,
        attributeFilter: ["class", "style", "data-theme"],
      });
    }
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    media?.addEventListener("change", syncEnvironment);
    return () => {
      live = false;
      active = false;
      observer.disconnect();
      media?.removeEventListener("change", syncEnvironment);
      runtime.dispose();
      runtimeRef.current = null;
    };
    // State changes persist without restarting the running document.
  }, [
    props.instanceId,
    props.sessionId,
    props.source,
    props.complete,
    prepared,
  ]);

  function connect() {
    const target = frameRef.current?.contentWindow;
    if (target) runtimeRef.current?.connect(target);
  }

  if (!prepared) return <p>{props.title}</p>;
  const executable = props.complete && !prepared.error && !failed;
  return (
    <iframe
      key={`${props.instanceId}:${executable ? "runtime" : "preview"}`}
      ref={frameRef}
      title={props.title}
      src={executable ? INTELLIGENT_UI_SANDBOX_PATH : undefined}
      srcDoc={executable ? undefined : prepared.preview}
      sandbox={executable ? "allow-scripts allow-forms" : ""}
      referrerPolicy="no-referrer"
      onLoad={executable ? connect : undefined}
      className="block w-full min-w-0 border-0 bg-transparent"
      style={{ height, maxWidth: "100%", background: "transparent" }}
    />
  );
}
