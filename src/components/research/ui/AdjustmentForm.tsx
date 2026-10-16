"use client";

import React, { useId, useState } from "react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/primitives";
import { DEEP_RESEARCH_INSTRUCTION_MAX_CHARS } from "@/lib/research/toolArguments";
import { cn } from "@/lib/utils/cn";

export function AdjustmentForm({
  onSubmit,
  onDismiss,
  embeddedInDialog = false,
}: {
  onSubmit: (instruction: string) => void | Promise<void>;
  onDismiss: () => void;
  embeddedInDialog?: boolean;
}) {
  const t = useTranslations("Research");
  const id = useId();
  const [instruction, setInstruction] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(false);

  return (
    <form
      className={cn(
        embeddedInDialog ? "space-y-4 p-4" : "mt-3 border-t border-border pt-3",
      )}
      onSubmit={async (event) => {
        event.preventDefault();
        const value = instruction.trim();
        if (!value || submitting) return;
        setSubmitting(true);
        setError(false);
        try {
          await onSubmit(value);
          onDismiss();
        } catch {
          setError(true);
        } finally {
          setSubmitting(false);
        }
      }}
    >
      <label htmlFor={id} className="text-xs font-medium text-foreground">
        {t("adjust.label")}
      </label>
      <p id={`${id}-help`} className="mt-1 text-xs text-muted-foreground">
        {t("adjust.help")}
      </p>
      <textarea
        id={id}
        aria-describedby={`${id}-help`}
        maxLength={DEEP_RESEARCH_INSTRUCTION_MAX_CHARS}
        value={instruction}
        onChange={(event) => setInstruction(event.target.value)}
        rows={3}
        className="mt-2 w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        placeholder={t("adjust.placeholder")}
      />
      {error ? (
        <p className="mt-2 text-xs text-red-700 dark:text-red-300" role="alert">
          {t("adjust.error")}
        </p>
      ) : null}
      <div
        className={cn(
          "mt-2 flex justify-end gap-2",
          embeddedInDialog
            ? "[&_button]:min-h-11 md:[&_button]:h-8 md:[&_button]:min-h-0"
            : "[&_button]:h-9 [&_button]:min-h-0 sm:[&_button]:h-8",
        )}
      >
        <Button size="sm" onClick={onDismiss} disabled={submitting}>
          {t("actions.cancel")}
        </Button>
        <Button
          size="sm"
          variant="research"
          type="submit"
          disabled={!instruction.trim() || submitting}
        >
          {submitting ? t("adjust.submitting") : t("adjust.submit")}
        </Button>
      </div>
    </form>
  );
}
