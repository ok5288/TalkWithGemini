"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";
import {
  createUiDisplayOwnership,
  type UiDisplayOwnership,
  type UiDisplayTarget,
  uiDisplayKey,
} from "@/lib/intelligentUi/displayOwnership";
import { useChatStore } from "@/store/core/chatStore";
import { useSettingsStore } from "@/store/core/settingsStore";
import { waitForSessionMessageWrites } from "@/store/sessionMessagePersistence";
import { subscribeUiSourceAuthority } from "@/lib/intelligentUi/sourceContext";
import { isExplorerEnabled } from "@/lib/intelligentUi/featurePolicy";

export function validUiDisplayTarget(target: UiDisplayTarget) {
  const state = useChatStore.getState();
  const block = state.activeMessages
    .find((message) => message.id === target.messageId)
    ?.outputBlocks?.find((block) => block.id === target.blockId);
  return (
    state.currentSessionId === target.sessionId &&
    !state.pendingSessionId &&
    !state.isActiveSessionLoading &&
    useSettingsStore.getState().system.enableIntelligentUi &&
    block?.type === "intelligent_ui" &&
    block.status === "ready" &&
    !!block.definition &&
    block.definitionRevision === target.definitionRevision &&
    (!("kind" in block.definition) ||
      block.definition.kind !== "explorer" ||
      isExplorerEnabled())
  );
}
const DisplayContext = createContext<UiDisplayOwnership | null>(null);
const empty = {
  viewer: null,
  transitioning: false,
  error: null,
  revision: 0,
} as const;
const noopSubscribe = () => () => {};
const emptySnapshot = () => empty;
export function useUiDisplay() {
  const display = useContext(DisplayContext);
  const snapshot = useSyncExternalStore(
    display?.subscribe ?? noopSubscribe,
    display?.getSnapshot ?? emptySnapshot,
    emptySnapshot,
  );
  return { display, snapshot };
}
export function IntelligentUiDisplayProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [display] = useState(() =>
    createUiDisplayOwnership({
      flush: waitForSessionMessageWrites,
      valid: validUiDisplayTarget,
    }),
  );
  useEffect(() => {
    let viewerKey: string | null = null;
    let branch: string[] = [];
    const offDisplay = display.subscribe(() => {
      const target = display.getSnapshot().viewer;
      const key = target ? uiDisplayKey(target) : null;
      if (key !== viewerKey) {
        viewerKey = key;
        branch = useChatStore
          .getState()
          .activeMessages.map((message) => message.id);
      }
    });
    const offChat = useChatStore.subscribe((state) => {
      if (
        viewerKey &&
        !branch.every((id, index) => state.activeMessages[index]?.id === id)
      ) {
        display.destroy();
        return;
      }
      if (viewerKey) branch = state.activeMessages.map((message) => message.id);
      display.revalidate();
    });
    const offSource = subscribeUiSourceAuthority(() => display.revalidate());
    return () => {
      offChat();
      offDisplay();
      offSource();
      display.destroy();
    };
  }, [display]);
  return (
    <DisplayContext.Provider value={display}>
      {children}
    </DisplayContext.Provider>
  );
}
