// @vitest-environment jsdom

import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  PanelEmpty,
  PanelHeader,
  PanelLoading,
  PanelPagination,
  PanelRoot,
  PanelSearch,
} from "@/components/ui/panel";

afterEach(cleanup);

describe("shared capability panel shell", () => {
  it.each(["assistants", "skills", "plugins", "knowledge"] as const)(
    "sets the %s accent on the root",
    (accent) => {
      const { container } = render(
        <PanelRoot accent={accent}>Content</PanelRoot>,
      );
      expect(
        container.firstElementChild?.getAttribute("data-panel-accent"),
      ).toBe(accent);
    },
  );

  it("renders a heading and an accessible working close button", () => {
    const onClose = vi.fn();
    render(
      <PanelHeader
        icon={<span />}
        title="Skills"
        subtitle="Browse skills"
        onClose={onClose}
        closeLabel="Close skills"
      />,
    );
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "Skills",
    );
    expect(screen.getByText("Browse skills")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close skills" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("links the search label to the input and forwards input changes", () => {
    const onChange = vi.fn();
    render(
      <PanelSearch
        id="skill-search"
        name="skill-search"
        label="Search skills"
        placeholder="Find a skill"
        value=""
        onChange={onChange}
      >
        <button>Filters</button>
      </PanelSearch>,
    );
    const input = screen.getByRole("textbox", { name: "Search skills" });
    expect(screen.getByLabelText("Search skills")).toBe(input);
    expect(input.getAttribute("name")).toBe("skill-search");
    fireEvent.change(input, { target: { value: "writing" } });
    expect(onChange).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Filters" })).toBeTruthy();
  });

  it("omits the close control when a panel has no close action", () => {
    render(
      <PanelHeader
        icon={<span />}
        title="Knowledge"
        closeLabel="Close knowledge"
      />,
    );
    expect(
      screen.queryByRole("button", { name: "Close knowledge" }),
    ).toBeNull();
  });

  it("disables pagination at the boundaries and forwards navigation", () => {
    const onPrev = vi.fn();
    const onNext = vi.fn();
    const props = {
      totalPages: 3,
      onPrev,
      onNext,
      prevLabel: "Previous",
      nextLabel: "Next",
      label: "Page",
    };
    const { rerender } = render(<PanelPagination {...props} page={1} />);
    const prev = screen.getByRole<HTMLButtonElement>("button", {
      name: "Previous",
    });
    const next = screen.getByRole<HTMLButtonElement>("button", {
      name: "Next",
    });
    expect(prev.disabled).toBe(true);
    expect(next.disabled).toBe(false);
    fireEvent.click(next);
    expect(onNext).toHaveBeenCalledOnce();
    rerender(<PanelPagination {...props} page={3} />);
    expect(prev.disabled).toBe(false);
    expect(next.disabled).toBe(true);
    fireEvent.click(prev);
    expect(onPrev).toHaveBeenCalledOnce();
  });

  it("preserves search input semantics when requested", () => {
    render(
      <PanelSearch
        id="search-skills"
        name="skill-search"
        type="search"
        label="Search skills"
        placeholder="Find a skill"
        value=""
        onChange={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("searchbox", { name: "Search skills" }),
    ).toBeTruthy();
  });

  it("exposes empty and loading states to assistive technology", () => {
    const { rerender } = render(
      <PanelEmpty action={<button>Create</button>}>No items</PanelEmpty>,
    );
    expect(screen.getByRole("status").textContent).toContain("No items");
    expect(screen.getByRole("button", { name: "Create" })).toBeTruthy();
    rerender(<PanelLoading label="Loading skills" />);
    expect(screen.getByRole("status").textContent).toBe("Loading skills");
    expect(screen.getByRole("status").getAttribute("aria-live")).toBe("polite");
  });
});
