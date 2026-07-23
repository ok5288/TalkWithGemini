import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

import {
  disableNeoChatPwa,
  getLoadedShellAssetUrls,
} from "@/lib/pwa/lifecycle";
import {
  isCacheableShellAsset,
  isNeoChatPwaCache,
  shouldEnablePwa,
} from "@/lib/pwa/policy";

describe("PWA deployment policy", () => {
  it("only enables offline support for local deployments", () => {
    expect(shouldEnablePwa("local")).toBe(true);
    expect(shouldEnablePwa("hosted")).toBe(false);
  });

  it("only accepts same-origin versioned shell assets", () => {
    const origin = "https://chat.example.com";

    expect(
      isCacheableShellAsset(
        new URL("https://chat.example.com/_next/static/app.js"),
        origin,
      ),
    ).toBe(true);
    expect(
      isCacheableShellAsset(
        new URL("https://chat.example.com/_next/image?url=user-file"),
        origin,
      ),
    ).toBe(false);
    expect(
      isCacheableShellAsset(
        new URL("https://cdn.example.com/_next/static/app.js"),
        origin,
      ),
    ).toBe(false);
  });

  it("filters browser resource entries before sending them to the worker", () => {
    const entries = [
      { name: "https://chat.example.com/_next/static/app.js" },
      { name: "https://chat.example.com/api/config" },
      { name: "https://example.org/external.js" },
      { name: "not a url" },
    ] as PerformanceEntry[];

    expect(
      getLoadedShellAssetUrls(entries, "https://chat.example.com"),
    ).toEqual(["https://chat.example.com/_next/static/app.js"]);
  });

  it("unregisters its worker and removes only Neo Chat PWA caches", async () => {
    const unregister = vi.fn().mockResolvedValue(true);
    const unrelatedUnregister = vi.fn().mockResolvedValue(true);
    const deleteCache = vi.fn().mockResolvedValue(true);
    const serviceWorker = {
      getRegistrations: vi.fn().mockResolvedValue([
        {
          active: { scriptURL: "https://chat.example.com/sw.js" },
          unregister,
        },
        {
          active: { scriptURL: "https://chat.example.com/other-sw.js" },
          unregister: unrelatedUnregister,
        },
      ]),
    } as unknown as ServiceWorkerContainer;
    const cacheStorage = {
      keys: vi
        .fn()
        .mockResolvedValue(["neo-chat-pwa-shell-v2", "unrelated-cache"]),
      delete: deleteCache,
    } as unknown as CacheStorage;

    await disableNeoChatPwa({ cacheStorage, serviceWorker });

    expect(unregister).toHaveBeenCalledOnce();
    expect(unrelatedUnregister).not.toHaveBeenCalled();
    expect(deleteCache).toHaveBeenCalledWith("neo-chat-pwa-shell-v2");
    expect(deleteCache).not.toHaveBeenCalledWith("unrelated-cache");
    expect(isNeoChatPwaCache("neo-chat-pwa-static-v3")).toBe(true);
  });
});

describe("service worker cache boundary", () => {
  it("keeps APIs, event streams, external URLs, and user files network-only", () => {
    const worker = readFileSync(resolve(process.cwd(), "public/sw.js"), "utf8");

    expect(worker).toContain("url.origin !== self.location.origin");
    expect(worker).toContain('url.pathname.startsWith("/api/")');
    expect(worker).toContain('accept.includes("text/event-stream")');
    expect(worker).toContain('url.pathname.startsWith("/_next/image")');
    expect(worker).toContain('url.pathname.startsWith("/files/")');
  });

  it("keeps offline history navigation read-only without exposing tool decisions", () => {
    const shell = readFileSync(
      resolve(process.cwd(), "src/components/app/ChatAppShell.tsx"),
      "utf8",
    );
    const message = readFileSync(
      resolve(process.cwd(), "src/components/chat/MessageItem.tsx"),
      "utf8",
    );
    const knowledge = readFileSync(
      resolve(process.cwd(), "src/components/knowledge/KnowledgeBase.tsx"),
      "utf8",
    );

    expect(shell).toContain("actionsDisabled={isActiveSessionLoading}");
    expect(shell).toContain("mutationsDisabled={");
    expect(message).toContain("mutationActionsDisabled");
    expect(message).toContain(
      "mutationActionsDisabled\n                        ? undefined\n                        : onToolConfirmationDecision",
    );
    expect(knowledge).toContain("readOnly={!isOnline}");
    expect(knowledge).toContain('t("offlineReadOnly")');
  });

  it("ships installable 512px and maskable icons", () => {
    const manifest = readFileSync(
      resolve(process.cwd(), "src/app/manifest.ts"),
      "utf8",
    );

    expect(manifest).toContain('src: "/icon-512.png"');
    expect(manifest).toContain('src: "/icon-maskable-512.png"');
    expect(manifest).toContain('purpose: "maskable"');
  });
});
