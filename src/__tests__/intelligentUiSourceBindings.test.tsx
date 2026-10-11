// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import SourceBindings from "@/components/content/intelligentUi/SourceBindings";
import messages from "@/i18n/locales/en/IntelligentUi.json";
import type {
  UiSourceBinding,
  UiSourceMaterial,
} from "@/lib/intelligentUi/sources/types";

afterEach(cleanup);
const alias = "source-1234567890abcdef";
const binding: UiSourceBinding = {
  alias,
  bindingId: "b",
  sourceRef: "private",
  version: "v1",
  contentHash: "a".repeat(64),
  bindingStatus: "resolved",
};
const material: UiSourceMaterial = {
  sessionId: "s",
  sourceRef: "private",
  kind: "attachment",
  title: "Cost data",
  version: "v1",
  contentHash: "a".repeat(64),
  capturedAt: 1,
  content: "Private amount 42",
  locator: "chunk:1",
  access: "allowed",
  availability: "available",
  retentionPolicy: "session",
};
function view(source: UiSourceMaterial) {
  return (
    <NextIntlClientProvider locale="en" messages={{ IntelligentUi: messages }}>
      <SourceBindings
        bindings={[binding]}
        context={{ sessionId: "s", materials: new Map([[alias, source]]) }}
      />
    </NextIntlClientProvider>
  );
}

describe("source disclosure adapter", () => {
  it("renders host-bound title, version, locator and safe literal context", () => {
    render(view(material));
    expect(screen.getByText(/Cost data/)).toBeTruthy();
    expect(screen.getByText("v1")).toBeTruthy();
    expect(screen.getByText("chunk:1")).toBeTruthy();
    expect(screen.getByText("Private amount 42")).toBeTruthy();
    expect(document.querySelector("details > summary")).toBeTruthy();
  });
  it("immediately removes private material on live permission revocation", () => {
    const { rerender } = render(view(material));
    rerender(view({ ...material, access: "denied" }));
    expect(screen.queryByText("Private amount 42")).toBeNull();
    expect(screen.queryByText(/Cost data/)).toBeNull();
    expect(screen.queryByText("chunk:1")).toBeNull();
  });
});
