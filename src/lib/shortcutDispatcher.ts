import {
  SHORTCUT_ACTION_IDS,
  canShortcutRunInEditable,
  isEditableShortcutTarget,
  shortcutBindingMatchesEvent,
  type ShortcutActionId,
  type ShortcutBindings,
} from "@/lib/shortcuts";

export type ShortcutActionHandlers = Record<ShortcutActionId, () => boolean>;

const BLOCKING_LAYER_SELECTOR = '[role="dialog"], [role="menu"]';

function isActiveBlockingLayer(element: Element): boolean {
  if (
    element.hasAttribute("hidden") ||
    element.getAttribute("aria-hidden") === "true" ||
    element.getAttribute("data-state") === "closed"
  ) {
    return false;
  }

  return !element.closest('[inert], [aria-hidden="true"]');
}

export function hasActiveShortcutBlockingLayer(documentRef: Document): boolean {
  return Array.from(documentRef.querySelectorAll(BLOCKING_LAYER_SELECTOR)).some(
    isActiveBlockingLayer,
  );
}

export function resolveShortcutAction(
  event: KeyboardEvent,
  bindings: ShortcutBindings,
  documentRef: Document = document,
): ShortcutActionId | null {
  if (
    event.defaultPrevented ||
    event.repeat ||
    event.isComposing ||
    hasActiveShortcutBlockingLayer(documentRef)
  ) {
    return null;
  }

  for (const actionId of SHORTCUT_ACTION_IDS) {
    const binding = bindings[actionId];
    if (!shortcutBindingMatchesEvent(binding, event)) continue;
    if (
      isEditableShortcutTarget(event.target) &&
      !canShortcutRunInEditable(binding)
    ) {
      return null;
    }
    return actionId;
  }

  return null;
}

export function dispatchShortcutEvent(
  event: KeyboardEvent,
  bindings: ShortcutBindings,
  handlers: ShortcutActionHandlers,
  documentRef: Document = document,
): ShortcutActionId | null {
  const actionId = resolveShortcutAction(event, bindings, documentRef);
  if (!actionId || !handlers[actionId]()) return null;

  event.preventDefault();
  return actionId;
}
