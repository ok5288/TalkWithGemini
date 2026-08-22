import { describe, expect, it } from "vitest";

import { viewport } from "@/app/layout";

describe("app viewport", () => {
  it("keeps device-width layout without blocking zoom (WCAG 1.4.4)", () => {
    expect(viewport.width).toBe("device-width");
    expect(viewport.initialScale).toBe(1);
  });

  it("lets users scale the page to at least 200%", () => {
    // `userScalable: false` / `maximumScale: 1` fail WCAG 1.4.4 (Resize Text).
    // Absent values leave the browser default, which permits pinch-zoom.
    expect(viewport.userScalable).not.toBe(false);

    if (viewport.maximumScale !== undefined) {
      expect(viewport.maximumScale).toBeGreaterThanOrEqual(2);
    }
  });
});
