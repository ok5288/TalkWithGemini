// @vitest-environment jsdom
import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import IntelligentUiCard from "@/components/content/intelligentUi/IntelligentUiCard";
import messages from "@/i18n/locales/en/IntelligentUi.json";
import type { IntelligentUiBlock } from "@/lib/intelligentUi/types";
vi.mock("next/dynamic", async () => {
  const { HtmlUiFrame } =
    await import("@/components/content/intelligentUi/HtmlUiFrame");
  return {
    default: (loader: () => unknown) =>
      String(loader).includes("HtmlUiFrame") ? HtmlUiFrame : () => null,
  };
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const block: IntelligentUiBlock = {
  id: "html",
  type: "intelligent_ui",
  renderer: "html",
  schemaVersion: 1,
  definitionRevision: 1,
  stateRevision: 1,
  state: { count: 7 },
  staticSnapshot: "Saved result",
  sourceRefs: [],
  fallbackMarkdown: "Simulation",
  status: "ready",
  definition: {
    version: 1,
    title: "Simulation",
    summary: "Explore",
    html: "<p>Preview</p>",
  },
};
it("shows startup failure and explicitly retries with saved state without resending source after rerender", () => {
  vi.useFakeTimers();
  const ports: {
    onmessage: ((event: { data: unknown }) => void) | null;
    postMessage: ReturnType<typeof vi.fn>;
    start: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
  }[] = [];
  vi.stubGlobal(
    "MessageChannel",
    class {
      port1 = {
        onmessage: null,
        postMessage: vi.fn(),
        start: vi.fn(),
        close: vi.fn(),
      };
      port2 = {};
      constructor() {
        ports.push(this.port1);
      }
    },
  );
  const save = vi.fn();
  const send = vi.fn();
  const ui = (value: IntelligentUiBlock) => (
    <NextIntlClientProvider locale="en" messages={{ IntelligentUi: messages }}>
      <IntelligentUiCard
        block={value}
        enabled
        onStateChange={save}
        onSendMessage={send}
      />
    </NextIntlClientProvider>
  );
  const view = render(ui(block));
  expect(screen.getByRole("status").textContent).toBe(
    messages.runtime.starting,
  );
  expect(screen.queryByRole("button")).toBeNull();
  act(() => vi.advanceTimersByTime(5000));
  expect(screen.getByRole("alert").textContent).toContain(messages.renderError);
  expect(view.container.querySelector("iframe")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: messages.retry }));
  const frame = view.container.querySelector("iframe")!;
  const post = vi
    .spyOn(frame.contentWindow!, "postMessage")
    .mockImplementation(() => {});
  fireEvent.load(frame);
  const identity = (post.mock.calls[0]![0] as { identity: string }).identity;
  const port = ports[0]!;
  act(() => port.onmessage!({ data: { type: "connected", identity } }));
  expect(port.postMessage).toHaveBeenCalledWith(
    expect.objectContaining({ state: { count: 7 } }),
  );
  expect(
    screen.queryByRole("button", { name: messages.bringIntoChat }),
  ).toBeNull();
  act(() => port.onmessage!({ data: { type: "ready", identity } }));
  expect(screen.getByRole("status").textContent).toBe(messages.runtime.active);
  view.rerender(ui({ ...block, stateRevision: 2, state: { count: 8 } }));
  expect(view.container.querySelector("iframe")).toBe(frame);
  expect(
    port.postMessage.mock.calls.filter(([message]) => message.type === "init"),
  ).toHaveLength(1);
  expect(screen.queryByRole("button", { name: messages.reset })).toBeNull();
  view.unmount();
  expect(port.close).toHaveBeenCalled();
  act(() =>
    port.onmessage!({
      data: { type: "state", identity, value: { count: 999 } },
    }),
  );
  expect(save).not.toHaveBeenCalled();
  expect(send).not.toHaveBeenCalled();
});

it("reports HTML policy rejection without displaying the rejected capability or source", () => {
  const value = structuredClone(block);
  if (!value.definition || !("html" in value.definition)) throw Error();
  value.definition.html =
    '<iframe src="https://private.example/SECRET"></iframe>';
  render(
    <NextIntlClientProvider locale="en" messages={{ IntelligentUi: messages }}>
      <IntelligentUiCard block={value} enabled onStateChange={vi.fn()} />
    </NextIntlClientProvider>,
  );
  expect(screen.getByText(messages.diagnostic.html_policy)).toBeTruthy();
  expect(screen.getByRole("status").textContent).toBe(messages.runtime.failed);
  expect(document.body.textContent).not.toContain("SECRET");
  expect(document.querySelector("iframe")).toBeNull();
});
