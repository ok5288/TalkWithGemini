"use client";

import React from "react";
import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Dialog, IconButton } from "@/components/ui/primitives";
import { AdjustmentForm } from "./AdjustmentForm";

export default function ResearchAdjustmentDialog({
  onClose,
  onSubmit,
}: {
  onClose: () => void;
  onSubmit: (instruction: string) => void | Promise<void>;
}) {
  const t = useTranslations("Research");
  return (
    <Dialog
      open
      onClose={onClose}
      title={t("adjust.title")}
      headerAction={
        <IconButton
          label={t("actions.closeAdjust")}
          icon={<X size={16} aria-hidden="true" />}
          onClick={onClose}
        />
      }
      placement="responsive-sheet"
      closeOnBackdropClick
    >
      <AdjustmentForm
        embeddedInDialog
        onSubmit={onSubmit}
        onDismiss={onClose}
      />
    </Dialog>
  );
}
