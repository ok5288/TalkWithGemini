// @vitest-environment jsdom

import React from "react";
import userEvent from "@testing-library/user-event";
import { render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Message, Session } from "@/types";
import messages from "@/i18n/locales/en";
import { DEFAULT_SYSTEM_SETTINGS } from "@/config/defaults";

const { getCurrentSession, updateMessage, readMessage, projectMessage } =
  vi.hoisted(() => ({
    getCurrentSession: vi.fn(),
    updateMessage: vi.fn(),
    readMessage: vi.fn(),
    projectMessage: vi.fn(),
  }));

const session: Session = {
  id: "session-1",
  title: "Session",
  updatedAt: 1,
  model: "test-model",
  pinned: false,
  messageCount: 1,
};

const staleMessage: Message = {
  id: "model-1",
  role: "model",
  content: "stale",
  timestamp: 1,
  outputBlocks: [{ id: "ui", type: "intelligent_ui" } as never],
};
const freshMessage: Message = {
  ...staleMessage,
  content: "fresh",
};

vi.mock("@/lib/chat/readSessionForPresentation", () => ({
  readMessageForPresentation: readMessage,
}));
vi.mock("@/lib/chat/intelligentUiPortability", () => ({
  assertPreparedMessageUiValid: vi.fn(async () => undefined),
  prepareMessageUiForStatic: vi.fn(async (message: Message) => message),
  projectMessageUiForExport: projectMessage,
}));
vi.mock("@/store/core/chatStore", () => ({
  useChatStore: Object.assign(
    () => ({
      getCurrentSession,
      selectedModel: "test-model",
      activeMessages: [staleMessage],
      updateMessage,
    }),
    {
      getState: () => ({
        currentSessionId: session.id,
        isActiveSessionLoading: false,
      }),
    },
  ),
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
  default: () => <div>message output</div>,
}));
vi.mock("@/components/content/Artifact", () => ({
  default: () => <textarea aria-label="Artifact editor" />,
}));
vi.mock("@/services/api/voiceService", () => ({ synthesizeSpeech: vi.fn() }));

import MessageItem from "@/components/chat/MessageItem";

describe("MessageItem current export freshness", () => {
  beforeEach(() => {
    getCurrentSession.mockReturnValue(session);
    readMessage.mockResolvedValue({ session, message: freshMessage });
    projectMessage.mockResolvedValue("fresh export");
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
      () => undefined,
    );
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:message"),
      revokeObjectURL: vi.fn(),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("reads the settled message before current Markdown export", async () => {
    const user = userEvent.setup();
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <MessageItem
          message={staleMessage}
          onEdit={vi.fn()}
          onDelete={vi.fn()}
          isLast
        />
      </NextIntlClientProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Download format" }));
    await user.click(
      screen.getByRole("menuitemcheckbox", {
        name: "Include my inputs and results",
      }),
    );
    await user.click(screen.getByRole("menuitem", { name: "Markdown" }));

    await waitFor(() =>
      expect(readMessage).toHaveBeenCalledWith("session-1", "model-1"),
    );
    await waitFor(() =>
      expect(projectMessage).toHaveBeenCalledWith(
        freshMessage,
        "session-1",
        expect.objectContaining({ purpose: "static-current" }),
      ),
    );
  });
});
