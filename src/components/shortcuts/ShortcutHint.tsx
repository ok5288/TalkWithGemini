"use client";

import React from "react";

import {
  formatShortcutBinding,
  shortcutBindingToAriaKeyShortcuts,
  type ShortcutActionId,
  type ShortcutPlatform,
} from "@/lib/shortcuts";
import { useCoreSettingsStore } from "@/store/core/coreSettingsStore";

function getBrowserShortcutPlatform(): ShortcutPlatform {
  if (typeof navigator === "undefined") return "other";
  const browserNavigator = navigator as Navigator & {
    userAgentData?: { platform?: string };
  };
  const platform =
    browserNavigator.userAgentData?.platform ||
    browserNavigator.platform ||
    browserNavigator.userAgent;
  return /Mac|iPhone|iPad|iPod/i.test(platform) ? "mac" : "other";
}

export function useShortcutPresentation(actionId: ShortcutActionId) {
  const binding = useCoreSettingsStore(
    (state) => state.shortcutBindings[actionId],
  );
  const [platform, setPlatform] = React.useState<ShortcutPlatform>("other");

  React.useEffect(() => setPlatform(getBrowserShortcutPlatform()), []);

  return React.useMemo(
    () => ({
      ariaKeyShortcuts: shortcutBindingToAriaKeyShortcuts(binding, platform),
      display: binding ? formatShortcutBinding(binding, platform) : null,
    }),
    [binding, platform],
  );
}

interface ShortcutTooltipContentProps {
  label: React.ReactNode;
  shortcut: string | null;
}

export function ShortcutTooltipContent({
  label,
  shortcut,
}: ShortcutTooltipContentProps) {
  return (
    <span className="flex items-center gap-2">
      <span>{label}</span>
      {shortcut ? (
        <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] font-semibold leading-none text-muted-foreground shadow-sm">
          {shortcut}
        </kbd>
      ) : null}
    </span>
  );
}
