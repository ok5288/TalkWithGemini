"use client";

import { createContext, useContext } from "react";
import type { UiHostAction } from "@/lib/intelligentUi/actions";
import type { UiSendResult } from "@/lib/intelligentUi/bridgeTypes";

/** Identity and lifetime are bound by the host component, never iframe data. */
export interface UiChatSource {
  sessionId: string;
  messageId: string;
  blockId: string;
  definitionRevision: number;
  isActive: () => boolean;
  /** Runtime lease only; dispatch separately validates the original source prefix. */
  isInstanceActive?: () => boolean;
}
export type UiChatSend = (
  text: string,
  source: UiChatSource,
  action?: UiHostAction,
) => Promise<UiSendResult>;

export const UiChatContext = createContext<UiChatSend | null>(null);
export const useUiChatSend = () => useContext(UiChatContext);
