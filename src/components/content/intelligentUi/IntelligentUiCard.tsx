"use client";

import React, {
  Component,
  useRef,
  useEffect,
  useState,
  useLayoutEffect,
} from "react";
import dynamic from "next/dynamic";
import { useTranslations, useLocale } from "next-intl";
import { Button } from "@/components/ui/primitives";
import type { IntelligentUiBlock, JsonObject } from "@/lib/intelligentUi/types";
import { projectUiBlock } from "@/lib/intelligentUi/projection";
import { getNativeInitialState } from "@/lib/intelligentUi/catalog";
import {
  getUiInstanceKey,
  isUiInstanceEligible,
  type HtmlRuntimeStatus,
} from "@/lib/intelligentUi/instance";
import NativeUi from "./NativeUi";
import { isExplorerEnabled } from "@/lib/intelligentUi/featurePolicy";
import { initialExplorer } from "@/lib/intelligentUi/explorer/derive";
import type { HtmlUiFrameProps } from "./HtmlUiFrame";
import type { ExplorerDataset } from "@/lib/intelligentUi/explorer/types";

const HtmlUiFrame = dynamic(
  () => import("./HtmlUiFrame").then((module) => module.HtmlUiFrame),
  { ssr: false },
);

export interface IntelligentUiCardProps {
  block: IntelligentUiBlock;
  enabled: boolean;
  readOnly?: boolean;
  sessionId?: string;
  messageId?: string;
  onStateChange?: (state: JsonObject, snapshot?: string) => void;
  onSendMessage?: HtmlUiFrameProps["onSendMessage"];
  resolvedDataset?: ExplorerDataset;
  onImportDataset?: (dataset: ExplorerDataset | null) => void;
  onEscape?: () => void;
  paused?: boolean;
  displayEpoch?: number;
  canStartRuntime?: () => boolean;
  onRuntimeControl?: HtmlUiFrameProps["onRuntimeControl"];
  onRuntimeStatus?: (status: HtmlRuntimeStatus) => void;
  onPendingImportChange?: (pending: boolean) => void;
}

