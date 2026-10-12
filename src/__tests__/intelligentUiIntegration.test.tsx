// @vitest-environment jsdom
import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import MessageInput from "@/components/chat/MessageInput";
import MessageOutputRenderer from "@/components/content/MessageOutputRenderer";
import { requestComposerDraft } from "@/lib/chat/composerActions";
import { clearComposerDraft } from "@/lib/chat/composerDrafts";
import { parseIntelligentUiText } from "@/lib/intelligentUi/parser";
import { projectUiBlock } from "@/lib/intelligentUi/projection";
import { useChatStore } from "@/store/core/chatStore";
import type { Message, Session } from "@/types";
import type { IntelligentUiBlock } from "@/lib/intelligentUi/types";
import configMessages from "@/i18n/locales/en/Config.json";
import messageInputMessages from "@/i18n/locales/en/MessageInput.json";
import contentMessages from "@/i18n/locales/en/Content.json";
import messageMessages from "@/i18n/locales/en/Message.json";

// Keep the boundary observable without loading the separate sandbox/runtime unit.
vi.mock("next/dynamic", () => ({
  default: (loader: () => unknown) =>
    String(loader).includes("ConnectedIntelligentUiBlock")
      ? ({
          sessionId,
          messageId,
          mode,
          block,
        }: {
          sessionId: string;
          messageId: string;
          mode?: "interactive" | "static-original" | "static-current";
          block: IntelligentUiBlock;
        }) =>
          mode === "interactive" ? (
            <div
              data-testid="interactive-runtime"
              data-session={sessionId}
              data-message={messageId}
            />
          ) : (
            <article data-testid="static-output">
              {projectUiBlock(block, { purpose: mode ?? "static-original" })}
            </article>
          )
      : () => null,
}));
vi.mock("@/components/content/MarkdownRenderer", () => ({
  default: ({ content }: { content: string }) => (
    <article data-testid="static-output">{content}</article>
  ),
}));
const session: Session = {
  id: "integration-session",
  title: "Chat",
  model: "provider:model",
  messageCount: 0,
  updatedAt: 1,
};
function provider(children: React.ReactNode) {
  return (
    <NextIntlClientProvider
      locale="en"
      messages={{
        Config: configMessages,
        MessageInput: messageInputMessages,
        Content: contentMessages,
        Message: messageMessages,
      }}
    >
      {children}
    </NextIntlClientProvider>
  );
}
function uiMessage(): Message {
  const content =
    "```intelligent-ui\n" +
    JSON.stringify({
      version: 1,
      kind: "form",
      title: "Learning plan",
      summary: "Choose your goal",
      props: { fields: [{ id: "goal", label: "Goal", type: "text" }] },
    }) +
    "\n```";
  const segment = parseIntelligentUiText(content, { final: true })[0]!;
  if (segment.type !== "intelligent_ui") throw new Error("UI fixture missing");
  segment.block.state = {
    values: { goal: "PRIVATE USER INPUT" },
    hidden: "HIDDEN PRIVATE FIELD",
  };
  return {
    id: "integration-message",
    role: "model",
    content,
    timestamp: 1,
    outputBlocks: [segment.block],
  };
}
beforeEach(() => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: false })),
  );
  clearComposerDraft(session.id);
  useChatStore.setState({
    currentSessionId: session.id,
    sessions: [session],
    activeMessages: [],
  });
});
afterEach(() => {
  cleanup();
  clearComposerDraft(session.id);
  useChatStore.setState({
    currentSessionId: null,
    sessions: [],
    activeMessages: [],
  });
  vi.unstubAllGlobals();
});
describe("Intelligent UI composer integration", () => {
  it("appends to the current draft, focuses it, rejects another session, and never sends", () => {
    const onSend = vi.fn();
    render(
      provider(
        <MessageInput
          onSend={onSend}
          disabled={false}
          selectedModel="provider:model"
        />,
      ),
    );
    const input = screen.getByRole("textbox", {
      name: "Message",
    }) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "Existing draft" } });
    act(() =>
      requestComposerDraft({
        sessionId: "other-session",
        text: "WRONG SESSION",
      }),
    );
    expect(input.value).toBe("Existing draft");
    act(() =>
      requestComposerDraft({ sessionId: session.id, text: "Selected result" }),
    );
    expect(input.value).toBe("Existing draft\n\nSelected result");
    expect(document.activeElement).toBe(input);
    expect(onSend).not.toHaveBeenCalled();
  });
  it("stages only an attachment reference until the user sends", () => {
    const onSend = vi.fn();
    render(
      provider(
        <MessageInput
          onSend={onSend}
          disabled={false}
          selectedModel="provider:model"
        />,
      ),
    );
    act(() =>
      requestComposerDraft({
        sessionId: session.id,
        text: "Explain report version 2",
        attachments: [
          {
            id: "report-2",
            mimeType: "text/markdown",
            fileName: "report-v2.md",
            url: "opfs://chat/research-artifacts/report.md",
          },
        ],
      }),
    );
    expect(
      (screen.getByRole("textbox", { name: "Message" }) as HTMLTextAreaElement)
        .value,
    ).toBe("Explain report version 2");
    expect(screen.getByText("report-v2.md")).toBeTruthy();
    expect(onSend).not.toHaveBeenCalled();
  });
  it("sends edited UI draft text with its source identity only on manual send", async () => {
    const onSend = vi.fn(async () => true);
    const cancel = vi.fn();
    render(
      provider(
        <MessageInput
          onSend={onSend}
          disabled={false}
          selectedModel="provider:model"
        />,
      ),
    );
    const input = screen.getByRole("textbox", {
      name: "Message",
    }) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "Existing draft" } });
    act(() =>
      requestComposerDraft({
        sessionId: session.id,
        text: "Explain the result",
        intelligentUiSend: { id: "ui-request", cancel },
      }),
    );
    expect(input.value).toBe("Existing draft\n\nExplain the result");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onSend).not.toHaveBeenCalled();
    fireEvent.change(input, {
      target: { value: "Explain the result in more detail" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await waitFor(() => expect(input.value).toBe(""));
    expect(onSend).toHaveBeenCalledExactlyOnceWith(
      "Explain the result in more detail",
      [],
      undefined,
      undefined,
      { skillIds: [], pluginIds: [] },
      "ui-request",
    );
    expect(cancel).not.toHaveBeenCalled();
  });
  it("retains an unaccepted draft and its attachments for an explicit retry", async () => {
    const onSend = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true);
    render(
      provider(
        <MessageInput
          onSend={onSend}
          disabled={false}
          selectedModel="provider:model"
        />,
      ),
    );
    const attachment = {
      id: "report",
      mimeType: "text/markdown",
      fileName: "report.md",
      url: "data:text/markdown,Report",
    };
    act(() =>
      requestComposerDraft({
        sessionId: session.id,
        text: "Explain the result",
        attachments: [attachment],
        intelligentUiSend: { id: "ui-request", cancel: vi.fn() },
      }),
    );
    const input = screen.getByRole("textbox", {
      name: "Message",
    }) as HTMLTextAreaElement;
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    });
    expect(input.value).toBe("Explain the result");
    expect(screen.getByText("report.md")).toBeTruthy();
    expect(onSend.mock.lastCall?.[1]).toEqual([attachment]);
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await waitFor(() => expect(input.value).toBe(""));
    expect(onSend).toHaveBeenCalledTimes(2);
    expect(onSend.mock.lastCall?.[5]).toBe("ui-request");
  });
  it("cancels UI requests when the draft is cleared, replaced or unmounted", () => {
    const cancel = vi.fn();
    const onSend = vi.fn();
    const { unmount } = render(
      provider(
        <MessageInput
          onSend={onSend}
          disabled={false}
          selectedModel="provider:model"
        />,
      ),
    );
    const stage = () =>
      act(() =>
        requestComposerDraft({
          sessionId: session.id,
          text: "Explain the result",
          intelligentUiSend: { id: "ui-request", cancel },
        }),
      );
    stage();
    fireEvent.change(screen.getByRole("textbox", { name: "Message" }), {
      target: { value: "" },
    });
    expect(cancel).toHaveBeenCalledTimes(1);
    stage();
    act(() =>
      requestComposerDraft({ sessionId: session.id, text: "Another draft" }),
    );
    expect(cancel).toHaveBeenCalledTimes(2);
    stage();
    unmount();
    expect(cancel).toHaveBeenCalledTimes(3);
    expect(onSend).not.toHaveBeenCalled();
  });
  it("cancels the UI request when switching conversations", () => {
    const cancel = vi.fn();
    render(
      provider(
        <MessageInput
          onSend={vi.fn()}
          disabled={false}
          selectedModel="provider:model"
        />,
      ),
    );
    act(() =>
      requestComposerDraft({
        sessionId: session.id,
        text: "Explain the result",
        intelligentUiSend: { id: "ui-request", cancel },
      }),
    );
    act(() => {
      useChatStore.setState({ currentSessionId: "another-session" });
    });
    expect(cancel).toHaveBeenCalledOnce();
    expect(
      (screen.getByRole("textbox", { name: "Message" }) as HTMLTextAreaElement)
        .value,
    ).toBe("");
  });
});
describe("Intelligent UI renderer/export integration", () => {
  it("defaults to original static output and includes only visible private state on explicit opt-in", () => {
    const message = uiMessage();
    const view = (includeIntelligentUiState = false) =>
      provider(
        <MessageOutputRenderer
          message={message}
          displayedContent={message.content}
          searchSources={[]}
          sessionId={session.id}
          intelligentUiMode={
            includeIntelligentUiState ? "static-current" : "static-original"
          }
          readOnly
        />,
      );
    const { rerender } = render(view());
    expect(screen.getByTestId("static-output").textContent).toContain(
      "Learning plan",
    );
    expect(screen.getByTestId("static-output").textContent).not.toContain(
      "PRIVATE",
    );
    expect(screen.queryByTestId("interactive-runtime")).toBeNull();
    rerender(view(true));
    expect(screen.getByTestId("static-output").textContent).toContain(
      "PRIVATE USER INPUT",
    );
    expect(screen.getByTestId("static-output").textContent).not.toContain(
      "HIDDEN",
    );
    expect(screen.queryByTestId("interactive-runtime")).toBeNull();
  });
  it("mounts interactive runtime only for explicit model-chat rendering with a session", () => {
    const message = uiMessage();
    const view = (props: {
      intelligentUiMode?: "interactive" | "static-original" | "static-current";
      sessionId?: string;
      readOnly?: boolean;
      message?: Message;
    }) =>
      provider(
        <MessageOutputRenderer
          message={message}
          displayedContent={message.content}
          searchSources={[]}
          {...props}
        />,
      );
    const { rerender } = render(view({ sessionId: session.id }));
    expect(screen.queryByTestId("interactive-runtime")).toBeNull();
    rerender(view({ intelligentUiMode: "interactive" }));
    expect(screen.queryByTestId("interactive-runtime")).toBeNull();
    rerender(view({ intelligentUiMode: "interactive", sessionId: session.id }));
    expect(screen.getByTestId("interactive-runtime").dataset.session).toBe(
      session.id,
    );
    expect(screen.getByTestId("interactive-runtime").dataset.message).toBe(
      message.id,
    );
    rerender(
      view({
        intelligentUiMode: "interactive",
        sessionId: session.id,
        message: { ...message, role: "user" },
      }),
    );
    expect(screen.queryByTestId("interactive-runtime")).toBeNull();
  });
  it("explicit main-chat rendering supports temporary-session readOnly storage semantics", () => {
    const message = uiMessage();
    render(
      provider(
        <MessageOutputRenderer
          message={message}
          displayedContent={message.content}
          searchSources={[]}
          intelligentUiMode="interactive"
          sessionId={session.id}
          readOnly
        />,
      ),
    );
    expect(screen.getByTestId("interactive-runtime")).toBeTruthy();
    expect(screen.queryByTestId("static-output")).toBeNull();
  });
});
