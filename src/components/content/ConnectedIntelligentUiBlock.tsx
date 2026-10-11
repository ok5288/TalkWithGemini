"use client";

import React, {
  useState,
  useEffect,
  useMemo,
  useSyncExternalStore,
} from "react";
import { useTranslations, useLocale } from "next-intl";
import type { IntelligentUiBlock, JsonObject } from "@/lib/intelligentUi/types";
import {
  createUiInstanceLease,
  matchesUiStateTarget,
} from "@/lib/intelligentUi/instance";
import { projectUiBlock } from "@/lib/intelligentUi/projection";
import { useUiChatSend } from "./intelligentUi/UiChatContext";
import { useChatStore } from "@/store/core/chatStore";
import { useSettingsStore } from "@/store/core/settingsStore";
import IntelligentUiCard from "./intelligentUi/IntelligentUiCard";
import SourceBindings from "./intelligentUi/SourceBindings";
import MarkdownRenderer from "./MarkdownRenderer";
import {
  loadActiveUiSourceContext,
  subscribeUiSourceAuthority,
  getUiSourceAuthorityEpoch,
  getActiveUiSourceContextKey,
} from "@/lib/intelligentUi/sourceContext";
import { resolveUiSourceDataset } from "@/lib/intelligentUi/sources/dataset";
import { projectUiSources } from "@/lib/intelligentUi/sources/resolver";
import type { UiSourceContext } from "@/lib/intelligentUi/sources/types";
import { useKnowledgeStore } from "@/store/core/knowledgeStore";
import { useResearchStore } from "@/store/core/researchStore";
import { Button } from "@/components/ui/primitives";
import { waitForSessionMessageWrites } from "@/store/sessionMessagePersistence";
import { initialExplorer } from "@/lib/intelligentUi/explorer/derive";