class UiBoundary extends Component<
  { children: React.ReactNode; fallback: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export default function IntelligentUiCard(props: IntelligentUiCardProps) {
  return (
    <IntelligentUiCardContent
      key={`${props.sessionId}:${props.messageId}:${props.block.id}:${props.block.definitionRevision}`}
      {...props}
    />
  );
}

function IntelligentUiCardContent({
  block,
  enabled,
  readOnly = false,
  sessionId = "",
  messageId = "",
  onStateChange,
  onSendMessage,
  resolvedDataset,
  onImportDataset,
  onEscape,
  paused = false,
  displayEpoch = 0,
  canStartRuntime,
  onRuntimeControl,
  onRuntimeStatus,
  onPendingImportChange,
}: IntelligentUiCardProps) {
  const t = useTranslations("IntelligentUi");
  const locale = useLocale();
  const [runtimeError, setRuntimeError] = useState("");
  const [generation, setGeneration] = useState(0);
  const [runtimeStatus, setRuntimeStatus] =
    useState<HtmlRuntimeStatus>("starting");
  const definition = block.definition;
  const featureEnabled =
    !(definition && "kind" in definition && definition.kind === "explorer") ||
    isExplorerEnabled();
  const interactive = isUiInstanceEligible(
    block,
    enabled && featureEnabled,
    !readOnly && !!onStateChange,
  );
  const interactionAllowed = useRef(interactive);
  useLayoutEffect(() => {
    interactionAllowed.current = interactive;
    return () => {
      interactionAllowed.current = false;
    };
  }, [interactive]);
  const instanceId = getUiInstanceKey({
    sessionId,
    messageId,
    blockId: block.id,
    definitionRevision: block.definitionRevision,
    epoch: displayEpoch,
  });
  const dataset = block.dataSnapshot ?? resolvedDataset;
  const expectedDataset =
    definition && "kind" in definition && definition.kind === "explorer"
      ? definition.props.dataset.kind === "inline"
        ? definition.props.dataset.data
        : resolvedDataset
      : undefined;
  const initialState =
    definition && "kind" in definition
      ? definition.kind === "explorer"
        ? initialExplorer(definition, dataset)
        : getNativeInitialState(definition)
      : {};
  const state =
    definition && Object.keys(block.state).length === 0
      ? initialState
      : block.state;
  const latestState = useRef(state);
  useEffect(() => {
    latestState.current = state;
  }, [state]);
  const updateState = (next: JsonObject, snapshot?: string) => {
    if (!interactionAllowed.current) return;
    latestState.current = next;
    onStateChange?.(next, snapshot);
  };
  const currentBlock = { ...block, state };
  const diagnostic =
    runtimeError === "invalid_definition"
      ? "html_policy"
      : block.diagnostic?.code;
  const statusLabel =
    block.status === "receiving" || block.status === "preview"
      ? t(`status.${block.status}`)
      : block.status === "failed" || block.status === "cancelled"
        ? t(`status.${block.status}`)
        : runtimeError
          ? t("runtime.failed")
          : interactive && block.renderer === "html"
            ? t(
                `runtime.${runtimeStatus === "disposed" ? "failed" : runtimeStatus}`,
              )
            : interactive
              ? t("runtime.active")
              : undefined;
  const fallback = (
    <div className="whitespace-pre-wrap break-words text-sm leading-relaxed">
      {projectUiBlock(currentBlock, {
        purpose: readOnly ? "static-original" : "static-current",
        locale,
        dataset: resolvedDataset,
      }) || t("unavailable")}
    </div>
  );
  return (
    <section
      aria-label={definition?.title || t("title")}
      className="my-3 min-w-0 max-w-full text-inherit"
    >
      <div className="min-w-0">
        {enabled && !readOnly && statusLabel ? (
          <p
            role="status"
            aria-live="polite"
            className="mb-2 text-xs text-muted-foreground"
          >
            {statusLabel}
          </p>
        ) : null}
        {enabled && !readOnly && diagnostic ? (
          <p className="mb-2 text-sm text-muted-foreground">
            {t(`diagnostic.${diagnostic}`)}
          </p>
        ) : null}
        {enabled && !readOnly && block.status === "receiving" ? (
          <div
            aria-hidden="true"
            className="space-y-2 motion-safe:animate-pulse"
          >
            <div className="h-3 w-1/3 rounded bg-foreground/10" />
            <div className="h-8 rounded bg-foreground/5" />
          </div>
        ) : null}
        <div inert={paused ? true : undefined} aria-busy={paused || undefined}>
          <UiBoundary
            key={`${block.id}:${block.definitionRevision}:${generation}`}
            fallback={
              <>
                <p role="alert" className="text-sm text-red-600">
                  {t("renderError")}
                </p>
                {fallback}
              </>
            }
          >
            {interactive && !runtimeError ? (
              definition && "kind" in definition ? (
                <NativeUi
                  onPendingImportChange={onPendingImportChange}
                  definition={definition}
                  state={state}
                  onChange={(next) => {
                    if (!paused) updateState(next);
                  }}
                  dataset={dataset}
                  expectedDataset={expectedDataset}
                  onImportDataset={
                    onImportDataset
                      ? (next) => {
                          if (interactionAllowed.current) onImportDataset(next);
                        }
                      : undefined
                  }
                  datasetProvenance={block.dataSnapshot ? "user" : undefined}
                />
              ) : definition && "html" in definition ? (
                <HtmlUiFrame
                  onEscape={onEscape}
                  canStartRuntime={canStartRuntime}
                  onRuntimeControl={onRuntimeControl}
                  key={instanceId}
                  source={definition.html}
                  complete={block.status === "ready"}
                  instanceId={`${instanceId}:${generation}`}
                  sessionId={sessionId}
                  initialState={state}
                  title={definition.title}
                  onStateChange={(next) => updateState(next as JsonObject)}
                  onSnapshot={(snapshot) =>
                    updateState(latestState.current, snapshot)
                  }
                  onSendMessage={(text, isRuntimeActive) => {
                    if (
                      paused ||
                      !interactionAllowed.current ||
                      !isRuntimeActive() ||
                      !onSendMessage
                    )
                      return Promise.resolve({ ok: false, code: "inactive" });
                    return onSendMessage(
                      text,
                      () => interactionAllowed.current && isRuntimeActive(),
                    );
                  }}
                  onError={setRuntimeError}
                  onStatus={(status) => {
                    setRuntimeStatus(status);
                    onRuntimeStatus?.(status);
                  }}
                />
              ) : (
                fallback
              )
            ) : (
              fallback
            )}
          </UiBoundary>
        </div>
        {runtimeError && (
          <div
            role="alert"
            className="flex flex-wrap items-center gap-2 text-sm text-red-600 dark:text-red-400"
          >
            <p>{t("renderError")}</p>
            {interactive && block.renderer === "html" && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setRuntimeError("");
                  setRuntimeStatus("starting");
                  setGeneration((value) => value + 1);
                }}
              >
                {t("retry")}
              </Button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
