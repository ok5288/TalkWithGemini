"use client";

import React, {
  useState,
  useEffect,
  useMemo,
  useRef,
  useLayoutEffect,
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
  useActiveUiSourceContext,
  getActiveUiSourceContextKey,
  getActiveUiSourceOwnershipKey,
} from "@/lib/intelligentUi/sourceContext";
import { resolveUiSourceDataset } from "@/lib/intelligentUi/sources/dataset";
import { projectUiSources } from "@/lib/intelligentUi/sources/resolver";
import { Button } from "@/components/ui/primitives";
import { waitForSessionMessageWrites } from "@/store/sessionMessagePersistence";
import { useUiDisplay } from "./intelligentUi/IntelligentUiDisplayContext";
import {
  uiDisplayKey,
  type UiDisplayGrant,
  type UiDisplayLocation,
} from "@/lib/intelligentUi/displayOwnership";
import { getUiRepairSource } from "@/lib/intelligentUi/actions";
import { initialExplorer } from "@/lib/intelligentUi/explorer/derive";

export default function ConnectedIntelligentUiBlock({
  block,
  sessionId,
  messageId,
  mode = "interactive",
  location = "inline",
}: {
  block: IntelligentUiBlock;
  sessionId: string;
  messageId: string;
  mode?: "interactive" | "static-original" | "static-current";
  location?: UiDisplayLocation;
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
  const repairLifetime = useRef({ active: true });
  useLayoutEffect(() => {
    const lifetime = { active: true };
    repairLifetime.current = lifetime;
    return () => {
      lifetime.active = false;
    };
  }, [
    sessionId,
    messageId,
    block.id,
    block.definitionRevision,
    active,
    enabled,
  ]);
  const repairActive = () => {
    const store = useChatStore.getState();
    const current = store.activeMessages
      .find((message) => message.id === messageId)
      ?.outputBlocks?.find((item) => item.id === block.id);
    return (
      active &&
      enabled &&
      store.currentSessionId === sessionId &&
      !store.pendingSessionId &&
      !store.isActiveSessionLoading &&
      useSettingsStore.getState().system.enableIntelligentUi &&
      current?.type === "intelligent_ui" &&
      current.definitionRevision === block.definitionRevision
    );
  };
  const [hostActionError, setHostActionError] = useState<
    "failed" | "busy" | null
  >(null);
  const [saveFailed, setSaveFailed] = useState(false);
  const selector =
    block.definition &&
    "kind" in block.definition &&
    block.definition.kind === "explorer" &&
    block.definition.props.dataset.kind === "context"
      ? block.definition.props.dataset
      : undefined;
  const needsSources = !!selector || !!block.sourceBindings?.length;
  const {
    key: sourceKey,
    ownershipKey,
    context,
  } = useActiveUiSourceContext(sessionId, messageId, active, needsSources);
  const { display, snapshot: displaySnapshot } = useUiDisplay();
  const target = useMemo(
    () => ({
      sessionId,
      messageId,
      blockId: block.id,
      definitionRevision: block.definitionRevision,
    }),
    [sessionId, messageId, block.id, block.definitionRevision],
  );
  const grant = useRef<UiDisplayGrant | null>(null);
  const [displayId] = useState(() => Symbol());
  const releaseRuntime = useRef<(() => void) | null>(null);
  const pendingImport = useRef(false);
  const [runtimeReady, setRuntimeReady] = useState(block.renderer !== "html");
  const runtimeReadyRef = useRef(runtimeReady);
  useLayoutEffect(() => {
    runtimeReadyRef.current = runtimeReady;
  });
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
    (!needsSources ||
      getActiveUiSourceOwnershipKey(sessionId, messageId) === ownershipKey) &&
    (!selector ||
      !!block.dataSnapshot ||
      (getActiveUiSourceOwnershipKey(sessionId, messageId) === ownershipKey &&
        !!resolvedData?.dataset));
  const eligible = useRef(stillActive);
  useLayoutEffect(() => {
    eligible.current = stillActive;
  });
  useLayoutEffect(() => {
    if (!display || mode !== "interactive") return;
    if (!grant.current?.owns()) {
      grant.current = display.register(
        target,
        location,
        {
          eligible: () => eligible.current(),
          pendingImport: () => pendingImport.current,
          ready: () => runtimeReadyRef.current,
          release: () => releaseRuntime.current?.(),
        },
        displayId,
      );
    }
  });
  useLayoutEffect(
    () => () => {
      grant.current?.unregister();
      grant.current = null;
    },
    [display, target, location],
  );
  const displayState = display?.inspect(target, displayId);
  const owns = !display || !!displayState?.owns;
  const canInteract = () =>
    stillActive() && (!display || !!grant.current?.interactive());
  const canSave = () => stillActive() && (!display || !!grant.current?.owns());
  const paused = !!displayState?.paused;
  const inViewer =
    displaySnapshot.viewer &&
    uiDisplayKey(displaySnapshot.viewer) === uiDisplayKey(target);
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
    if (!canSave()) return;
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
      {display &&
      enabled &&
      active &&
      block.status === "ready" &&
      location === "inline" ? (
        <div
          className="flex items-center gap-2 outline-none focus-visible:ring-2 focus-visible:ring-ring"
          data-ui-viewer-origin={uiDisplayKey(target)}
          tabIndex={-1}
        >
          {inViewer ? (
            <p className="text-xs text-muted-foreground">
              {t("viewer.opened")}
            </p>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              disabled={displaySnapshot.transitioning || !owns || !runtimeReady}
              data-ui-viewer-open={uiDisplayKey(target)}
              onClick={() => void display.move(target)}
            >
              {t("viewer.open")}
            </Button>
          )}
        </div>
      ) : null}
      {enabled &&
      active &&
      sendMessage &&
      ((owns && !paused) ||
        block.status === "failed" ||
        block.status === "cancelled") ? (
        <div className="flex flex-wrap gap-2">
          {(block.status === "ready"
            ? (["explain", "modify"] as const)
            : getUiRepairSource(
                  useChatStore
                    .getState()
                    .activeMessages.find(
                      (message) => message.id === messageId,
                    )!,
                  block.id,
                )
              ? (["repair"] as const)
              : []
          ).map((action) => (
            <Button
              key={action}
              size="sm"
              variant="ghost"
              onClick={() => {
                const interaction = grant.current?.captureInteraction();
                const lifetime = repairLifetime.current;
                setHostActionError(null);
                void sendMessage(
                  t(`hostActions.${action}Draft`),
                  {
                    sessionId,
                    messageId,
                    blockId: block.id,
                    definitionRevision: block.definitionRevision,
                    isActive: () =>
                      action === "repair"
                        ? lifetime.active && repairActive()
                        : canInteract() && (!interaction || interaction()),
                    isInstanceActive: () =>
                      action === "repair"
                        ? lifetime.active && repairActive()
                        : lease.accepts() && (!interaction || interaction()),
                  },
                  action,
                )
                  .then((result) => {
                    if (
                      !result.ok &&
                      result.code !== "inactive" &&
                      result.code !== "cancelled" &&
                      repairLifetime.current === lifetime &&
                      lifetime.active
                    )
                      setHostActionError(
                        result.code === "busy" ? "busy" : "failed",
                      );
                  })
                  .catch(() => {
                    if (lifetime.active) setHostActionError("failed");
                  });
              }}
            >
              {t(`hostActions.${action}`)}
            </Button>
          ))}
        </div>
      ) : null}
      {displaySnapshot.error && location === "inline" && !inViewer ? (
        <p role="alert" className="text-sm text-red-600">
          {t(`viewer.${displaySnapshot.error}Error`)}
        </p>
      ) : null}
      {hostActionError ? (
        <p role="alert" className="text-sm text-red-600">
          {t(`hostActions.${hostActionError}`)}
        </p>
      ) : null}
      <IntelligentUiCard
        block={block}
        sessionId={sessionId}
        messageId={messageId}
        enabled={enabled && active}
        readOnly={!owns && block.status === "ready"}
        onEscape={
          location === "viewer" && display
            ? () => {
                void display.move(null);
              }
            : undefined
        }
        paused={paused}
        displayEpoch={displayState?.epoch ?? 0}
        canStartRuntime={() => canSave()}
        onRuntimeStatus={(status) =>
          setRuntimeReady(status === "active" || status === "failed")
        }
        onRuntimeControl={(release) => {
          releaseRuntime.current = release;
        }}
        onPendingImportChange={(pending) => {
          pendingImport.current = pending;
        }}
        resolvedDataset={resolvedData?.dataset ?? undefined}
        onImportDataset={(dataset) => {
          if (
            !canInteract() ||
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
        onSendMessage={(text, isRuntimeActive) => {
          const interaction = grant.current?.captureInteraction();
          return sendMessage && canInteract()
            ? sendMessage(text, {
                sessionId,
                messageId,
                blockId: block.id,
                definitionRevision: block.definitionRevision,
                isActive: () =>
                  canInteract() &&
                  isRuntimeActive() &&
                  (!interaction || interaction()),
                isInstanceActive: () =>
                  lease.accepts() &&
                  isRuntimeActive() &&
                  (!interaction || interaction()),
              })
            : Promise.resolve({ ok: false, code: "inactive" });
        }}
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
