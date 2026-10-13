// @vitest-environment jsdom
import React, { StrictMode } from "react";
import { IntelligentUiDisplayProvider } from "@/components/content/intelligentUi/IntelligentUiDisplayContext";
import IntelligentUiViewer from "@/components/content/intelligentUi/IntelligentUiViewer";
import { registerHtmlRuntimeFlusher } from "@/lib/intelligentUi/runtimeFlush";
import { EXPLORER_TRAVEL_EXAMPLE } from "@/lib/intelligentUi/explorer/example";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
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
vi.mock("next/dynamic", async () => {
  const { HtmlUiFrame } =
    await import("@/components/content/intelligentUi/HtmlUiFrame");
  return {
    default: (loader: () => unknown) =>
      String(loader).includes("HtmlUiFrame") ? HtmlUiFrame : () => null,
  };
});
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

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function Harness({ inline = true }: { inline?: boolean }) {
  const block = useChatStore(
    (state) => state.activeMessages[0]?.outputBlocks?.[0],
  ) as IntelligentUiBlock;
  return (
    <NextIntlClientProvider locale="en" messages={{ IntelligentUi: messages }}>
      <IntelligentUiDisplayProvider>
        {inline && block && (
          <ConnectedIntelligentUiBlock
            block={block}
            sessionId="session"
            messageId="message"
          />
        )}
        <IntelligentUiViewer onLocate={vi.fn()} />
      </IntelligentUiDisplayProvider>
    </NextIntlClientProvider>
  );
}
const open = () =>
  fireEvent.click(screen.getByRole("button", { name: "Open in viewer" }));
const close = () =>
  fireEvent.click(screen.getByRole("button", { name: "Close viewer" }));
