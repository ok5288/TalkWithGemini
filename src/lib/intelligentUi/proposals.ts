import type { UiSendResult } from "./bridgeTypes";

/** Shared proposal lifetime; receipt acceptance is independent of generation. */
export interface UiProposal<Args extends unknown[]> {
  id: string;
  cancelled: boolean;
  validate: () => UiSendResult | undefined;
  acknowledge: (result: UiSendResult) => void;
  send?: (
    args: Args,
    acknowledge: (result: UiSendResult) => void,
  ) => Promise<void>;
}

export function createUiProposal<Args extends unknown[]>(
  id: string,
  validate: UiProposal<Args>["validate"],
) {
  let resolve!: (result: UiSendResult) => void;
  const result = new Promise<UiSendResult>((done) => {
    resolve = done;
  });
  const proposal: UiProposal<Args> = {
    id,
    cancelled: false,
    validate: () =>
      proposal.cancelled ? { ok: false, code: "cancelled" } : validate(),
    acknowledge: resolve,
  };
  return { proposal, result };
}

export function cancelUiProposal<Args extends unknown[]>(
  proposal: UiProposal<Args> | null,
  result: UiSendResult,
) {
  if (!proposal) return;
  proposal.cancelled = true;
  proposal.acknowledge(result);
}

export function canRetryUiProposal<Args extends unknown[]>(
  proposal: UiProposal<Args>,
): boolean {
  return !proposal.cancelled && !proposal.validate();
}

/** Subscription and lease polling use the same validation and cancellation rules. */
export function observeUiProposal<Args extends unknown[]>(options: {
  current: () => UiProposal<Args> | null;
  cancel: (result: UiSendResult) => void;
  subscribe: Array<((check: () => void) => () => void) | undefined>;
}) {
  const check = () => {
    const invalid = options.current()?.validate();
    if (invalid) options.cancel(invalid);
  };
  const subscriptions = options.subscribe.map((subscribe) =>
    subscribe?.(check),
  );
  const timer = setInterval(check, 100);
  return () => {
    subscriptions.forEach((unsubscribe) => unsubscribe?.());
    clearInterval(timer);
    options.cancel({ ok: false, code: "inactive" });
  };
}
