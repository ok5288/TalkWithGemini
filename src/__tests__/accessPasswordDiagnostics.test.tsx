// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import AccessPasswordPage from "@/components/app/AccessPasswordPage";
import accessPasswordMessages from "@/i18n/locales/en/AccessPassword.json";

const refreshMock = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

function response(status: number, payload: Record<string, unknown> = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  };
}

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

async function submitPassword() {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Access password"), "secret");
  await user.click(screen.getByRole("button", { name: "Unlock" }));
}

describe("AccessPasswordPage session diagnostics", () => {
  afterEach(() => {
    cleanup();
    refreshMock.mockReset();
    vi.unstubAllGlobals();
  });

  it("confirms the access session through /api/config before refreshing", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(200, { ok: true }))
      .mockResolvedValueOnce(response(200, { ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    renderAccessPage();
    await submitPassword();

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/access/verify",
      expect.objectContaining({ credentials: "same-origin" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/config",
      expect.objectContaining({
        credentials: "same-origin",
        cache: "no-store",
      }),
    );
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it("reports a missing session when /api/config returns 401", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(response(200, { ok: true }))
        .mockResolvedValueOnce(response(401)),
    );

    renderAccessPage();
    await submitPassword();

    expect(
      await screen.findByText(/access session cookie was not established/i),
    ).toBeTruthy();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("reports reverse-proxy origin errors for a 403 response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(response(403, { code: "CSRF_ORIGIN_BLOCKED" })),
    );

    renderAccessPage();
    await submitPassword();

    expect(
      await screen.findByText(/same-origin check.*reverse proxy/i),
    ).toBeTruthy();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("reports a network diagnostic when verification cannot reach the server", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));

    renderAccessPage();
    await submitPassword();

    expect(
      await screen.findByText(/unable to reach the deployment/i),
    ).toBeTruthy();
    expect(refreshMock).not.toHaveBeenCalled();
  });
});
