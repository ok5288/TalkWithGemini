"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { ToolCall } from "@/lib/chat/types";
import { useChatStore } from "@/store/core/chatStore";
import { useSettingsStore } from "@/store/core/settingsStore";
import { resolveEffectivePluginAccess } from "@/lib/chat/effectiveChatContext";
import { getMcpSandboxOrigin } from "@/lib/mcpApps/config";
import { bindMcpApp } from "@/lib/mcpApps/binding";
import {
  MCP_APP_LOAD_TIMEOUT,
  projectMcpAppResult,
  validateMcpAppResource,
} from "@/lib/mcpApps/policy";
import { createMcpAppRuntime, type McpAppPhase } from "@/lib/mcpApps/runtime";
import { executeMcpCapability } from "@/services/api/mcpService";

export default function ConnectedMcpAppCard({
  toolCall: inputCall,
  sessionId,
  messageId,
  readOnly = false,
}: {
  toolCall: ToolCall;
  sessionId: string;
  messageId: string;
  readOnly?: boolean;
}) {
  const {
    id,
    name,
    pluginId,
    pluginTitle,
    functionFingerprint,
    status,
    isError,
    result,
  } = inputCall;
  const toolCall = useMemo<ToolCall>(
    () => ({
      id,
      name,
      pluginId,
      pluginTitle,
      functionFingerprint,
      status,
      isError,
      result,
      args: {},
    }),
    [
      id,
      name,
      pluginId,
      pluginTitle,
      functionFingerprint,
      status,
      isError,
      result,
    ],
  );
  const t = useTranslations("System.mcpApps");
  const locale = useLocale();
  const system = useSettingsStore((state) => state.system);
  const plugins = useSettingsStore((state) => state.installedPlugins);
  const globalActivePlugins = useSettingsStore((state) => state.activePlugins);
  const sessionConfig = useChatStore(
    (state) =>
      state.sessions.find((session) => session.id === sessionId)?.config,
  );
  const workspaceId = useChatStore(
    (state) =>
      state.sessions.find((session) => session.id === sessionId)?.workspaceId,
  );
  const workspace = useChatStore((state) =>
    state.workspaces.find((item) => item.id === workspaceId),
  );
  const configs = useSettingsStore((state) => state.pluginConfigs);
  const activePlugins = useMemo(() => {
    const session = useChatStore
      .getState()
      .sessions.find((item) => item.id === sessionId);
    return resolveEffectivePluginAccess({
      session: session ? { ...session, config: sessionConfig } : undefined,
      workspace,
      activePlugins: globalActivePlugins,
      installedPlugins: plugins,
      pluginConfigs: configs,
    }).activePluginIds;
  }, [
    sessionId,
    sessionConfig,
    workspace,
    globalActivePlugins,
    plugins,
    configs,
  ]);
  const active = useChatStore(
    (state) =>
      state.currentSessionId === sessionId &&
      !state.isActiveSessionLoading &&
      !state.pendingSessionId &&
      state.sessions.some((session) => session.id === sessionId) &&
      state.activeMessages.some((message) => message.id === messageId),
  );
  const [attempt, setAttempt] = useState(0);
  const [phaseState, setPhaseState] = useState<{
    generation: object;
    phase: McpAppPhase;
  } | null>(null);
  const [height, setHeight] = useState(320);
  const frame = useRef<HTMLIFrameElement>(null);
  const runtime = useRef<ReturnType<typeof createMcpAppRuntime> | null>(null);
  const eligible =
    !readOnly &&
    active &&
    system.enableIntelligentUi &&
    system.enableMcpApps &&
    toolCall.status === "success" &&
    !!toolCall.pluginId &&
    activePlugins.includes(toolCall.pluginId);
  const descriptor = plugins
    .find((p) => p.id === toolCall.pluginId)
    ?.functions.find((f) => f.name === toolCall.name)?.mcpUi;
  const origin =
    typeof window === "undefined"
      ? null
      : getMcpSandboxOrigin(window.location.origin);
  const generation = useMemo(
    () => ({
      eligible,
      descriptor,
      origin,
      attempt,
      toolCall,
      sessionId,
      messageId,
      plugins,
      configs,
      activePlugins,
      locale,
    }),
    [
      eligible,
      descriptor,
      origin,
      attempt,
      toolCall,
      sessionId,
      messageId,
      plugins,
      configs,
      activePlugins,
      locale,
    ],
  );
  const phase =
    phaseState?.generation === generation ? phaseState.phase : "loading";
  useEffect(() => {
    if (!eligible || !descriptor || !origin) return;
    let live = true;
    const controller = new AbortController();
    const current = () => {
      const settings = useSettingsStore.getState();
      const chat = useChatStore.getState();
      const message = chat.activeMessages.find((item) => item.id === messageId);
      const session = chat.sessions.find((item) => item.id === sessionId);
      const currentWorkspace = chat.workspaces.find(
        (item) => item.id === session?.workspaceId,
      );
      const currentActivePlugins = resolveEffectivePluginAccess({
        session,
        workspace: currentWorkspace,
        activePlugins: settings.activePlugins,
        installedPlugins: settings.installedPlugins,
        pluginConfigs: settings.pluginConfigs,
      }).activePluginIds;
      return (
        live &&
        settings.system.enableMcpApps &&
        settings.system.enableIntelligentUi &&
        settings.installedPlugins === plugins &&
        settings.pluginConfigs === configs &&
        session?.config === sessionConfig &&
        currentWorkspace === workspace &&
        currentActivePlugins.length === activePlugins.length &&
        currentActivePlugins.every(
          (id, index) => id === activePlugins[index],
        ) &&
        !!session &&
        !chat.isActiveSessionLoading &&
        !chat.pendingSessionId &&
        chat.currentSessionId === sessionId &&
        !!message &&
        [
          ...(message.toolCalls || []),
          ...(message.outputBlocks || []).flatMap((block) =>
            block.type === "tool_group" ? block.toolCalls : [],
          ),
        ].some(
          (call) =>
            call.id === toolCall.id &&
            call.status === "success" &&
            call.functionFingerprint === toolCall.functionFingerprint &&
            call.result === toolCall.result,
        )
      );
    };
    const fail = () => {
      if (live) setPhaseState({ generation, phase: "failed" });
      controller.abort();
    };
    const timer = setTimeout(fail, MCP_APP_LOAD_TIMEOUT);
    void (async () => {
      try {
        const binding = await bindMcpApp(
          toolCall,
          plugins,
          activePlugins,
          configs,
        );
        if (!binding || !current()) throw new Error("binding_expired");
        const resource = await executeMcpCapability(
          binding.pluginId,
          "resource_read",
          { uri: binding.resourceUri },
          controller.signal,
          { enableMcpApps: true },
        );
        if (!current() || controller.signal.aborted) return;
        const html = validateMcpAppResource(resource, binding.resourceUri);
        clearTimeout(timer);
        const iframe = frame.current;
        if (!iframe?.contentWindow) throw new Error("frame_unavailable");
        const instance = createMcpAppRuntime({
          target: iframe.contentWindow,
          origin,
          html,
          result: projectMcpAppResult(toolCall.result),
          current,
          onPhase: (value) => {
            if (current()) setPhaseState({ generation, phase: value });
          },
          onHeight: (value) => {
            if (current()) setHeight(value);
          },
          theme: document.documentElement.classList.contains("dark")
            ? "dark"
            : "light",
          locale,
        });
        runtime.current = instance;
        await instance.start();
        if (current()) iframe.src = `${origin}/sandbox`;
        else await instance.dispose();
      } catch {
        fail();
      }
    })();
    return () => {
      live = false;
      clearTimeout(timer);
      controller.abort();
      const instance = runtime.current;
      runtime.current = null;
      void instance?.dispose();
    };
  }, [
    generation,
    sessionConfig,
    workspace,
    eligible,
    descriptor,
    origin,
    attempt,
    toolCall,
    sessionId,
    messageId,
    plugins,
    configs,
    activePlugins,
    locale,
  ]);
  useEffect(() => {
    const update = () =>
      runtime.current?.context(
        document.documentElement.classList.contains("dark") ? "dark" : "light",
        locale,
      );
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    update();
    return () => observer.disconnect();
  }, [locale]);
  if (!descriptor) return null;
  const runnable = eligible && origin;
  return (
    <section
      className="my-2 min-w-0 rounded-lg border border-border p-3"
      aria-label={t("title")}
    >
      <div className="text-sm font-medium">
        {t("source", {
          source: toolCall.pluginTitle || toolCall.pluginId || "MCP",
        })}
      </div>
      <p role="status" className="text-xs text-muted-foreground">
        {!runnable ? t("unavailable") : t(phase)}
      </p>
      {runnable && phase !== "failed" && (
        <iframe
          ref={frame}
          title={t("title")}
          sandbox="allow-scripts allow-same-origin"
          referrerPolicy="no-referrer"
          onLoad={() => {
            if (frame.current?.getAttribute("src")) runtime.current?.loaded();
          }}
          style={{ height }}
          className="w-full border-0"
        />
      )}
      {runnable && phase === "failed" && (
        <button
          type="button"
          className="mt-2 rounded border px-3 py-1 text-sm"
          onClick={() => {
            setAttempt((value) => value + 1);
          }}
        >
          {t("retry")}
        </button>
      )}
    </section>
  );
}
