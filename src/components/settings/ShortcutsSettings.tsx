"use client";

import React, { useState } from "react";
import { RotateCcw, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  DEFAULT_SHORTCUT_BINDINGS,
  SHORTCUT_ACTION_IDS,
  findShortcutConflict,
  formatShortcutBinding,
  shortcutBindingFromEvent,
  validateShortcutBinding,
  type ShortcutActionId,
  type ShortcutBinding,
} from "@/lib/shortcuts";
import { useCoreSettingsStore } from "@/store/core/coreSettingsStore";
import { Button } from "@/components/ui/primitives";

type RecordingError =
  | { actionId: ShortcutActionId; kind: "invalid" }
  | { actionId: ShortcutActionId; kind: "reserved" }
  | {
      actionId: ShortcutActionId;
      kind: "conflict";
      conflictActionId: ShortcutActionId;
      shortcut: string;
    };

const bindingsEqual = (
  first: ShortcutBinding | null,
  second: ShortcutBinding | null,
) =>
  first === second ||
  (first !== null &&
    second !== null &&
    first.code === second.code &&
    first.mod === second.mod &&
    first.alt === second.alt &&
    first.shift === second.shift);

const ShortcutsSettings: React.FC = () => {
  const t = useTranslations("Shortcuts");
  const shortcutBindings = useCoreSettingsStore(
    (state) => state.shortcutBindings,
  );
  const setShortcutBinding = useCoreSettingsStore(
    (state) => state.setShortcutBinding,
  );
  const resetShortcutBinding = useCoreSettingsStore(
    (state) => state.resetShortcutBinding,
  );
  const resetShortcutBindings = useCoreSettingsStore(
    (state) => state.resetShortcutBindings,
  );
  const [recordingActionId, setRecordingActionId] =
    useState<ShortcutActionId | null>(null);
  const [recordingError, setRecordingError] = useState<RecordingError | null>(
    null,
  );

  const handleRecordKeyDown = React.useCallback(
    (actionId: ShortcutActionId, event: KeyboardEvent) => {
      if (event.key === "Tab") return;

      event.preventDefault();
      event.stopPropagation();

      if (event.key === "Escape") {
        setRecordingActionId(null);
        setRecordingError(null);
        return;
      }

      const binding = shortcutBindingFromEvent(event);
      if (!binding) {
        setRecordingError({ actionId, kind: "invalid" });
        return;
      }

      const validation = validateShortcutBinding(binding);
      if (!validation.valid) {
        setRecordingError({ actionId, kind: validation.reason });
        return;
      }

      const conflictActionId = findShortcutConflict(
        shortcutBindings,
        binding,
        actionId,
      );
      if (conflictActionId) {
        setRecordingError({
          actionId,
          kind: "conflict",
          conflictActionId,
          shortcut: formatShortcutBinding(binding),
        });
        return;
      }

      setShortcutBinding(actionId, binding);
      setRecordingActionId(null);
      setRecordingError(null);
    },
    [setShortcutBinding, shortcutBindings],
  );

  React.useEffect(() => {
    if (!recordingActionId) return;
    const handleKeyDown = (event: KeyboardEvent) =>
      handleRecordKeyDown(recordingActionId, event);
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [handleRecordKeyDown, recordingActionId]);

  const getErrorMessage = (error: RecordingError) => {
    if (error.kind === "invalid") return t("invalidShortcut");
    if (error.kind === "reserved") return t("reservedShortcut");

    return t("conflictingShortcut", {
      shortcut: error.shortcut,
      action: t(`action_${error.conflictActionId}`),
    });
  };

  return (
    <section aria-labelledby="shortcut-settings-title" className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="max-w-2xl">
          <h2
            id="shortcut-settings-title"
            className="text-lg font-semibold text-foreground"
          >
            {t("title")}
          </h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            {t("description")}
          </p>
        </div>
        <Button
          variant="bare"
          type="button"
          aria-label={t("resetAllAria")}
          onClick={() => {
            resetShortcutBindings();
            setRecordingActionId(null);
            setRecordingError(null);
          }}
          className="inline-flex min-h-9 shrink-0 items-center justify-center gap-2 rounded-lg border border-border bg-background px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <RotateCcw size={15} aria-hidden="true" />
          {t("resetAll")}
        </Button>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        {SHORTCUT_ACTION_IDS.map((actionId, index) => {
          const binding = shortcutBindings[actionId];
          const isRecording = recordingActionId === actionId;
          const error =
            recordingError?.actionId === actionId ? recordingError : null;
          const isDefault = bindingsEqual(
            binding,
            DEFAULT_SHORTCUT_BINDINGS[actionId],
          );

          return (
            <div
              key={actionId}
              className={`grid gap-4 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center md:px-5 ${
                index > 0 ? "border-t border-border" : ""
              }`}
            >
              <div className="min-w-0">
                <h3 className="text-sm font-medium text-foreground">
                  {t(`action_${actionId}`)}
                </h3>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  {t(`description_${actionId}`)}
                </p>
                {isRecording ? (
                  <p
                    id={`shortcut-recording-help-${actionId}`}
                    className="mt-2 text-xs font-medium text-brand"
                  >
                    {t("recordingHelp")}
                  </p>
                ) : null}
                {error ? (
                  <p
                    role="alert"
                    className="mt-2 text-xs font-medium text-destructive"
                  >
                    {getErrorMessage(error)}
                  </p>
                ) : null}
              </div>

              <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                <kbd className="inline-flex min-h-8 min-w-20 items-center justify-center rounded-md border border-border bg-muted px-2.5 font-mono text-xs font-semibold text-foreground shadow-[inset_0_-1px_0_hsl(var(--border))]">
                  {binding ? formatShortcutBinding(binding) : t("unassigned")}
                </kbd>
                <Button
                  variant="bare"
                  type="button"
                  aria-label={
                    isRecording
                      ? t("recordingAria", { action: t(`action_${actionId}`) })
                      : t("recordAria", { action: t(`action_${actionId}`) })
                  }
                  aria-pressed={isRecording}
                  aria-describedby={
                    isRecording
                      ? `shortcut-recording-help-${actionId}`
                      : undefined
                  }
                  onClick={() => {
                    setRecordingActionId(actionId);
                    setRecordingError(null);
                  }}
                  className={`inline-flex min-h-8 items-center justify-center rounded-md border px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                    isRecording
                      ? "border-brand/50 bg-brand/10 text-brand"
                      : "border-border bg-background text-foreground hover:bg-muted"
                  }`}
                >
                  {isRecording ? t("recording") : t("record")}
                </Button>
                <Button
                  variant="bare"
                  type="button"
                  disabled={binding === null}
                  aria-label={t("clearAria", {
                    action: t(`action_${actionId}`),
                  })}
                  onClick={() => {
                    setShortcutBinding(actionId, null);
                    setRecordingActionId(null);
                    setRecordingError(null);
                  }}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-35"
                >
                  <Trash2 size={15} aria-hidden="true" />
                </Button>
                <Button
                  variant="bare"
                  type="button"
                  disabled={isDefault}
                  aria-label={t("restoreAria", {
                    action: t(`action_${actionId}`),
                  })}
                  onClick={() => {
                    resetShortcutBinding(actionId);
                    setRecordingActionId(null);
                    setRecordingError(null);
                  }}
                  className="inline-flex min-h-8 items-center justify-center rounded-md px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-35"
                >
                  {t("restore")}
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
};

export default ShortcutsSettings;
