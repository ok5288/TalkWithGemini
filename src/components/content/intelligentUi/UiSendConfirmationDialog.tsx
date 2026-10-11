"use client";

import { useTranslations } from "next-intl";
import { Button, Dialog } from "@/components/ui/primitives";

export default function UiSendConfirmationDialog({
  proposal,
  onConfirm,
  onCancel,
}: {
  proposal: {
    id: string;
    text: string;
    context: string;
    saving: boolean;
    saveFailed: boolean;
  } | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations("IntelligentUi.sendConfirmation");
  return (
    <Dialog
      open={!!proposal}
      onClose={onCancel}
      title={t("title")}
      className="flex min-h-0 flex-col [&>div:first-child]:shrink-0"
    >
      <div className="min-h-0 min-w-0 space-y-4 overflow-y-auto overscroll-contain p-4">
        <div>
          <h3 className="font-medium">{t("message")}</h3>
          <pre className="whitespace-pre-wrap break-words font-sans [overflow-wrap:anywhere]">
            {proposal?.text}
          </pre>
        </div>
        <div>
          <h3 className="font-medium">{t("context")}</h3>
          <pre className="whitespace-pre-wrap break-words font-sans text-sm [overflow-wrap:anywhere]">
            {proposal?.context}
          </pre>
        </div>
        {proposal?.saveFailed && <p role="alert">{t("saveFailed")}</p>}
      </div>
      <div className="flex shrink-0 justify-end gap-2 border-t border-gray-200 p-4 dark:border-border">
        <Button variant="secondary" onClick={onCancel}>
          {t("cancel")}
        </Button>
        <Button disabled={proposal?.saving} onClick={onConfirm}>
          {t(proposal?.saving ? "saving" : "confirm")}
        </Button>
      </div>
    </Dialog>
  );
}
