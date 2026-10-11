"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { ToolCall } from "@/types";
import type { JsonObject, NativeDefinition } from "@/lib/intelligentUi/types";
import {
  resolveToolResultView,
  type UiToolResultDescriptor,
} from "@/lib/intelligentUi/toolResults/adapters";
import {
  commitToolDraft,
  prepareToolDraft,
  readToolDraftOutcome,
  type ToolDraftProposal,
  type ToolDraftOutcome,
} from "@/lib/intelligentUi/toolResults/draft";
import { normalizeChatMode } from "@/lib/chat/mode";
import { resolveAgentProfile } from "@/lib/assistant/profile";
import { requestComposerDraft } from "@/lib/chat/composerActions";
import { useChatStore } from "@/store/core/chatStore";
import { useSettingsStore } from "@/store/core/settingsStore";
import { Button } from "@/components/ui/primitives";
import NativeUi from "./NativeUi";

type View = Awaited<ReturnType<typeof resolveToolResultView>>;
const ids = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string")
    : [];

function currentCall(sessionId?: string, messageId?: string, callId?: string) {
  const store = useChatStore.getState();
  if (
    !sessionId ||
    store.currentSessionId !== sessionId ||
    store.isActiveSessionLoading ||
    store.pendingSessionId
  )
    return null;
  const message = store.activeMessages.find((item) => item.id === messageId);
  return (
    message?.outputBlocks
      ?.flatMap((block) => (block.type === "tool_group" ? block.toolCalls : []))
      .find((call) => call.id === callId) ??
    message?.toolCalls?.find((call) => call.id === callId) ??
    null
  );
}

