// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import MessageItem from "@/components/chat/MessageItem";
import messages from "@/i18n/locales/en";
import { DEFAULT_SYSTEM_SETTINGS } from "@/config/defaults";

vi.mock("@/store/core/chatStore", () => ({
  useChatStore: () => ({
    getCurrentSession: () => undefined,
    selectedModel: "test",
    activeMessages: [],
    updateMessage: vi.fn(),
  }),
}));
vi.mock("@/store/core/uiStore", () => ({
  useUIStore: () => ({ openImagePreview: vi.fn() }),
}));
vi.mock("@/store/core/settingsStore", () => ({
  useSettingsStore: (select?: (state: unknown) => unknown) => {
    const state = {
      voice: {},
      system: { ...DEFAULT_SYSTEM_SETTINGS, chatLayout: "conversation" },
    };
    return select ? select(state) : state;
  },
}));
vi.mock("@/components/content/MessageOutputRenderer", () => ({
  default: ({ displayedContent }: { displayedContent: string }) => (
    <div>{displayedContent}</div>
  ),
}));
vi.mock("@/components/content/Artifact", () => ({
  default: ({ initialContent }: { initialContent: string }) => (
    <textarea aria-label="Artifact editor" defaultValue={initialContent} />
  ),
}));
vi.mock("@/services/api/voiceService", () => ({ synthesizeSpeech: vi.fn() }));
afterEach(cleanup);
function item(
  role: "user" | "model",
  chatLayout?: "document" | "conversation",
) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <MessageItem
        message={{
          id: "message",
          role,
          content: "Long content " + "x".repeat(300),
          timestamp: 1,
        }}
        chatLayout={chatLayout}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        isLast
      />
    </NextIntlClientProvider>,
  );
}
describe("message layout boundaries", () => {
  it.each(["user", "model"] as const)(
    "marks the %s bubble for role-specific alignment",
    (role) => {
      const { container } = item(role, "conversation");
      const bubble = container.querySelector(".message-item")!;
      expect(bubble.getAttribute("data-chat-layout")).toBe("conversation");
      expect(bubble.getAttribute("data-message-role")).toBe(role);
      expect(
        bubble.querySelector(".message-item-content")?.className,
      ).toContain("min-w-0");
      expect(bubble.querySelector(".message-item-toolbar")).not.toBeNull();
    },
  );
  it("defaults standalone messages to document even when conversation is the stored preference", () => {
    const { container } = item("model");
    expect(
      container
        .querySelector(".message-item")
        ?.getAttribute("data-chat-layout"),
    ).toBe("document");
  });
  it("keeps AI editing in the selected bubble with room for the editor", () => {
    const { container } = item("model", "conversation");
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(
      screen.getByRole("textbox", { name: "Artifact editor" }),
    ).toBeTruthy();
    expect(
      container.querySelector(".message-item")?.getAttribute("data-editing"),
    ).toBe("true");
    expect(
      container
        .querySelector(".message-item")
        ?.getAttribute("data-chat-layout"),
    ).toBe("conversation");
  });
});
