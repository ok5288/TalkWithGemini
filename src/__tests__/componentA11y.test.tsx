// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { NextIntlClientProvider } from "next-intl";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import AccessPasswordPage from "@/components/app/AccessPasswordPage";
import UserMessageEditor from "@/components/chat/UserMessageEditor";
import accessPasswordMessages from "@/i18n/locales/en/AccessPassword.json";
import messageMessages from "@/i18n/locales/en/Message.json";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));

vi.mock("@/services/api/chatService", () => ({
  streamGenerateContent: vi.fn(async () => undefined),
}));
vi.mock("@/services/artifactService", () => ({
  polishTextContent: vi.fn(() => "polish prompt"),
}));
vi.mock("@/store/core/settingsStore", () => ({
  getTaskModel: vi.fn(() => "test-model"),
}));

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

async function expectNoAxeViolations(container: HTMLElement) {
  const results = await axe.run(container, {
    runOnly: { type: "tag", values: WCAG_TAGS },
    // jsdom has no layout engine, so axe cannot resolve computed colors.
    // Contrast is covered by the static audit instead.
    rules: { "color-contrast": { enabled: false } },
  });

  expect(
    results.violations.map((violation) => ({
      id: violation.id,
      nodes: violation.nodes.map((node) => node.html),
    })),
  ).toEqual([]);
}

function setViewport(matchesDesktop: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: query === "(min-width: 768px)" ? matchesDesktop : false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
}

function renderEditor() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ Message: messageMessages }}>
      <UserMessageEditor
        initialContent="original text"
        onCancel={vi.fn()}
        onSubmit={vi.fn()}
      />
    </NextIntlClientProvider>,
  );
}

async function flushAnimationFrame() {
  await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("UserMessageEditor accessibility", () => {
  beforeEach(() => {
    setViewport(true);
  });

  it("exposes an accessible name for every control", async () => {
    const { container } = renderEditor();

    expect(
      screen.getByRole("textbox", { name: "Edit user message" }),
    ).toBeDefined();
    for (const button of screen.getAllByRole("button")) {
      const name =
        button.getAttribute("aria-label") ?? button.textContent?.trim() ?? "";
      expect(name.length).toBeGreaterThan(0);
    }

    await expectNoAxeViolations(container);
  });

  it("focuses the draft without scrolling it into view on desktop", async () => {
    const { container } = renderEditor();
    const textarea = container.querySelector("textarea");
    if (!textarea) throw new Error("Expected the draft textarea to render.");
    const focusSpy = vi.spyOn(textarea, "focus");

    await flushAnimationFrame();

    expect(focusSpy).toHaveBeenCalledWith({ preventScroll: true });
  });

  it("does not force the mobile keyboard open on a narrow viewport", async () => {
    setViewport(false);
    const { container } = renderEditor();
    const textarea = container.querySelector("textarea");
    if (!textarea) throw new Error("Expected the draft textarea to render.");
    const focusSpy = vi.spyOn(textarea, "focus");

    await flushAnimationFrame();

    expect(focusSpy).not.toHaveBeenCalled();
    expect(document.activeElement).not.toBe(textarea);
  });
});

function renderAccessPage() {
  return render(
    <NextIntlClientProvider
      locale="en"
      messages={{ AccessPassword: accessPasswordMessages }}
    >
      <AccessPasswordPage />
    </NextIntlClientProvider>,
  );
}

describe("AccessPasswordPage accessibility", () => {
  beforeEach(() => {
    setViewport(true);
  });

  it("labels the password field and wires it to the status region", async () => {
    const { container } = renderAccessPage();

    const input = screen.getByLabelText("Access password");
    const status = screen.getByRole("status");

    expect(input.getAttribute("aria-describedby")).toBe(status.id);
    expect(status.getAttribute("aria-live")).toBe("polite");
    expect(input.getAttribute("aria-invalid")).toBe("false");

    await expectNoAxeViolations(container);
  });

  it("announces a rejected password as an alert and marks the field invalid", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        json: async () => ({
          ok: false,
          code: "ACCESS_PASSWORD_INVALID",
          remainingAttempts: 2,
        }),
      })),
    );

    const { container } = renderAccessPage();
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("Access password"), "wrong-password");
    await user.click(screen.getByRole("button", { name: "Unlock" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("2 attempts");
    await waitFor(() => {
      expect(
        screen.getByLabelText("Access password").getAttribute("aria-invalid"),
      ).toBe("true");
    });

    await expectNoAxeViolations(container);
  });
});