export default function ToolResultUi({
  call: inputCall,
  sessionId,
  messageId,
  readOnly = false,
}: {
  call: ToolCall;
  sessionId?: string;
  messageId?: string;
  readOnly?: boolean;
}) {
  const {
    id,
    name,
    pluginId,
    executionRecordId,
    functionFingerprint,
    status,
    isError,
    result,
  } = inputCall;
  const descriptorJson = JSON.stringify(inputCall.intelligentUiResult);
  const intelligentUiResult = useMemo(
    () =>
      descriptorJson
        ? (JSON.parse(descriptorJson) as UiToolResultDescriptor)
        : undefined,
    [descriptorJson],
  );
  // Message block projection clones calls when unrelated text streams. Keep the
  // interaction instance stable while its actual result identity is unchanged.
  const call = useMemo<ToolCall>(
    () => ({
      id,
      name,
      pluginId,
      executionRecordId,
      functionFingerprint,
      status,
      isError,
      result,
      intelligentUiResult,
      args: {},
    }),
    [
      id,
      name,
      pluginId,
      executionRecordId,
      functionFingerprint,
      status,
      isError,
      result,
      intelligentUiResult,
    ],
  );
  const t = useTranslations("IntelligentUi");
  const locale = useLocale();
  const enabled = useSettingsStore((store) => store.system.enableIntelligentUi);
  const currentSessionId = useChatStore((store) => store.currentSessionId);
  const [resolved, setResolved] = useState<{
    call: ToolCall;
    view: View;
  } | null>(null);
  const [state, setState] = useState<JsonObject>({});
  const [proposal, setProposal] = useState<ToolDraftProposal | null>(null);
  const [outcome, setOutcome] = useState<ToolDraftOutcome | null>(null);
  const [busy, setBusy] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const generation = useRef(0);
  const working = useRef(false);
  const persistedState = inputCall.intelligentUiState;
  useEffect(() => {
    setState(persistedState ?? {});
  }, [persistedState, call.result]);
  useEffect(() => {
    const epoch = ++generation.current;
    setSaveFailed(false);
    setProposal(null);
    setOutcome(null);
    void resolveToolResultView(call)
      .then((view) => {
        if (generation.current === epoch) setResolved({ call, view });
      })
      .catch(() => {
        if (generation.current === epoch) setResolved({ call, view: null });
      });
    return () => {
      generation.current = epoch + 1;
    };
  }, [call, enabled, currentSessionId, sessionId, messageId, readOnly]);
  function updateState(next: JsonObject) {
    if (
      busy ||
      readOnly ||
      !enabled ||
      !useSettingsStore.getState().system.enableIntelligentUi ||
      !sessionId ||
      !messageId ||
      !view ||
      currentCall(sessionId, messageId, call.id)?.result !== call.result
    )
      return;
    setState(next);
    setProposal(null);
    setOutcome(null);
    const epoch = generation.current;
    void useChatStore
      .getState()
      .updateToolResultUiState(
        sessionId,
        messageId,
        call.id,
        view.descriptor.resultHash,
        next,
      )
      .then((saved) => {
        if (generation.current === epoch) setSaveFailed(!saved);
      })
      .catch(() => {
        if (generation.current === epoch) setSaveFailed(true);
      });
  }
  const view = resolved?.call === call ? resolved.view : null;
  const definition = useMemo(
    (): NativeDefinition | null =>
      !view
        ? null
        : {
            version: 1,
            kind: "explorer",
            title: t("toolResult.title"),
            summary: call.name,
            props: {
              dataset: {
                kind: "inline",
                data: {
                  ...view.dataset,
                  columns: view.dataset.columns.map((column) =>
                    view.descriptor.adapter !== "search-v1"
                      ? column
                      : {
                          ...column,
                          label:
                            column.id === "title"
                              ? t("toolResult.titleColumn")
                              : column.id === "snippet"
                                ? t("toolResult.summaryColumn")
                                : "URL",
                        },
                  ),
                },
              },
              provenance: "source",
              parameters: [],
              nodes: [],
            },
          },
    [view, call.name, t],
  );
  function authorized() {
    const store = useChatStore.getState();
    const session = store.sessions.find((item) => item.id === sessionId);
    const workspace = store.workspaces.find(
      (item) => item.id === session?.workspaceId,
    );
    const profile = resolveAgentProfile(
      workspace?.agentProfile,
      session?.config?.agentProfile,
    );
    const tools = profile.capabilities.toolIds;
    return (
      !readOnly &&
      useSettingsStore.getState().system.enableIntelligentUi &&
      !!session &&
      !!call.executionRecordId &&
      session.retention !== "temporary" &&
      store.currentSessionId === sessionId &&
      normalizeChatMode(
        store.chatConfig.chatMode,
        store.chatConfig.useAgentMode,
        store.chatConfig.useDeepResearch,
      ) === "agent" &&
      (!tools?.length || tools.includes("write_workspace_file")) &&
      currentCall(sessionId, messageId, call.id)?.result === call.result &&
      currentCall(sessionId, messageId, call.id)?.functionFingerprint ===
        call.functionFingerprint &&
      currentCall(sessionId, messageId, call.id)?.intelligentUiResult
        ?.resultHash === call.intelligentUiResult?.resultHash
    );
  }
  async function prepare(retry = false) {
    if (working.current || !authorized() || !view || !sessionId || !messageId)
      return;
    working.current = true;
    setBusy(true);
    const epoch = generation.current;
    try {
      const draft = await prepareToolDraft({
        retry,
        sessionId,
        messageId,
        call,
        locale,
        selectedIds: ids(state.selected),
        visibleColumns:
          state.visibleColumns === undefined
            ? view.dataset.columns.map((c) => c.id)
            : ids(state.visibleColumns),
      });
      if (!draft || !authorized() || generation.current !== epoch) return;
      const previous = await readToolDraftOutcome(draft);
      if (!authorized() || generation.current !== epoch) return;
      setOutcome(previous);
      setProposal(previous ? null : draft);
    } catch {
      if (generation.current === epoch) setOutcome({ status: "failed" });
    } finally {
      working.current = false;
      setBusy(false);
    }
  }
  async function confirm() {
    if (!proposal || working.current || !authorized()) return;
    working.current = true;
    setBusy(true);
    const epoch = generation.current;
    try {
      const result = await commitToolDraft(proposal, {
        authorized: () => generation.current === epoch && authorized(),
        currentCall: () => currentCall(sessionId, messageId, call.id),
      });
      if (generation.current === epoch) {
        setOutcome(result);
        setProposal(null);
      }
    } catch {
      if (generation.current === epoch) setOutcome({ status: "failed" });
    } finally {
      working.current = false;
      setBusy(false);
    }
  }
  if (!view || !definition) return null;
  const interactive =
    enabled && !readOnly && !!sessionId && currentSessionId === sessionId;
  function requestRefresh() {
    if (
      !interactive ||
      !sessionId ||
      !view ||
      !currentCall(sessionId, messageId, call.id)
    )
      return;
    // Only the known search query is a public scope hint. Never copy auth,
    // arbitrary tool arguments, hidden columns or the full result into a draft.
    const query =
      view.descriptor.adapter === "search-v1" &&
      typeof inputCall.args?.query === "string"
        ? inputCall.args.query.slice(0, 4000)
        : "";
    requestComposerDraft({
      sessionId,
      text: [
        t("toolResult.refreshRequest"),
        call.name,
        `${t("toolResult.version")}: ${view.descriptor.resultHash}`,
        ...(query
          ? [`${t("toolResult.refreshScope")}: ${JSON.stringify(query)}`]
          : []),
      ].join("\n\n"),
    });
  }
  return (
    <section
      className="my-2 min-w-0 space-y-3 rounded-md border border-border bg-background p-3"
      aria-label={t("toolResult.title")}
    >
      <p className="break-all text-xs text-muted-foreground">
        {t("toolResult.capturedAt")}:{" "}
        {new Date(view.descriptor.retrievedAt).toISOString()} ·{" "}
        {t("toolResult.version")}: {view.descriptor.resultHash}
      </p>
      {view.descriptor.partial && (
        <p role="status">{t("toolResult.partial")}</p>
      )}
      {interactive ? (
        <NativeUi
          definition={definition}
          state={state}
          onChange={updateState}
        />
      ) : (
        <div className="max-w-full overflow-auto">
          <table>
            <thead>
              <tr>
                {view.dataset.columns.map((c) => (
                  <th key={c.id}>{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {view.dataset.rows.map((r) => (
                <tr key={r.id}>
                  {view.dataset.columns.map((c) => (
                    <td key={c.id}>{String(r.values[c.id] ?? "")}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {interactive && (
        <>
          <Button variant="secondary" onClick={requestRefresh}>
            {t("toolResult.refreshInChat")}
          </Button>
          <Button
            variant="secondary"
            onClick={() => void prepare()}
            disabled={busy || !authorized() || !ids(state.selected).length}
          >
            {t("toolResult.saveDraft")}
          </Button>
          {!authorized() && (
            <p className="text-xs text-muted-foreground">
              {t("toolResult.draftUnavailable")}
            </p>
          )}
          {proposal && (
            <div
              role="group"
              aria-label={t("toolResult.previewDraft")}
              className="space-y-2"
            >
              <p className="break-all">
                write_workspace_file · {proposal.path}
              </p>
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words">
                {proposal.content}
              </pre>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => void confirm()}
              >
                {t("toolResult.confirmDraft")}
              </Button>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => setProposal(null)}
              >
                {t("toolResult.cancel")}
              </Button>
            </div>
          )}
        </>
      )}
      {busy && <p role="status">{t("toolResult.busy")}</p>}
      {saveFailed && <p role="alert">{t("toolResult.saveFailed")}</p>}
      {outcome?.retryable && interactive && (
        <div>
          <p>{t("toolResult.retrySafe")}</p>
          <Button
            variant="secondary"
            disabled={busy || !authorized()}
            onClick={() => void prepare(true)}
          >
            {t("toolResult.retryDraft")}
          </Button>
        </div>
      )}
      {outcome && (
        <p role="status">
          {t(`toolResult.${outcome.status}`)}
          {outcome.execution?.receipt
            ? ` · ${outcome.execution.id} · ${outcome.execution.receipt.resultHash}`
            : ""}
        </p>
      )}
    </section>
  );
}
