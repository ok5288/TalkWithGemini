/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  convertHeicToJpegFile,
  type HeicConverter,
} from "../lib/utils/imageCompression";

afterEach(() => {
  Reflect.deleteProperty(globalThis, "HeicTo");
  document
    .querySelectorAll('script[src$="/heic-to.min.js"]')
    .forEach((script) => {
      script.remove();
    });
});

describe("HEIC converter loader", () => {
  it("lazily loads the checked-in public script and uses its global function", async () => {
    const file = new File([new Uint8Array(8)], "photo.heic", {
      type: "image/heic",
      lastModified: 123,
    });
    const jpeg = new Blob([new Uint8Array(4)], { type: "image/jpeg" });
    const heicTo = vi.fn<HeicConverter>(async () => jpeg);

    const conversion = convertHeicToJpegFile(file);
    const script = document.querySelector<HTMLScriptElement>(
      'script[src$="/heic-to.min.js"]',
    );

    expect(script).not.toBeNull();
    expect(script?.async).toBe(true);
    Reflect.set(globalThis, "HeicTo", heicTo);
    script?.dispatchEvent(new Event("load"));

    await expect(conversion).resolves.toMatchObject({
      name: "photo.jpg",
      type: "image/jpeg",
      lastModified: 123,
    });
    expect(heicTo).toHaveBeenCalledWith({
      blob: file,
      type: "image/jpeg",
      quality: 0.9,
    });
  });
});