it("moves a single native owner under StrictMode and restores persisted progress", async () => {
  render(
    <StrictMode>
      <Harness />
    </StrictMode>,
  );
  expect(screen.getAllByRole("checkbox")).toHaveLength(1);
  fireEvent.click(screen.getByRole("checkbox"));
  open();
  await screen.findByTestId("intelligent-ui-viewer");
  expect(screen.getAllByRole("checkbox")).toHaveLength(1);
  expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(true);
  expect(appDb.setItem).toHaveBeenCalled();
  close();
  await waitFor(() =>
    expect(screen.queryByTestId("intelligent-ui-viewer")).toBeNull(),
  );
  expect(screen.getAllByRole("checkbox")).toHaveLength(1);
  expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(true);
});
it("waits for the last runtime flush update before taking ownership", async () => {
  render(<Harness />);
  let finish!: () => void;
  const off = registerHtmlRuntimeFlusher(
    "session",
    () =>
      new Promise<void>((resolve) => {
        finish = () => {
          const block = currentBlock();
          void useChatStore
            .getState()
            .updateIntelligentUiState(
              "session",
              "message",
              block.id,
              block.definitionRevision,
              { checked: ["one"] },
              undefined,
              undefined,
              "coalesced",
            );
          resolve();
        };
      }),
  );
  open();
  expect(screen.queryByTestId("intelligent-ui-viewer")).toBeNull();
  expect(screen.getAllByRole("checkbox")).toHaveLength(1);
  await act(async () => {
    finish();
  });
  await screen.findByTestId("intelligent-ui-viewer");
  expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(true);
  expect(appDb.setItem).toHaveBeenCalled();
  off();
});
it("keeps the original owner on a flush failure and retries explicitly", async () => {
  render(<Harness />);
  const off = registerHtmlRuntimeFlusher("session", () =>
    Promise.reject(Error("save")),
  );
  open();
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toContain(
      "could not be saved",
    ),
  );
  expect(screen.queryByTestId("intelligent-ui-viewer")).toBeNull();
  expect(screen.getAllByRole("checkbox")).toHaveLength(1);
  fireEvent.click(screen.getByRole("checkbox"));
  expect(currentBlock().state.checked).toEqual(["one"]);
  off();
  open();
  await screen.findByTestId("intelligent-ui-viewer");
});
it("survives virtual row unmount and closes to no owner until the row returns", async () => {
  const view = render(<Harness />);
  open();
  await screen.findByTestId("intelligent-ui-viewer");
  view.rerender(<Harness inline={false} />);
  expect(screen.getAllByRole("checkbox")).toHaveLength(1);
  close();
  await waitFor(() =>
    expect(screen.queryByTestId("intelligent-ui-viewer")).toBeNull(),
  );
  expect(screen.queryByRole("checkbox")).toBeNull();
  view.rerender(<Harness />);
  expect(screen.getAllByRole("checkbox")).toHaveLength(1);
});
it("cancels a pending move when session authority changes, even after a late flush", async () => {
  render(<Harness />);
  let finish!: () => void;
  const off = registerHtmlRuntimeFlusher(
    "session",
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  open();
  act(() => useChatStore.setState({ currentSessionId: "other" }));
  await act(async () => {
    finish();
  });
  expect(screen.queryByTestId("intelligent-ui-viewer")).toBeNull();
  expect(screen.queryByRole("checkbox")).toBeNull();
  off();
});
it("blocks invalid import text until explicitly cancelled", async () => {
  const parsed = parseIntelligentUiText(
    "```intelligent-ui\n" + JSON.stringify(EXPLORER_TRAVEL_EXAMPLE) + "\n```",
    { idPrefix: "message", final: true },
  )[0];
  if (parsed.type !== "intelligent_ui") throw Error("fixture");
  const list: Message[] = [{ ...message(), outputBlocks: [parsed.block] }];
  useChatStore.setState({
    activeMessages: list,
    activeMessageTree: normalizeSessionMessageTree(list),
  });
  render(<Harness />);
  fireEvent.click(
    screen.getByRole("button", { name: messages.explorer.importData }),
  );
  fireEvent.change(
    screen.getByPlaceholderText(messages.explorer.importPlaceholder),
    { target: { value: "invalid" } },
  );
  open();
  expect(screen.queryByTestId("intelligent-ui-viewer")).toBeNull();
  expect(
    screen
      .getAllByRole("alert")
      .some((item) => item.textContent?.includes("Confirm or cancel")),
  ).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Cancel import" }));
  open();
  await screen.findByTestId("intelligent-ui-viewer");
});

it("releases the real HTML transport before the viewer starts and resumes the flushed SDK state", async () => {
  type Port = {
    onmessage: ((event: { data: unknown }) => void) | null;
    postMessage: ReturnType<typeof vi.fn>;
    start: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
  };
  const ports: Port[] = [];
  let live = 0,
    maximum = 0;
  vi.stubGlobal(
    "MessageChannel",
    class {
      port1: Port = {
        onmessage: null,
        postMessage: vi.fn(),
        start: vi.fn(),
        close: vi.fn(),
      };
      port2 = {};
      constructor() {
        live++;
        maximum = Math.max(maximum, live);
        let closed = false;
        this.port1.close.mockImplementation(() => {
          if (!closed) {
            closed = true;
            live--;
          }
        });
        this.port1.postMessage.mockImplementation((payload) => {
          if (payload.type === "flush-updates") {
            this.port1.onmessage?.({
              data: {
                type: "state",
                identity: payload.identity,
                value: { count: 42 },
              },
            });
            this.port1.onmessage?.({
              data: {
                type: "updates-flushed",
                identity: payload.identity,
                value: { requestId: payload.value.requestId },
              },
            });
          }
        });
        ports.push(this.port1);
      }
    },
  );
  const parsed = parseIntelligentUiText(
    '```intelligent-ui\n{"version":1,"title":"Simulation","summary":"Counter","html":"<button>Count</button>"}\n```',
    { idPrefix: "message", final: true },
  )[0];
  if (parsed.type !== "intelligent_ui") throw Error("fixture");
  const list: Message[] = [{ ...message(), outputBlocks: [parsed.block] }];
  useChatStore.setState({
    activeMessages: list,
    activeMessageTree: normalizeSessionMessageTree(list),
  });
  const view = render(
    <StrictMode>
      <Harness />
    </StrictMode>,
  );
  const connect = () => {
    const frame = view.container.querySelector("iframe")!;
    const post = vi
      .spyOn(frame.contentWindow!, "postMessage")
      .mockImplementation(() => {});
    fireEvent.load(frame);
    const identity = (post.mock.calls[0][0] as { identity: string }).identity;
    const port = ports[ports.length - 1];
    act(() => {
      port.onmessage?.({ data: { type: "connected", identity } });
      port.onmessage?.({ data: { type: "ready", identity } });
    });
    return port;
  };
  const original = connect();
  open();
  await screen.findByTestId("intelligent-ui-viewer");
  expect(original.close).toHaveBeenCalled();
  expect(live).toBe(0);
  expect(currentBlock().state).toEqual({ count: 42 });
  const next = connect();
  expect(next.postMessage).toHaveBeenCalledWith(
    expect.objectContaining({ state: { count: 42 } }),
  );
  expect(maximum).toBe(1);
  expect(view.container.querySelectorAll("iframe")).toHaveLength(1);
  act(() => useChatStore.setState({ currentSessionId: "other" }));
  expect(live).toBe(0);
  expect(screen.queryByTestId("intelligent-ui-viewer")).toBeNull();
});

it("closes a common-ancestor viewer on a suffix branch replacement but accepts appends", async () => {
  const view = render(<Harness />);
  open();
  await screen.findByTestId("intelligent-ui-viewer");
  const prefix = useChatStore.getState().activeMessages;
  act(() =>
    useChatStore.setState({
      activeMessages: [
        ...prefix,
        { id: "left", role: "user", content: "Branch", timestamp: 2 },
      ],
    }),
  );
  expect(screen.getByTestId("intelligent-ui-viewer")).toBeTruthy();
  act(() =>
    useChatStore.setState({
      activeMessages: [
        ...prefix,
        { id: "right", role: "user", content: "Other branch", timestamp: 2 },
      ],
    }),
  );
  expect(screen.queryByTestId("intelligent-ui-viewer")).toBeNull();
  expect(
    view.container.querySelectorAll('input[type="checkbox"]'),
  ).toHaveLength(1);
});
