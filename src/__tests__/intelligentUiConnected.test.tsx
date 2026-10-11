// @vitest-environment jsdom
import React from "react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Message } from "@/types";
import type { IntelligentUiBlock } from "@/lib/intelligentUi/types";
import { parseIntelligentUiText } from "@/lib/intelligentUi/parser";
import { normalizeSessionMessageTree } from "@/lib/chat/messageTree";
import { useSettingsStore } from "@/store/core/settingsStore";
import ConnectedIntelligentUiBlock from "@/components/content/ConnectedIntelligentUiBlock";
import messages from "@/i18n/locales/en/IntelligentUi.json";
vi.mock("next/dynamic", () => ({ default: () => () => null }));
const { appDb, stored } = vi.hoisted(() => {
  const stored = new Map<string, unknown>();
  return {
    stored,
    appDb: {
      getItem: vi.fn(async (key: string) => stored.get(key)),
      setItem: vi.fn(async (key: string, value: unknown) => {
        stored.set(key, value);
      }),
      removeItem: vi.fn(async (key: string) => {
        stored.delete(key);
      }),
    },
  };
});
vi.mock("@/store/storage/storageConfig", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/store/storage/storageConfig")>()),
  appDb,
  getAppDbStorage: () => ({
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
  }),
  STORAGE_KEYS: { CHAT: "neo-chat-storage" },
  STORAGE_VERSION: 2,
}));
vi.mock("@/services/sharing/client", () => ({
  revokeSessionShareBeforeDelete: vi.fn(async () => undefined),
  cancelSessionShareDeletion: vi.fn(async () => undefined),
}));
vi.mock("@/utils/opfs", () => ({
  deleteFromOPFS: vi.fn(async () => undefined),
}));
vi.mock("@/services/workspace/sessionArtifact", () => ({
  deleteSessionArtifacts: vi.fn(async () => undefined),
  duplicateSessionArtifacts: vi.fn(async () => new Map()),
}));
vi.mock("@/store/core/agentRunStore", () => ({
  useAgentRunStore: {
    getState: () => ({ clearSessionRuns: vi.fn(async () => undefined) }),
  },
}));
const { useChatStore } = await import("@/store/core/chatStore");
function makeBlock(): IntelligentUiBlock {
  const result = parseIntelligentUiText(
    '```intelligent-ui\n{"version":1,"kind":"checklist","title":"Tasks","summary":"Prepare","props":{"items":[{"id":"one","label":"One"}]}}\n```',
    { idPrefix: "message", final: true },
  )[0];
  if (result?.type !== "intelligent_ui") throw Error("Invalid fixture");
  return result.block;
}
const message = (): Message => ({
  id: "message",
  role: "model",
  content: "",
  timestamp: 1,
  outputBlocks: [makeBlock()],
});
const currentBlock = () =>
  useChatStore.getState().activeMessages[0]!
    .outputBlocks![0] as IntelligentUiBlock;
function install(sessionId = "session") {
  const messages = [message()];
  useChatStore.setState({
    _hasHydrated: true,
    currentSessionId: sessionId,
    sessions: [
      {
        id: sessionId,
        title: "Session",
        model: "model",
        updatedAt: 1,
        messageCount: 1,
      },
    ],
    activeMessages: messages,
    activeMessageTree: normalizeSessionMessageTree(messages),
    isActiveSessionLoading: false,
  });
}
beforeEach(() => {
  useChatStore.getState().discardTemporarySession();
  stored.clear();
  vi.clearAllMocks();
  install();
  useSettingsStore.setState((state) => ({
    system: { ...state.system, enableIntelligentUi: true },
  }));
});

afterEach(cleanup);
function Harness({ sessionId = "session" }: { sessionId?: string }) {
  const block = useChatStore(
    (state) =>
      state.activeMessages.find((item) => item.id === "message")
        ?.outputBlocks?.[0],
  ) as IntelligentUiBlock | undefined;
  return block ? (
    <NextIntlClientProvider locale="en" messages={{ IntelligentUi: messages }}>
      <ConnectedIntelligentUiBlock
        sessionId={sessionId}
        messageId="message"
        block={block}
      />
    </NextIntlClientProvider>
  ) : null;
}
describe("Connected UI with authoritative conversation store", () => {
  it("saves real native interactions, preserves state through disable and restores without a host footer", async () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("checkbox", { name: "One" }));
    await waitFor(() => expect(currentBlock().state.checked).toEqual(["one"]));
    expect(appDb.setItem).toHaveBeenCalled();
    act(() =>
      useSettingsStore.setState((state) => ({
        system: { ...state.system, enableIntelligentUi: false },
      })),
    );
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(currentBlock().state.checked).toEqual(["one"]);
    act(() =>
      useSettingsStore.setState((state) => ({
        system: { ...state.system, enableIntelligentUi: true },
      })),
    );
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(
      true,
    );
    expect(screen.queryByRole("button", { name: "Reset" })).toBeNull();
    fireEvent.click(screen.getByRole("checkbox", { name: "One" }));
    await waitFor(() => expect(currentBlock().state.checked).toEqual([]));
  });
  it("disables interaction when active session changes and rejects direct stale writes", async () => {
    const block = currentBlock();
    render(<Harness />);
    act(() => useChatStore.setState({ currentSessionId: "different" }));
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(
      await useChatStore
        .getState()
        .updateIntelligentUiState("session", "message", block.id, 1, {
          checked: ["one"],
        }),
    ).toBe(false);
    expect(currentBlock().stateRevision).toBe(0);
  });
  it("keeps real temporary UI interaction out of the database", async () => {
    const sessionId = useChatStore.getState().createTemporarySession();
    await useChatStore.getState().addMessage(sessionId, message());
    appDb.setItem.mockClear();
    render(<Harness sessionId={sessionId} />);
    fireEvent.click(screen.getByRole("checkbox"));
    await waitFor(() => expect(currentBlock().state.checked).toEqual(["one"]));
    expect(appDb.setItem).not.toHaveBeenCalled();
    act(() => useChatStore.getState().discardTemporarySession());
    expect(screen.queryByRole("checkbox")).toBeNull();
  });
  it("preserves input through a subsequent streaming update", async () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("checkbox"));
    await waitFor(() => expect(currentBlock().stateRevision).toBe(1));
    act(() =>
      useChatStore
        .getState()
        .updateMessage("session", "message", { outputBlocks: [makeBlock()] }),
    );
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(
      true,
    );
  });
});
