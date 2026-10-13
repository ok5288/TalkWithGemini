"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/primitives";
import { useChatStore } from "@/store/core/chatStore";
import ConnectedIntelligentUiBlock from "../ConnectedIntelligentUiBlock";
import { useUiDisplay } from "./IntelligentUiDisplayContext";
import { uiDisplayKey } from "@/lib/intelligentUi/displayOwnership";

/** Outside the virtual timeline; responsive CSS never relocates the live iframe. */
export default function IntelligentUiViewer({
  onLocate,
}: {
  onLocate(messageId: string): void;
}) {
  const t = useTranslations("IntelligentUi");
  const { display, snapshot } = useUiDisplay();
  const target = snapshot.viewer;
  const block = useChatStore((state) =>
    target
      ? state.activeMessages
          .find((message) => message.id === target.messageId)
          ?.outputBlocks?.find((item) => item.id === target.blockId)
      : undefined,
  );
  const panel = useRef<HTMLElement>(null);
  const [narrow, setNarrow] = useState(false);
  const focusEdge = (last = false) => {
    const nodes = panel.current?.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), iframe, [tabindex="0"]:not([data-focus-guard])',
    );
    (nodes?.[last ? nodes.length - 1 : 0] ?? panel.current)?.focus();
  };
  useEffect(() => {
    const media = window.matchMedia?.("(max-width: 767px)");
    if (!media) return;
    const update = () => setNarrow(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    if (!narrow || !target) return;
    const changed: [HTMLElement, boolean][] = [];
    let node = panel.current;
    while (node?.parentElement) {
      for (const sibling of node.parentElement.children) {
        if (sibling !== node && sibling instanceof HTMLElement) {
          changed.push([sibling, sibling.inert]);
          sibling.inert = true;
        }
      }
      node = node.parentElement;
      if (node === document.body) break;
    }
    const guard = (event: FocusEvent) => {
      if (
        event.target instanceof Node &&
        !panel.current?.contains(event.target)
      )
        focusEdge();
    };
    document.addEventListener("focusin", guard);
    return () => {
      changed.forEach(([element, inert]) => {
        element.inert = inert;
      });
      document.removeEventListener("focusin", guard);
    };
  }, [narrow, target]);
  const targetKey = target ? uiDisplayKey(target) : null;
  useEffect(() => {
    if (!targetKey || !display) return;
    const previous =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    panel.current?.focus();
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        void display.move(null);
      }
      // The enlarged narrow view is modal; desktop keeps the composer reachable.
      if (
        event.key === "Tab" &&
        window.matchMedia?.("(max-width: 767px)").matches
      ) {
        const elements = panel.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), iframe, [tabindex="0"]',
        );
        if (!elements?.length) return;
        const first = elements[0],
          last = elements[elements.length - 1];
        if (
          event.shiftKey &&
          (document.activeElement === first ||
            document.activeElement === panel.current)
        ) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    const element = panel.current;
    element?.addEventListener("keydown", keyboard);
    return () => {
      element?.removeEventListener("keydown", keyboard);
      const available = (element: HTMLElement | null | undefined) =>
        element?.isConnected &&
        element !== document.body &&
        element !== document.documentElement &&
        !element.matches(":disabled") &&
        !element.closest("[inert]");
      if (available(previous)) previous?.focus();
      else {
        const open = Array.from(
          document.querySelectorAll<HTMLElement>("[data-ui-viewer-open]"),
        ).find((element) => element.dataset.uiViewerOpen === targetKey);
        const origin = Array.from(
          document.querySelectorAll<HTMLElement>("[data-ui-viewer-origin]"),
        ).find((element) => element.dataset.uiViewerOrigin === targetKey);
        // A restored HTML frame is still starting, so its Open button may be disabled.
        (available(open) ? open : origin)?.focus();
      }
    };
  }, [targetKey, display]);
  if (
    !target ||
    !display ||
    block?.type !== "intelligent_ui" ||
    block.definitionRevision !== target.definitionRevision
  )
    return null;
  return (
    <aside
      ref={panel}
      tabIndex={-1}
      role={narrow ? "dialog" : "complementary"}
      aria-modal={narrow || undefined}
      data-testid="intelligent-ui-viewer"
      aria-label={t("viewer.title")}
      className="fixed inset-0 z-50 flex min-w-0 flex-col bg-background text-foreground outline-none md:relative md:inset-auto md:z-auto md:w-[min(44vw,48rem)] md:shrink-0 md:border-l md:border-border"
    >
      {narrow ? (
        <span
          tabIndex={0}
          data-focus-guard="start"
          onFocus={() => focusEdge(true)}
          className="sr-only"
        />
      ) : null}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border p-3">
        <h2 className="min-w-0 truncate font-medium">
          {block.definition?.title || t("viewer.title")}
        </h2>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              if (!narrow) onLocate(target.messageId);
              else
                void display.move(null).then((closed) => {
                  if (closed) onLocate(target.messageId);
                });
            }}
          >
            {t("viewer.locate")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={snapshot.transitioning}
            onClick={() => void display.move(null)}
          >
            {t("viewer.close")}
          </Button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-4">
        {snapshot.transitioning ? (
          <p role="status">{t("viewer.saving")}</p>
        ) : null}
        {snapshot.error ? (
          <p role="alert" className="text-sm text-red-600">
            {t(`viewer.${snapshot.error}Error`)}
          </p>
        ) : null}
        <ConnectedIntelligentUiBlock
          key={targetKey}
          block={block}
          sessionId={target.sessionId}
          messageId={target.messageId}
          location="viewer"
        />
      </div>
      {narrow ? (
        <span
          tabIndex={0}
          data-focus-guard="end"
          onFocus={() => focusEdge()}
          className="sr-only"
        />
      ) : null}
    </aside>
  );
}
