// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import VirtualizedMessageTimeline from "@/components/chat/VirtualizedMessageTimeline";

const mocks = vi.hoisted(() => {
  const state = { system: { chatLayout: "document", enableAutoScroll: false } };
  const virtualizer = {
    getVirtualItems: () => [
      { index: 0, start: 0, end: 200 },
      { index: 1, start: 200, end: 600 },
    ],
    getTotalSize: () => 1200,
    getOffsetForIndex: vi.fn(() => [240, "start"]),
    measureElement: vi.fn(),
    measure: vi.fn(),
    scrollToOffset: vi.fn(),
    scrollToIndex: vi.fn(),
    scrollOffset: 0,
    scrollRect: { height: 400 },
    shouldAdjustScrollPositionOnItemSizeChange: undefined as unknown,
  };
  return { state, virtualizer };
});
vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: () => mocks.virtualizer,
}));
vi.mock("@/store/core/settingsStore", () => ({
  useSettingsStore: (select: (state: typeof mocks.state) => unknown) =>
    select(mocks.state),
}));
vi.mock("@/components/chat/MessageItem", () => ({
  default: ({
    message,
    chatLayout,
  }: {
    message: { id: string };
    chatLayout: string;
  }) => <div data-testid={message.id} data-layout={chatLayout} />,
}));
vi.mock("@/components/assistant/AssistantHeader", () => ({
  default: () => null,
}));
vi.mock("@/components/chat/FollowUpQuestions", () => ({ default: () => null }));
vi.mock("@/lib/chat/messageTree", () => ({
  getMessageBranchInfo: () => undefined,
  getMessageBranchOptions: () => [],
}));

function props(
  scrollElement: HTMLDivElement,
): React.ComponentProps<typeof VirtualizedMessageTimeline> {
  return {
    scrollElement,
    messages: [
      { id: "user", role: "user", content: "Question", timestamp: 1 },
      { id: "model", role: "model", content: "Answer", timestamp: 2 },
    ],
    activeMessageTree: {} as React.ComponentProps<
      typeof VirtualizedMessageTimeline
    >["activeMessageTree"],
    isGenerating: false,
    actionsDisabled: false,
    mutationsDisabled: false,
    toolActionsDisabled: false,
    availableModels: [],
    onUpdateInstruction: vi.fn(),
    onEdit: vi.fn(),
    onDelete: vi.fn(),
    onSubmitUserEdit: vi.fn(),
    onRetract: vi.fn(),
    onRegenerate: vi.fn(),
    onContinue: vi.fn(),
    onReply: vi.fn(),
    onNavigateToMessage: vi.fn(),
    onVersionChange: vi.fn(),
    onVersionSelect: vi.fn(),
    onSuggestionClick: vi.fn(),
    onToolConfirmationDecision: vi.fn(),
    onRevokeToolSessionApproval: vi.fn(),
  };
}
beforeEach(() => {
  mocks.state.system.chatLayout = "document";
  vi.clearAllMocks();
});
afterEach(cleanup);
function viewport(top: number) {
  const el = document.createElement("div");
  Object.defineProperties(el, {
    clientHeight: { value: 400 },
    scrollHeight: { value: 1000 },
  });
  el.scrollTop = top;
  return el;
}
describe("chat layout timeline", () => {
  it("passes the selected layout to every message and remeasures while preserving the visible offset", () => {
    const input = props(viewport(300));
    const { rerender } = render(<VirtualizedMessageTimeline {...input} />);
    expect(screen.getByTestId("user").getAttribute("data-layout")).toBe(
      "document",
    );
    mocks.state.system.chatLayout = "conversation";
    rerender(<VirtualizedMessageTimeline {...input} />);
    expect(screen.getByTestId("user").getAttribute("data-layout")).toBe(
      "conversation",
    );
    expect(screen.getByTestId("model").getAttribute("data-layout")).toBe(
      "conversation",
    );
    expect(
      screen.getByTestId("virtualized-message-timeline").className,
    ).toContain("max-w-4xl");
    expect(mocks.virtualizer.measure).toHaveBeenCalledTimes(1);
    expect(mocks.virtualizer.getOffsetForIndex).toHaveBeenCalledWith(
      1,
      "start",
    );
    expect(mocks.virtualizer.scrollToOffset).toHaveBeenLastCalledWith(340, {
      behavior: "auto",
    });
    rerender(<VirtualizedMessageTimeline {...input} />);
    expect(mocks.virtualizer.measure).toHaveBeenCalledTimes(1);
  });
  it("keeps an already bottom-anchored viewport at the new bottom even when auto-scroll is disabled", () => {
    const input = props(viewport(600));
    const { rerender } = render(<VirtualizedMessageTimeline {...input} />);
    mocks.state.system.chatLayout = "conversation";
    rerender(<VirtualizedMessageTimeline {...input} />);
    expect(mocks.virtualizer.scrollToOffset).toHaveBeenLastCalledWith(800, {
      behavior: "auto",
    });
    mocks.state.system.chatLayout = "document";
    rerender(<VirtualizedMessageTimeline {...input} />);
    expect(
      screen.getByTestId("virtualized-message-timeline").className,
    ).toContain("max-w-3xl");
  });
});
