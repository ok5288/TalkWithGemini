// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import ConnectedIntelligentUiBlock from "@/components/content/ConnectedIntelligentUiBlock";
import {
  UiChatContext,
  type UiChatSource,
} from "@/components/content/intelligentUi/UiChatContext";
import { normalizeSessionMessageTree } from "@/lib/chat/messageTree";
import type { IntelligentUiBlock } from "@/lib/intelligentUi/types";
import type { Message } from "@/types";
import messages from "@/i18n/locales/en/IntelligentUi.json";
import { useSettingsStore } from "@/store/core/settingsStore";

vi.mock("next/dynamic", async () => {
  const { HtmlUiFrame } =
    await import("@/components/content/intelligentUi/HtmlUiFrame");
  return { default: () => HtmlUiFrame };
});
vi.mock("@/store/storage/storageConfig", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/store/storage/storageConfig")>()),
  appDb: { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() },
  getAppDbStorage: () => ({
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
  }),
}));
const { useChatStore } = await import("@/store/core/chatStore");

const block: IntelligentUiBlock = {
  id: "html",
  type: "intelligent_ui",
  renderer: "html",
  schemaVersion: 1,
  definitionRevision: 1,
  stateRevision: 0,
  state: {},
  sourceRefs: [],
  fallbackMarkdown: "Form",
  staticSnapshot: "",
  status: "ready",
  definition: {
    version: 1,
    title: "Form",
    summary: "Input",
    html: "<p>Input</p>",
  },
};
type Port = {
  onmessage: ((event: { data: unknown }) => void) | null;
  postMessage: ReturnType<typeof vi.fn>;
  start: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
};
const ports: Port[] = [];
beforeEach(() => {
  ports.length = 0;
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
        ports.push(this.port1);
      }
    },
  );
  Object.defineProperty(navigator, "userActivation", {
    configurable: true,
    value: { isActive: true },
  });
  const items: Message[] = [
    {
      id: "message",
      role: "model",
      content: "",
      timestamp: 1,
      outputBlocks: [structuredClone(block)],
    },
  ];
  useChatStore.setState({
    _hasHydrated: true,
    currentSessionId: "session",
    pendingSessionId: null,
    isActiveSessionLoading: false,
    activeMessages: items,
    activeMessageTree: normalizeSessionMessageTree(items),
    sessions: [
      {
        id: "session",
        title: "Session",
        model: "model",
        updatedAt: 1,
        messageCount: 1,
      },
    ],
  });
  useSettingsStore.setState((state) => ({
    system: { ...state.system, enableIntelligentUi: true },
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
function start(frame: HTMLIFrameElement) {
  const post = vi
    .spyOn(frame.contentWindow!, "postMessage")
    .mockImplementation(() => {});
  fireEvent.load(frame);
  const identity = (post.mock.calls[0]![0] as { identity: string }).identity;
  const port = ports.at(-1)!;
  act(() => port.onmessage!({ data: { type: "connected", identity } }));
  act(() => port.onmessage!({ data: { type: "ready", identity } }));
  return { port, identity };
}
it.each(["error", "reload", "unmount", "retry"])(
  "permanently revokes a proposal's actual runtime after %s",
  async (reason) => {
    const sources: UiChatSource[] = [];
    const send = vi.fn((_text: string, source: UiChatSource) => {
      sources.push(source);
      return new Promise<never>(() => {});
    });
    const view = render(
      <NextIntlClientProvider
        locale="en"
        messages={{ IntelligentUi: messages }}
      >
        <UiChatContext.Provider value={send}>
          <ConnectedIntelligentUiBlock
            sessionId="session"
            messageId="message"
            block={block}
          />
        </UiChatContext.Provider>
      </NextIntlClientProvider>,
    );
    const frame = view.container.querySelector("iframe")!;
    const { port, identity } = start(frame);
    act(() =>
      port.onmessage!({
        data: {
          type: "send-message",
          identity,
          value: { requestId: "one", text: "Ask" },
        },
      }),
    );
    await waitFor(() => expect(sources).toHaveLength(1));
    expect(sources[0]!.isActive()).toBe(true);
    if (reason === "unmount") view.unmount();
    else if (reason === "reload") fireEvent.load(frame);
    else
      act(() =>
        port.onmessage!({
          data: { type: "error", identity, value: { code: "script_error" } },
        }),
      );
    expect(sources[0]!.isActive()).toBe(false);
    expect(port.close).toHaveBeenCalled();
    if (reason === "retry") {
      fireEvent.click(screen.getByRole("button", { name: messages.retry }));
      const replacement = start(view.container.querySelector("iframe")!);
      act(() =>
        replacement.port.onmessage!({
          data: {
            type: "send-message",
            identity: replacement.identity,
            value: { requestId: "two", text: "New request" },
          },
        }),
      );
      await waitFor(() => expect(sources).toHaveLength(2));
      expect(sources[1]!.isActive()).toBe(true);
      expect(sources[0]!.isActive()).toBe(false);
    }
  },
);
