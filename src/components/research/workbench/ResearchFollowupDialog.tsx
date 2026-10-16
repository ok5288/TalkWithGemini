"use client";

import React, { useId, useState } from "react";
import { useTranslations } from "next-intl";

import { X, RefreshCw } from "lucide-react";
import { Button, Dialog, IconButton } from "@/components/ui/primitives";

export function ResearchFollowupDialog({
  open,
  onClose,
  onSubmit,
  onUpdateLatest,
}: {
  open: boolean;
  onClose: () => void;
  onUpdateLatest?: () => void | Promise<void>;
  onSubmit: (value: string) => void | Promise<void>;
}) {
  const t = useTranslations("Research");
  const [value, setValue] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(false);
  const fieldId = useId();

  const close = () => {
    if (submitting) return;
    setValue("");
    setError(false);
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      title={t("followup.continue.title")}
      headerAction={
        <IconButton
          label={t("actions.closeWorkbench")}
          icon={<X size={18} />}
          onClick={close}
          disabled={submitting}
        />
      }
      placement="responsive-sheet"
    >
      {open ? (
        <form
          className="max-h-[calc(92dvh-3.25rem)] space-y-4 overflow-y-auto p-4"
          onSubmit={async (event) => {
            event.preventDefault();
            const input = value.trim();
            if (!input || submitting) return;
            setSubmitting(true);
            setError(false);
            try {
              await onSubmit(input);
              setValue("");
              onClose();
            } catch {
              setError(true);
            } finally {
              setSubmitting(false);
            }
          }}
        >
          <div>
            <label
              htmlFor={fieldId}
              className="text-sm font-medium text-foreground"
            >
              {t("followup.continue.label")}
            </label>
            <p
              id={`${fieldId}-help`}
              className="mt-1 text-xs leading-5 text-muted-foreground"
            >
              {t("followup.continue.help")}
            </p>
            <textarea
              id={fieldId}
              aria-describedby={`${fieldId}-help`}
              value={value}
              onChange={(event) => setValue(event.target.value)}
              rows={5}
              placeholder={t("followup.continue.placeholder")}
              className="mt-2 w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            />
            {error ? (
              <p
                className="mt-2 text-xs text-red-700 dark:text-red-300"
                role="alert"
              >
                {t("followup.error")}
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap justify-end gap-2 [&_button]:h-9 [&_button]:min-h-0 sm:[&_button]:h-8">
            {onUpdateLatest ? (
              <Button
                variant="ghost"
                disabled={submitting}
                onClick={async () => {
                  if (submitting) return;
                  setSubmitting(true);
                  setError(false);
                  try {
                    await onUpdateLatest();
                    setValue("");
                    onClose();
                  } catch {
                    setError(true);
                  } finally {
                    setSubmitting(false);
                  }
                }}
              >
                <RefreshCw size={14} aria-hidden="true" />
                {t("actions.updateLatest")}
              </Button>
            ) : null}
            <Button
              type="submit"
              variant="research"
              disabled={!value.trim() || submitting}
            >
              {submitting
                ? t("followup.submitting")
                : t("followup.continue.submit")}
            </Button>
          </div>
        </form>
      ) : null}
    </Dialog>
  );
}
