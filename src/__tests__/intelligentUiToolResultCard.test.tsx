// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { Message, ToolCall } from "@/types";
import { normalizeSessionMessageTree } from "@/lib/chat/messageTree";
import { getMessageOutputBlocks } from "@/lib/chat/messageOutputBlocks";
import { COMPOSER_DRAFT_EVENT } from "@/lib/chat/composerActions";
import * as drafts from "@/lib/intelligentUi/toolResults/draft";
import { captureToolResultView } from "@/lib/intelligentUi/toolResults/adapters";
import ToolResultUi from "@/components/content/intelligentUi/ToolResultUi";
import ToolCallBlock from "@/components/content/ToolCallBlock";
import { useChatStore } from "@/store/core/chatStore";
import { useSettingsStore } from "@/store/core/settingsStore";

vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${Object.values(values).join(",")}` : key,
}));
vi.mock("@/store/storage/storageConfig", async (original) => ({
  ...(await original<typeof import("@/store/storage/storageConfig")>()),
  appDb: {
    getItem: async () => null,
    setItem: async () => undefined,
    removeItem: async () => undefined,
  },
  getAppDbStorage: () => ({
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
  }),
}));
vi.mock("@/services/agent/runtime", () => ({
  getAgentRunPersistence: () => ({
    get: async () => null,
    list: async () => [],
    readDraftHistory: async () => ({ runs: [], hasEvidence: false }),
    getStatus: () => ({ durable: true }),
  }),
}));
afterEach(cleanup);
beforeEach(() => {
  useSettingsStore.setState((s) => ({
    system: { ...s.system, enableIntelligentUi: true },
  }));
});
async function fixture() {
  const call: ToolCall = {
    id: "call",
    name: "web_search",
    args: {},
    status: "success",
    executionRecordId: "source-exec",
    functionFingerprint: "fp",
    result: {
      ok: true,
      trust: "external_untrusted",
      provenance: { origin: "builtin", toolName: "web_search" },
      data: {
        sources: [
          {
            title: "One",
            url: "https://example.com/one",
            snippet: "<script>window.HACKED=true</script>",
          },
          { title: "Two", url: "https://example.com/two" },
        ],
      },
    },
  };
  call.intelligentUiResult = await captureToolResultView({
    callId: call.id,
    toolName: call.name,
    executionId: call.executionRecordId,
    definitionFingerprint: call.functionFingerprint,
    result: call.result,
    retrievedAt: 1,
  });
  const activeMessages: Message[] = [
    {
      id: "message",
      role: "model",
      content: "",
      timestamp: 1,
      outputBlocks: [{ id: "tools", type: "tool_group", toolCalls: [call] }],
    },
  ];
  useChatStore.setState((s) => ({
    currentSessionId: "session",
    sessions: [
      { id: "session", title: "S", updatedAt: 1, model: "m", messageCount: 1 },
    ],
    chatConfig: { ...s.chatConfig, chatMode: "agent" },
    activeMessages,
    activeMessageTree: normalizeSessionMessageTree(activeMessages),
    isActiveSessionLoading: false,
    pendingSessionId: null,
  }));
  return call;
}
describe("tool result card integration", () => {
  it("renders the registered native explorer inside the existing tool card", async () => {
    const call = await fixture();
    render(
      <ToolCallBlock
        toolCalls={[call]}
        sessionId="session"
        messageId="message"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /usedTools/ }));
    await screen.findByRole("table");
    expect(screen.getByText("One")).toBeTruthy();
    expect(document.querySelector("script")).toBeNull();
  });
  it("selection survives transcript call clones and prepares a reviewable selected-only draft", async () => {
    const call = await fixture();
    const rendered = render(
      <ToolResultUi
        call={{ ...call }}
        sessionId="session"
        messageId="message"
      />,
    );
    fireEvent.click(
      await screen.findByRole("checkbox", {
        name: "explorer.selectRowNamed:source-1",
      }),
    );
    rendered.rerender(
      <ToolResultUi
        call={{ ...call }}
        sessionId="session"
        messageId="message"
      />,
    );
    expect(
      (
        screen.getByRole("checkbox", {
          name: "explorer.selectRowNamed:source-1",
        }) as HTMLInputElement
      ).checked,
    ).toBe(true);
    fireEvent.click(
      screen.getByRole("button", { name: "toolResult.saveDraft" }),
    );
    const review = await screen.findByRole("group", {
      name: "toolResult.previewDraft",
    });
    expect(review.textContent).toContain("https://example.com/one");
    expect(review.textContent).not.toContain("https://example.com/two");
    fireEvent.click(screen.getByRole("button", { name: "toolResult.cancel" }));
    expect(
      screen.queryByRole("group", { name: "toolResult.previewDraft" }),
    ).toBeNull();
  });
  it("switches to a noninteractive table when disabled or in read-only views", async () => {
    const call = await fixture();
    const rendered = render(
      <ToolResultUi call={call} sessionId="session" messageId="message" />,
    );
    await screen.findByRole("table");
    act(() =>
      useSettingsStore.setState((s) => ({
        system: { ...s.system, enableIntelligentUi: false },
      })),
    );
    await waitFor(() => expect(screen.queryByRole("checkbox")).toBeNull());
    expect(screen.getByRole("table")).toBeTruthy();
    act(() =>
      useSettingsStore.setState((s) => ({
        system: { ...s.system, enableIntelligentUi: true },
      })),
    );
    rendered.rerender(<ToolResultUi call={call} readOnly />);
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "toolResult.saveDraft" }),
      ).toBeNull(),
    );
  });
  it("invalidates confirmation when session or result changes", async () => {
    const call = await fixture();
    const rendered = render(
      <ToolResultUi call={call} sessionId="session" messageId="message" />,
    );
    fireEvent.click(
      await screen.findByRole("checkbox", {
        name: "explorer.selectRowNamed:source-1",
      }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "toolResult.saveDraft" }),
    );
    await screen.findByRole("group", { name: "toolResult.previewDraft" });
    act(() => useChatStore.setState({ currentSessionId: "other" }));
    await waitFor(() =>
      expect(
        screen.queryByRole("group", { name: "toolResult.previewDraft" }),
      ).toBeNull(),
    );
    rendered.rerender(
      <ToolResultUi
        call={{ ...call, result: {} }}
        sessionId="session"
        messageId="message"
      />,
    );
    await waitFor(() => expect(screen.queryByRole("table")).toBeNull());
  });
  it("restores selection after virtualization from the real store and stages refresh without invoking tools", async () => {
    const call = await fixture();
    call.args = { query: "travel options", authorization: "never-copy" };
    const first = render(
      <ToolResultUi call={call} sessionId="session" messageId="message" />,
    );
    fireEvent.click(
      await screen.findByRole("checkbox", {
        name: "explorer.selectRowNamed:source-1",
      }),
    );
    await waitFor(() => {
      const block = useChatStore.getState().activeMessages[0].outputBlocks![0];
      expect(
        block.type === "tool_group" &&
          block.toolCalls[0].intelligentUiState?.selected,
      ).toEqual(["source-1"]);
    });
    first.unmount();
    const block = useChatStore.getState().activeMessages[0].outputBlocks![0];
    if (block.type !== "tool_group") throw Error("Missing tool block");
    render(
      <ToolResultUi
        call={block.toolCalls[0]}
        sessionId="session"
        messageId="message"
      />,
    );
    expect(
      (
        (await screen.findByRole("checkbox", {
          name: "explorer.selectRowNamed:source-1",
        })) as HTMLInputElement
      ).checked,
    ).toBe(true);
    const listener = vi.fn();
    window.addEventListener(COMPOSER_DRAFT_EVENT, listener);
    try {
      fireEvent.click(
        screen.getByRole("button", { name: "toolResult.refreshInChat" }),
      );
      const draft = (listener.mock.calls[0][0] as CustomEvent).detail;
      expect(draft.sessionId).toBe("session");
      expect(draft.text).toContain("travel options");
      expect(draft.text).not.toContain("never-copy");
    } finally {
      window.removeEventListener(COMPOSER_DRAFT_EVENT, listener);
    }
  });
  it("keeps selection and the reviewed proposal when later streaming updates clone the tool block", async () => {
    const call = await fixture();
    const rendered = render(
      <ToolResultUi call={call} sessionId="session" messageId="message" />,
    );
    fireEvent.click(
      await screen.findByRole("checkbox", {
        name: "explorer.selectRowNamed:source-1",
      }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "toolResult.saveDraft" }),
    );
    await screen.findByRole("group", { name: "toolResult.previewDraft" });
    act(() => {
      useChatStore
        .getState()
        .updateMessageContent("session", "message", "later text", undefined, [
          { id: "tools", type: "tool_group", toolCalls: [call] },
          { id: "text", type: "text", content: "later text" },
        ]);
      useChatStore
        .getState()
        .updateMessage("session", "message", { toolCalls: [call] });
    });
    const message = useChatStore.getState().activeMessages[0];
    const projected = getMessageOutputBlocks(message).find(
      (block) => block.type === "tool_group",
    );
    if (projected?.type !== "tool_group") throw Error("Missing tools");
    expect(projected.toolCalls[0].intelligentUiState?.selected).toEqual([
      "source-1",
    ]);
    expect(message.toolCalls?.[0].intelligentUiState?.selected).toEqual([
      "source-1",
    ]);
    rendered.rerender(
      <ToolResultUi
        call={projected.toolCalls[0]}
        sessionId="session"
        messageId="message"
      />,
    );
    expect(
      screen.getByRole("group", { name: "toolResult.previewDraft" }),
    ).toBeTruthy();
    expect(
      (
        screen.getByRole("checkbox", {
          name: "explorer.selectRowNamed:source-1",
        }) as HTMLInputElement
      ).checked,
    ).toBe(true);
  });
  it("revokes an in-flight confirmation when its view unmounts", async () => {
    const call = await fixture();
    let context: drafts.ToolDraftContext | undefined;
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const commit = vi
      .spyOn(drafts, "commitToolDraft")
      .mockImplementation(async (_proposal, current) => {
        context = current;
        await pending;
        return { status: "denied" };
      });
    try {
      const rendered = render(
        <ToolResultUi call={call} sessionId="session" messageId="message" />,
      );
      fireEvent.click(
        await screen.findByRole("checkbox", {
          name: "explorer.selectRowNamed:source-1",
        }),
      );
      fireEvent.click(
        screen.getByRole("button", { name: "toolResult.saveDraft" }),
      );
      fireEvent.click(
        await screen.findByRole("button", { name: "toolResult.confirmDraft" }),
      );
      expect(context?.authorized()).toBe(true);
      rendered.unmount();
      expect(context?.authorized()).toBe(false);
      await act(async () => {
        release();
        await pending;
      });
    } finally {
      commit.mockRestore();
    }
  });
  it("requires an explicit new preview after a safe failure", async () => {
    const call = await fixture();
    const commit = vi
      .spyOn(drafts, "commitToolDraft")
      .mockResolvedValue({ status: "failed", retryable: true });
    const prepare = vi.spyOn(drafts, "prepareToolDraft");
    try {
      render(
        <ToolResultUi call={call} sessionId="session" messageId="message" />,
      );
      fireEvent.click(
        await screen.findByRole("checkbox", {
          name: "explorer.selectRowNamed:source-1",
        }),
      );
      fireEvent.click(
        screen.getByRole("button", { name: "toolResult.saveDraft" }),
      );
      fireEvent.click(
        await screen.findByRole("button", { name: "toolResult.confirmDraft" }),
      );
      const retry = await screen.findByRole("button", {
        name: "toolResult.retryDraft",
      });
      expect(
        screen.queryByRole("group", { name: "toolResult.previewDraft" }),
      ).toBeNull();
      expect(commit).toHaveBeenCalledTimes(1);
      fireEvent.click(retry);
      await screen.findByRole("group", { name: "toolResult.previewDraft" });
      expect(prepare).toHaveBeenLastCalledWith(
        expect.objectContaining({ retry: true }),
      );
      expect(commit).toHaveBeenCalledTimes(1);
      fireEvent.click(
        screen.getByRole("button", { name: "toolResult.confirmDraft" }),
      );
      await waitFor(() => expect(commit).toHaveBeenCalledTimes(2));
    } finally {
      commit.mockRestore();
      prepare.mockRestore();
    }
  });
});
