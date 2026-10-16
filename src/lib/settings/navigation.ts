import {
  SETTINGS_TAB_VALUES,
  type SettingsTabId,
} from "@/lib/chat/panelUrlState";

export const SETTINGS_TAB_NAVIGATE_EVENT = "neo-chat:settings-tab-navigate";

export interface SettingsTabNavigationDetail {
  tab: SettingsTabId;
}

export function openSettingsTab(tab: SettingsTabId): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<SettingsTabNavigationDetail>(SETTINGS_TAB_NAVIGATE_EVENT, {
      detail: { tab },
    }),
  );
}

export function isSettingsTabId(value: unknown): value is SettingsTabId {
  return SETTINGS_TAB_VALUES.some((tab) => tab === value);
}
