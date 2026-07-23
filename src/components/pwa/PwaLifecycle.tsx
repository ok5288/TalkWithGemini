"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { RefreshCw, WifiOff } from "lucide-react";

import { disableNeoChatPwa, registerNeoChatPwa } from "@/lib/pwa/lifecycle";
import { shouldEnablePwa } from "@/lib/pwa/policy";
import type { DeploymentMode } from "@/lib/security/deployment";

interface PwaLifecycleProps {
  deploymentMode: DeploymentMode;
}

export default function PwaLifecycle({ deploymentMode }: PwaLifecycleProps) {
  const t = useTranslations("Common");
  const pwaEnabled = shouldEnablePwa(deploymentMode);
  const [isOnline, setIsOnline] = useState(true);
  const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(
    null,
  );

  useEffect(() => {
    setIsOnline(navigator.onLine);

    const handleOnline = () => {
      setIsOnline(true);
      document.documentElement.dataset.networkStatus = "online";
    };
    const handleOffline = () => {
      setIsOnline(false);
      document.documentElement.dataset.networkStatus = "offline";
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    document.documentElement.dataset.networkStatus = navigator.onLine
      ? "online"
      : "offline";

    if (!("serviceWorker" in navigator) || !("caches" in window)) {
      return () => {
        window.removeEventListener("online", handleOnline);
        window.removeEventListener("offline", handleOffline);
      };
    }

    if (!pwaEnabled) {
      void disableNeoChatPwa({
        cacheStorage: window.caches,
        serviceWorker: navigator.serviceWorker,
      }).catch(() => {
        // Cleanup is best-effort when a browser blocks storage access.
      });
      return () => {
        window.removeEventListener("online", handleOnline);
        window.removeEventListener("offline", handleOffline);
      };
    }

    let disposed = false;
    const trackWaitingWorker = (registration: ServiceWorkerRegistration) => {
      if (registration.waiting && !disposed) {
        setWaitingWorker(registration.waiting);
      }

      registration.addEventListener("updatefound", () => {
        const installing = registration.installing;
        installing?.addEventListener("statechange", () => {
          if (
            installing.state === "installed" &&
            navigator.serviceWorker.controller &&
            !disposed
          ) {
            setWaitingWorker(registration.waiting ?? installing);
          }
        });
      });
    };

    void registerNeoChatPwa(navigator.serviceWorker)
      .then(trackWaitingWorker)
      .catch(() => {
        // PWA support is optional; registration failure must not block chat.
      });

    return () => {
      disposed = true;
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [deploymentMode, pwaEnabled]);

  const activateUpdate = () => {
    if (!waitingWorker) return;

    const handleControllerChange = () => window.location.reload();
    navigator.serviceWorker.addEventListener(
      "controllerchange",
      handleControllerChange,
      { once: true },
    );
    waitingWorker.postMessage({ type: "SKIP_WAITING" });
  };

  if (!pwaEnabled || (isOnline && !waitingWorker)) return null;

  return (
    <div
      className="fixed bottom-4 left-1/2 z-[100] flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-3 rounded-xl border border-zinc-300/80 bg-white/95 px-4 py-3 text-sm text-zinc-800 shadow-[0_12px_40px_rgba(0,0,0,0.14)] backdrop-blur dark:border-zinc-700 dark:bg-zinc-900/95 dark:text-zinc-100"
      role="status"
      aria-live="polite"
    >
      {!isOnline ? (
        <>
          <WifiOff className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <span>{t("pwaOfflineReadOnly")}</span>
        </>
      ) : (
        <>
          <RefreshCw className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
          <span>{t("pwaUpdateReady")}</span>
          <button
            className="rounded-md bg-zinc-900 px-2.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-zinc-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-500 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
            type="button"
            onClick={activateUpdate}
          >
            {t("pwaReload")}
          </button>
        </>
      )}
    </div>
  );
}
