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
}: IntelligentUiCardProps) {
  const t = useTranslations("IntelligentUi");
  const locale = useLocale();
  const [runtimeError, setRuntimeError] = useState("");
  const [generation, setGeneration] = useState(0);
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
    epoch: generation,
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
                definition={definition}
                state={state}
                onChange={(next) => updateState(next)}
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
                key={instanceId}
                source={definition.html}
                complete={block.status === "ready"}
                instanceId={instanceId}
                sessionId={sessionId}
                initialState={state}
                title={definition.title}
                onStateChange={(next) => updateState(next as JsonObject)}
                onSnapshot={(snapshot) =>
                  updateState(latestState.current, snapshot)
                }
                onSendMessage={(text, isRuntimeActive) => {
                  if (
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
              />
            ) : (
              fallback
            )
          ) : (
            fallback
          )}
        </UiBoundary>
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
