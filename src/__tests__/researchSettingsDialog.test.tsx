// @vitest-environment jsdom

import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";

import ResearchSettingsDialog from "@/components/research/ResearchSettingsDialog";
import researchMessages from "@/i18n/locales/en/Research.json";
import { RESEARCH_STRATEGY_PRESETS } from "@/lib/research";

vi.mock("@/components/agent/AgentArtifactDrawer", () => ({
  default: ({
    active,
    sessionId,
  }: {
    active: boolean;
    sessionId?: string | null;
  }) => (
    <div data-testid="artifact-workspace">
      {active ? "active" : "inactive"}:{sessionId}
    </div>
  ),
}));

afterEach(cleanup);

function renderDialog(
  overrides: Partial<React.ComponentProps<typeof ResearchSettingsDialog>> = {},
) {
  const props: React.ComponentProps<typeof ResearchSettingsDialog> = {
    open: true,
    sessionId: "session-1",
    budgetPreset: "standard",
    onChange: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  render(
    <NextIntlClientProvider
      locale="en"
      messages={{ Research: researchMessages }}
    >
      <ResearchSettingsDialog {...props} />
    </NextIntlClientProvider>,
  );
  return props;
}

describe("ResearchSettingsDialog", () => {
  it("loads an exact strategy when a budget preset is selected", async () => {
    const onChange = vi.fn();
    renderDialog({ onChange });

    await userEvent.click(screen.getByRole("radio", { name: /Thorough/ }));

    expect(onChange).toHaveBeenCalledWith(
      "deep",
      RESEARCH_STRATEGY_PRESETS.deep,
    );
  });

  it("offers thoroughness without raw strategy number inputs", async () => {
    const onChange = vi.fn();
    renderDialog({ onChange });
    expect(screen.queryByRole("spinbutton")).toBeNull();
    expect(screen.getByText("About 15 minutes")).toBeTruthy();
    await userEvent.click(screen.getByRole("radio", { name: "Quick" }));
    expect(onChange).toHaveBeenCalledWith(
      "quick",
      RESEARCH_STRATEGY_PRESETS.quick,
    );
  });

  it("reflects a pending choice immediately and restores it if saving fails", async () => {
    let reject!: (reason: Error) => void;
    const pending = new Promise<void>((_resolve, fail) => {
      reject = fail;
    });
    renderDialog({ onChange: () => pending });
    const quick = screen.getByRole("radio", {
      name: "Quick",
    }) as HTMLInputElement;
    await userEvent.click(quick);
    expect(quick.checked).toBe(true);
    await act(async () => {
      reject(new Error("Storage unavailable"));
    });
    expect(quick.checked).toBe(false);
    expect(
      (screen.getByRole("radio", { name: "Standard" }) as HTMLInputElement)
        .checked,
    ).toBe(true);
    expect(screen.getByText(researchMessages.adjust.error)).toBeTruthy();
  });

  it("reuses the Artifact workspace and supports keyboard tab navigation", () => {
    renderDialog();
    const researchTab = screen.getByRole("tab", { name: "Research settings" });
    const workspaceTab = screen.getByRole("tab", {
      name: "Artifact and workspace",
    });

    expect(screen.queryByTestId("artifact-workspace")).toBeNull();
    researchTab.focus();
    fireEvent.keyDown(researchTab, { key: "ArrowRight" });

    expect(workspaceTab.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(workspaceTab);
    expect(screen.getByTestId("artifact-workspace").textContent).toBe(
      "active:session-1",
    );
  });

  it("closes from the header, Escape, or backdrop but not content", async () => {
    const onClose = vi.fn();
    renderDialog({ onClose });
    const dialog = screen.getByRole("dialog");

    fireEvent.mouseDown(dialog);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.mouseDown(dialog.parentElement as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(2);
    await userEvent.click(
      screen.getByRole("button", { name: "Close Deep Research settings" }),
    );
    expect(onClose).toHaveBeenCalledTimes(3);
  });
});
