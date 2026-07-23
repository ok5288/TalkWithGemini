/** @vitest-environment jsdom */

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import syncMessages from "@/i18n/locales/en/Sync.json";

const syncState = vi.hoisted(() => ({
  enabled: true,
  provider: {
    kind: "webdav" as const,
    baseUrl: "https://dav.example.com",
    rootPath: "neo-chat",
  },
  credentialSecret: { version: 1 },
  rootKeySecret: { version: 1 },
  vaultId: "vault-1",
  status: "idle" as const,
  lastSyncAt: undefined,
  lastSyncBytes: 0,
  activeController: undefined,
  requiresReload: false,
  error: undefined,
  deviceName: "Test device",
  devices: [],
  conflicts: [
    {
      id: "settings:theme",
      documentId: "settings",
      path: ["theme"],
      currentValue: "light",
      values: ["light", "dark"],
    },
  ],
  configureProvider: vi.fn(),
  testConnection: vi.fn(),
  createRecoveryCode: vi.fn(),
  createNewVault: vi.fn(),
  initializeVault: vi.fn(),
  syncNow: vi.fn(),
  cancelSync: vi.fn(),
  setDeviceName: vi.fn(),
  resolveConflict: vi.fn(),
  disableSync: vi.fn(),
}));

vi.mock("@/store/core/syncStore", () => ({
  useSyncStore: () => syncState,
}));

import SyncSettings from "@/components/settings/SyncSettings";

afterEach(() => {
  cleanup();
  Object.defineProperty(window.navigator, "onLine", {
    configurable: true,
    value: true,
  });
});

describe("SyncSettings offline boundary", () => {
  it("explains and disables sync mutations while offline", async () => {
    Object.defineProperty(window.navigator, "onLine", {
      configurable: true,
      value: false,
    });
    render(
      <NextIntlClientProvider locale="en" messages={{ Sync: syncMessages }}>
        <SyncSettings />
      </NextIntlClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toContain(
        "You are offline",
      );
    });
    for (const name of [
      "Sync now",
      "Save provider",
      "Test connection",
      "Create a new vault",
      "Import and enable vault",
      'Use "light"',
    ]) {
      expect(
        screen.getByRole("button", { name }).hasAttribute("disabled"),
      ).toBe(true);
    }
    expect(
      screen.getByRole("radio", { name: "WebDAV" }).hasAttribute("disabled"),
    ).toBe(true);
    expect(
      screen
        .getByRole("textbox", { name: "This device name" })
        .hasAttribute("disabled"),
    ).toBe(true);
  });
});