export default function ConnectedIntelligentUiBlock({
  block,
  sessionId,
  messageId,
  mode = "interactive",
}: {
  block: IntelligentUiBlock;
  sessionId: string;
  messageId: string;
  mode?: "interactive" | "static-original" | "static-current";
}) {
  const sendMessage = useUiChatSend();
  const locale = useLocale();
  const t = useTranslations("IntelligentUi");
  const enabled = useSettingsStore((state) => state.system.enableIntelligentUi);
  const active = useChatStore(
    (state) =>
      state.currentSessionId === sessionId &&
      !state.isActiveSessionLoading &&
      !state.pendingSessionId &&
      state.activeMessages.some((message) => message.id === messageId),
  );
  const [saveFailed, setSaveFailed] = useState(false);
  // Subscribe to authority changes; the key itself contains identities, never body dumps.
  useChatStore((state) => state.activeMessages);
  useChatStore(
    (state) =>
      state.sessions.find((item) => item.id === sessionId)?.config
        ?.activePlugins,
  );
  useChatStore(
    (state) =>
      state.sessions.find((item) => item.id === sessionId)?.config
        ?.agentProfile,
  );
  useChatStore((state) => state.workspaces);
  useSettingsStore((state) => state.installedPlugins);
  useSettingsStore((state) => state.activePlugins);
  useSettingsStore((state) => state.pluginConfigs);
  useKnowledgeStore((state) => state.collections);
  useResearchStore((state) => state.tasksById);
  useSyncExternalStore(
    subscribeUiSourceAuthority,
    getUiSourceAuthorityEpoch,
    getUiSourceAuthorityEpoch,
  );
  const sourceKey = getActiveUiSourceContextKey(sessionId, messageId);
  const [resolvedContext, setResolvedContext] = useState<{
    key: string;
    context: UiSourceContext;
  } | null>(null);
  const selector =
    block.definition &&
    "kind" in block.definition &&
    block.definition.kind === "explorer" &&
    block.definition.props.dataset.kind === "context"
      ? block.definition.props.dataset
      : undefined;
  const needsSources = !!selector || !!block.sourceBindings?.length;
  useEffect(() => {
    if (!active || !needsSources) return;
    let cancelled = false;
    void loadActiveUiSourceContext(sessionId, messageId)
      .then((context) => {
        if (
          !cancelled &&
          getActiveUiSourceContextKey(sessionId, messageId) === sourceKey
        )
          setResolvedContext({ key: sourceKey, context });
      })
      .catch(() => {
        if (!cancelled) setResolvedContext(null);
      });
    return () => {
      cancelled = true;
    };
  }, [active, sessionId, messageId, sourceKey, needsSources]);
  const context =
    active && resolvedContext?.key === sourceKey
      ? resolvedContext.context
      : undefined;
  const resolvedData = useMemo(
    () =>
      selector && context && (!block.dataSnapshot || mode === "static-original")
        ? resolveUiSourceDataset(
            selector,
            context,
            sessionId,
            block.sourceBindings?.find(
              (binding) => binding.alias === selector.alias,
            ),
          )
        : undefined,
    [
      selector,
      context,
      sessionId,
      block.sourceBindings,
      block.dataSnapshot,
      mode,
    ],
  );
  const lease = useMemo(
    () =>
      createUiInstanceLease(
        {
          sessionId,
          messageId,
          blockId: block.id,
          definitionRevision: block.definitionRevision,
          epoch: 0,
        },
        () => {
          const store = useChatStore.getState();
          const message = store.activeMessages.find(
            (item) => item.id === messageId,
          );
          return (
            enabled &&
            mode === "interactive" &&
            active &&
            useSettingsStore.getState().system.enableIntelligentUi &&
            store.currentSessionId === sessionId &&
            !!message?.outputBlocks?.some(
              (item) =>
                item.type === "intelligent_ui" &&
                matchesUiStateTarget(item, block.id, block.definitionRevision),
            )
          );
        },
      ),
    [
      sessionId,
      messageId,
      block.id,
      block.definitionRevision,
      enabled,
      active,
      mode,
    ],
  );
  useEffect(() => {
    lease.activate();
    return () => lease.dispose();
  }, [lease]);
  const stillActive = () =>
    lease.accepts() &&
    (!selector ||
      !!block.dataSnapshot ||
      (getActiveUiSourceContextKey(sessionId, messageId) === sourceKey &&
        !!resolvedData?.dataset));
  useEffect(() => {
    if (
      !resolvedData?.dataset ||
      !lease.accepts() ||
      getActiveUiSourceContextKey(sessionId, messageId) !== sourceKey ||
      block.sourceBindings?.some(
        (binding) =>
          binding.alias === resolvedData.binding.alias &&
          binding.version === resolvedData.binding.version &&
          binding.contentHash === resolvedData.binding.contentHash,
      )
    )
      return;
    const current = useChatStore
      .getState()
      .activeMessages.find((message) => message.id === messageId)
      ?.outputBlocks?.find((item) => item.id === block.id);
    if (current?.type !== "intelligent_ui") return;
    void useChatStore
      .getState()
      .updateIntelligentUiState(
        sessionId,
        messageId,
        block.id,
        block.definitionRevision,
        current.stateRevision === 0 &&
          !current.sourceBindings?.length &&
          current.definition &&
          "kind" in current.definition &&
          current.definition.kind === "explorer"
          ? initialExplorer(current.definition, resolvedData.dataset)
          : current.state,
        undefined,
        { sourceBindings: [resolvedData.binding] },
      )
      .catch(() => {
        if (lease.accepts()) setSaveFailed(true);
      });
  }, [
    resolvedData,
    lease,
    sourceKey,
    block.id,
    block.definitionRevision,
    block.sourceBindings,
    sessionId,
    messageId,
  ]);
  const saveState = (state: JsonObject, snapshot?: string) => {
    if (!stillActive()) return;
    void useChatStore
      .getState()
      .updateIntelligentUiState(
        sessionId,
        messageId,
        block.id,
        block.definitionRevision,
        state,
        snapshot,
        undefined,
        block.renderer === "html" ? "coalesced" : "immediate",
      )
      .then((accepted) => {
        if (accepted && stillActive()) setSaveFailed(false);
      })
      .catch(() => {
        if (stillActive()) setSaveFailed(true);
      });
  };
  if (mode !== "interactive")
    return (
      <>
        <MarkdownRenderer
          readOnly
          content={projectUiBlock(block, {
            purpose: mode,
            locale,
            dataset: resolvedData?.dataset ?? undefined,
            sourceSummary: context
              ? projectUiSources(
                  resolvedData
                    ? [resolvedData.binding]
                    : (block.sourceBindings ?? []),
                  context,
                  { publicOnly: true },
                )
              : [],
          })}
        />
        {context &&
        (!block.dataSnapshot || mode === "static-original") &&
        (resolvedData || block.sourceBindings?.length) ? (
          <SourceBindings
            bindings={
              resolvedData
                ? [resolvedData.binding]
                : (block.sourceBindings ?? [])
            }
            context={context}
          />
        ) : null}
      </>
    );
  return (
    <>
      <IntelligentUiCard
        block={block}
        sessionId={sessionId}
        messageId={messageId}
        enabled={enabled && active}
        resolvedDataset={resolvedData?.dataset ?? undefined}
        onImportDataset={(dataset) => {
          if (
            !lease.accepts() ||
            !block.definition ||
            !("kind" in block.definition) ||
            block.definition.kind !== "explorer"
          )
            return;
          const next = initialExplorer(
            block.definition,
            dataset ??
              (getActiveUiSourceContextKey(sessionId, messageId) === sourceKey
                ? (resolvedData?.dataset ?? undefined)
                : undefined),
          );
          void useChatStore
            .getState()
            .updateIntelligentUiState(
              sessionId,
              messageId,
              block.id,
              block.definitionRevision,
              next,
              "",
              { dataset },
            )
            .catch(() => {
              if (lease.accepts()) setSaveFailed(true);
            });
        }}
        onStateChange={saveState}
        onSendMessage={(text, isRuntimeActive) =>
          sendMessage && stillActive()
            ? sendMessage(text, {
                sessionId,
                messageId,
                blockId: block.id,
                definitionRevision: block.definitionRevision,
                isActive: () => stillActive() && isRuntimeActive(),
                isInstanceActive: () => lease.accepts() && isRuntimeActive(),
              })
            : Promise.resolve({ ok: false, code: "inactive" })
        }
      />
      {!block.dataSnapshot &&
      context &&
      (resolvedData || block.sourceBindings?.length) ? (
        <SourceBindings
          bindings={
            resolvedData ? [resolvedData.binding] : (block.sourceBindings ?? [])
          }
          context={context}
        />
      ) : null}
      {saveFailed ? (
        <div
          role="alert"
          className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400"
        >
          <p>{t("saveFailed")}</p>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              if (!stillActive()) return;
              Promise.resolve(waitForSessionMessageWrites(sessionId))
                .then(() => {
                  if (stillActive()) setSaveFailed(false);
                })
                .catch(() => {
                  if (stillActive()) setSaveFailed(true);
                });
            }}
          >
            {t("retrySave")}
          </Button>
        </div>
      ) : null}
    </>
  );
}
