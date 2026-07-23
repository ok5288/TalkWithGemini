import type { DeploymentMode } from "@/lib/security/deployment";

export const PWA_CACHE_PREFIX = "neo-chat-pwa-";
export const PWA_SCRIPT_URL = "/sw.js";

export function shouldEnablePwa(mode: DeploymentMode): boolean {
  return mode === "local";
}

export function isNeoChatPwaCache(cacheName: string): boolean {
  return cacheName.startsWith(PWA_CACHE_PREFIX);
}

export function isCacheableShellAsset(url: URL, origin: string): boolean {
  if (url.origin !== origin) return false;

  return (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname === "/manifest.webmanifest" ||
    url.pathname === "/logo.png" ||
    url.pathname === "/icon-512.png" ||
    url.pathname === "/icon-maskable-512.png"
  );
}
