// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import UiSendConfirmationDialog from "@/components/content/intelligentUi/UiSendConfirmationDialog";
import messages from "@/i18n/locales/en/IntelligentUi.json";

afterEach(cleanup);

describe("host send confirmation layout", () => {
  it("scrolls long plain-text content independently of its action footer", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const text = "<img src=x onerror=alert(1)>" + "a".repeat(199_970);
    const context = "<script>untrusted()</script>";
    render(
      <NextIntlClientProvider
        locale="en"
        messages={{ IntelligentUi: messages }}
      >
        <UiSendConfirmationDialog
          proposal={{
            id: "proposal",
            text,
            context,
            saving: false,
            saveFailed: false,
          }}
          onConfirm={onConfirm}
          onCancel={onCancel}
        />
      </NextIntlClientProvider>,
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog.classList.contains("flex-col")).toBe(true);
    const textElement = dialog.querySelectorAll("pre")[0];
    expect(textElement.textContent).toBe(text);
    expect(dialog.querySelectorAll("pre")[1].textContent).toBe(context);
    expect(dialog.querySelector("img, script")).toBeNull();
    const body = textElement.parentElement!.parentElement!;
    expect(body.classList.contains("min-h-0")).toBe(true);
    expect(body.classList.contains("overflow-y-auto")).toBe(true);
    const confirm = screen.getByRole("button", {
      name: messages.sendConfirmation.confirm,
    });
    const footer = confirm.parentElement!;
    expect(footer.classList.contains("shrink-0")).toBe(true);
    expect(body.contains(footer)).toBe(false);
    fireEvent.click(confirm);
    fireEvent.click(
      screen.getByRole("button", { name: messages.sendConfirmation.cancel }),
    );
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
