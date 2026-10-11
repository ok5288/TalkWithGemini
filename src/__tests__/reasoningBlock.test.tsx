// @vitest-environment jsdom

import React from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ReasoningBlock from "@/components/content/ReasoningBlock";
import contentMessages from "@/i18n/locales/en/Content.json";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

interface ReasoningState {
  id: string;
  content: string;
  active: boolean;
  startedAt?: number;
  durationMs?: number;
}

function ReasoningSequence({ blocks }: { blocks: ReasoningState[] }) {
  return (
    <NextIntlClientProvider locale="en" messages={{ Content: contentMessages }}>
      {blocks.map((block) => (
        <ReasoningBlock
          key={block.id}
          reasoning={block.content}
          isThinking={block.active}
          startedAt={block.startedAt}
          durationMs={block.durationMs}
        />
      ))}
    </NextIntlClientProvider>
  );
}

describe("ReasoningBlock expansion", () => {
  it("opens and closes each streamed block independently", async () => {
    const view = render(
      <ReasoningSequence
        blocks={[{ id: "first", content: "First thought", active: true }]}
      />,
    );
    expect(
      screen.getAllByRole("button")[0]?.getAttribute("aria-expanded"),
    ).toBe("true");

    view.rerender(
      <ReasoningSequence
        blocks={[
          { id: "first", content: "First thought", active: false },
          { id: "second", content: "Second thought", active: true },
        ]}
      />,
    );
    const buttons = screen.getAllByRole("button");
    expect(buttons[0]?.getAttribute("aria-expanded")).toBe("false");
    expect(buttons[1]?.getAttribute("aria-expanded")).toBe("true");

    view.rerender(
      <ReasoningSequence
        blocks={[
          { id: "first", content: "First thought", active: false },
          { id: "second", content: "Second thought", active: false },
        ]}
      />,
    );
    expect(
      screen.getAllByRole("button")[1]?.getAttribute("aria-expanded"),
    ).toBe("false");

    await userEvent.click(screen.getAllByRole("button")[0]!);
    expect(
      screen.getAllByRole("button")[0]?.getAttribute("aria-expanded"),
    ).toBe("true");
    view.rerender(
      <ReasoningSequence
        blocks={[
          { id: "first", content: "First thought", active: false },
          { id: "second", content: "Second thought", active: false },
        ]}
      />,
    );
    expect(
      screen.getAllByRole("button")[0]?.getAttribute("aria-expanded"),
    ).toBe("true");
  });
});

describe("ReasoningBlock duration", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
  });

  it("updates elapsed seconds from the block start without resetting on streamed content", () => {
    const block = {
      id: "thought",
      content: "First thought",
      active: true,
      startedAt: 7_500,
    };
    const view = render(<ReasoningSequence blocks={[block]} />);
    expect(screen.getByLabelText("Thought duration: 2.5 sec")).toBeTruthy();

    act(() => vi.advanceTimersByTime(100));
    expect(screen.getByLabelText("Thought duration: 2.6 sec")).toBeTruthy();

    view.rerender(
      <ReasoningSequence blocks={[{ ...block, content: "More thought" }]} />,
    );
    act(() => vi.advanceTimersByTime(200));
    expect(screen.getByLabelText("Thought duration: 2.8 sec")).toBeTruthy();

    view.rerender(
      <ReasoningSequence
        blocks={[{ ...block, active: false, durationMs: 2_850 }]}
      />,
    );
    act(() => vi.advanceTimersByTime(1_000));
    expect(screen.getByLabelText("Thought duration: 2.9 sec")).toBeTruthy();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("times legacy reasoning without start metadata and clears its timer on unmount", () => {
    const block = { id: "legacy", content: "Thinking", active: true };
    const view = render(<ReasoningSequence blocks={[block]} />);
    expect(screen.getByLabelText("Thought duration: 0.0 sec")).toBeTruthy();

    act(() => vi.advanceTimersByTime(1_200));
    view.rerender(
      <ReasoningSequence blocks={[{ ...block, content: "Still thinking" }]} />,
    );
    act(() => vi.advanceTimersByTime(100));
    expect(screen.getByLabelText("Thought duration: 1.3 sec")).toBeTruthy();

    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("uses an independent duration for each reasoning block", () => {
    render(
      <ReasoningSequence
        blocks={[
          {
            id: "completed",
            content: "Completed thought",
            active: false,
            durationMs: 1_250,
          },
          {
            id: "active",
            content: "New thought",
            active: true,
            startedAt: 9_500,
          },
        ]}
      />,
    );

    act(() => vi.advanceTimersByTime(100));
    expect(screen.getByLabelText("Thought duration: 1.3 sec")).toBeTruthy();
    expect(screen.getByLabelText("Thought duration: 0.6 sec")).toBeTruthy();
  });
});
