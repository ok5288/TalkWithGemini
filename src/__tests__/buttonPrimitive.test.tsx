// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it } from "vitest";

import { Button } from "@/components/ui/primitives";

afterEach(cleanup);

const classesOf = (name: string) =>
  screen.getByRole("button", { name }).className.split(/\s+/);

describe("Button primitive", () => {
  it("contributes no colour, geometry, or typography in the bare variant", () => {
    render(
      <Button variant="bare" className="px-5 py-2.5 bg-red-500/80 text-white">
        Exit reading
      </Button>,
    );

    const classes = classesOf("Exit reading");

    // The call site's own look survives untouched...
    expect(classes).toContain("bg-red-500/80");
    expect(classes).toContain("px-5");
    expect(classes).toContain("py-2.5");
    // ...and the primitive adds no competing look of its own.
    expect(classes).not.toContain("h-9");
    expect(classes).not.toContain("px-3");
    expect(classes).not.toContain("text-sm");
    expect(classes).not.toContain("font-medium");
    expect(classes).not.toContain("rounded-md");
    expect(classes).not.toContain("inline-flex");
  });

  it("still shares focus and disabled handling in the bare variant", () => {
    render(
      <Button variant="bare" className="p-1.5">
        Download
      </Button>,
    );

    const classes = classesOf("Download");

    expect(classes).toContain("focus-visible:ring-2");
    expect(classes).toContain("focus-visible:ring-ring");
    expect(classes).toContain("focus-visible:outline-none");
    expect(classes).toContain("disabled:opacity-50");
    expect(classes).toContain("disabled:cursor-not-allowed");
  });

  // Without conflict-aware merging a passthrough class only *joins* the
  // variant's class, and stylesheet order — not the call site — decides.
  it("lets a call site override variant colour", () => {
    render(
      <Button variant="primary" className="bg-emerald-600 hover:bg-emerald-700">
        Save
      </Button>,
    );

    const classes = classesOf("Save");

    expect(classes).toContain("bg-emerald-600");
    expect(classes).not.toContain("bg-red-600");
    expect(classes).toContain("hover:bg-emerald-700");
    expect(classes).not.toContain("hover:bg-red-700");
  });

  it("lets a call site override the shared focus ring per modifier", () => {
    render(
      <Button
        variant="bare"
        className="focus-visible:ring-red-400/40 focus-visible:ring-offset-white dark:focus-visible:ring-offset-background"
      >
        Copy
      </Button>,
    );

    const classes = classesOf("Copy");

    expect(classes).toContain("focus-visible:ring-red-400/40");
    expect(classes).not.toContain("focus-visible:ring-ring");
    // Same group, same modifier: the call site wins.
    expect(classes).toContain("focus-visible:ring-offset-white");
    expect(classes).not.toContain("focus-visible:ring-offset-background");
    // Different modifier set: kept, so dark mode is unaffected.
    expect(classes).toContain("dark:focus-visible:ring-offset-background");
  });

  it("defaults to type=button so a migrated control cannot submit a form", () => {
    render(<Button variant="bare">Toggle</Button>);
    render(
      <Button variant="bare" type="submit">
        Send
      </Button>,
    );

    expect(screen.getByRole("button", { name: "Toggle" })).toHaveProperty(
      "type",
      "button",
    );
    expect(screen.getByRole("button", { name: "Send" })).toHaveProperty(
      "type",
      "submit",
    );
  });
});
