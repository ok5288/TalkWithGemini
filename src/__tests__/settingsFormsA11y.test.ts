import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const readSource = (path: string) =>
  readFileSync(resolve(process.cwd(), path), "utf8");

describe("settings form accessibility", () => {
  it("labels memory fields and requires a second destructive delete action", () => {
    const source = readSource("src/components/settings/MemorySettings.tsx");

    expect(source).toContain('htmlFor="memory-content"');
    expect(source).toContain('id="memory-content"');
    expect(source).toContain("aria-invalid={!!contentError}");
    expect(source).toContain('role="alert"');
    expect(source).toContain("pendingDeleteId === memory.id");
    expect(source).toContain('t("confirmDelete")');
    expect(source).toContain("new Intl.DateTimeFormat(locale");
    expect(source).toContain("<form");
    expect(source).toContain("onSubmit={(event)");
    expect(source).toContain('type="submit"');
  });

  // Access-password error wiring is covered behaviourally in
  // componentA11y.test.tsx: it renders the page, submits a rejected password,
  // and asserts the alert/aria-invalid transition plus an axe pass.

  it("uses the shared modal lifecycle for remote files", () => {
    const source = readSource("src/components/modals/RemoteFileModal.tsx");

    expect(source).toContain("useModalLifecycle");
    expect(source).toContain("trapModalFocus");
    expect(source).toContain("overscroll-contain");
    expect(source).toContain("env(safe-area-inset-bottom)");
    expect(source).toContain("window.matchMedia");
    expect(source).toContain("<form");
    expect(source).toContain("onSubmit={handleSubmit}");
    expect(source).toContain('type="submit"');
    expect(source).not.toContain('e.key === "Enter"');
  });
});
