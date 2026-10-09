// @vitest-environment jsdom

import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type StreamCallback = (text: string) => void;

const mocks = vi.hoisted(() => ({
  streamGenerateContent: vi.fn(),
  continuation: vi.fn(() => "continue prompt"),
  addEmojis: vi.fn(() => "emoji prompt"),
  changeReadingLevel: vi.fn(() => "level prompt"),
  changeArtifactLength: vi.fn(() => "length prompt"),
  changeArtifactLanguage: vi.fn(() => "language prompt"),
}));

vi.mock("next-intl", () => ({
  useLocale: () => "en-US",
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${JSON.stringify(values)}` : key,
}));

vi.mock("@/services/api/chatService", () => ({
  streamGenerateContent: mocks.streamGenerateContent,
}));

vi.mock("@/services/artifactService", () => ({
  addEmojis: mocks.addEmojis,
  changeArtifactLanguage: mocks.changeArtifactLanguage,
  changeArtifactLength: mocks.changeArtifactLength,
  changeReadingLevel: mocks.changeReadingLevel,
  continuation: mocks.continuation,
}));

import Artifact from "@/components/content/Artifact";

function configureSnapshots(snapshots: string[]) {
  mocks.streamGenerateContent.mockImplementation(
    async (
      _model: string,
      _prompt: string,
      onChunk: StreamCallback,
    ): Promise<string> => {
      for (const snapshot of snapshots) onChunk(snapshot);
      return snapshots.at(-1) ?? "";
    },
  );
}

function configureFailure(error: Error) {
  mocks.streamGenerateContent.mockRejectedValue(error);
}

function renderArtifact(onSave = vi.fn()) {
  return {
    onSave,
    ...render(
      <Artifact
        initialContent="old"
        initialTimestamp={1}
        model="test-model"
        onSave={onSave}
        onCancel={vi.fn()}
      />,
    ),
  };
}

function editor() {
  return screen.getByRole("textbox", { name: "artifactContent" });
}

function expectEditorValue(value: string) {
  expect((editor() as HTMLTextAreaElement).value).toBe(value);
}

async function clickAction(name: "emoji" | "continue") {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name }));
    await Promise.resolve();
  });
}

beforeEach(() => {
  mocks.streamGenerateContent.mockReset();
  mocks.continuation.mockClear();
  mocks.addEmojis.mockClear();
  mocks.changeReadingLevel.mockClear();
  mocks.changeArtifactLength.mockClear();
  mocks.changeArtifactLanguage.mockClear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Artifact streamed editing", () => {
  it("replaces each cumulative rewrite snapshot and saves the final text", async () => {
    configureSnapshots(["A", "AB", "ABC"]);
    const onSave = vi.fn();
    renderArtifact(onSave);

    await clickAction("emoji");

    await waitFor(() => expectEditorValue("ABC"));
    expect((editor() as HTMLTextAreaElement).value).not.toBe("AABABC");

    fireEvent.click(screen.getByRole("button", { name: "save" }));
    expect(onSave).toHaveBeenCalledWith("ABC");
  });

  it("appends the generated cumulative continuation exactly once", async () => {
    configureSnapshots(["A", "AB"]);
    renderArtifact();

    await clickAction("continue");

    await waitFor(() => expectEditorValue("oldAB"));
    expect((editor() as HTMLTextAreaElement).value).not.toBe("oldAoldAB");
    expect(mocks.continuation).toHaveBeenCalledWith("old", "");
  });

  it("uses a non-empty returned result when the stream has no snapshots", async () => {
    mocks.streamGenerateContent.mockResolvedValue("returned result");
    const onSave = vi.fn();
    renderArtifact(onSave);

    await clickAction("emoji");

    await waitFor(() => expectEditorValue("returned result"));
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    expect(onSave).toHaveBeenCalledWith("returned result");

    fireEvent.click(
      screen.getByRole("button", { name: "toggleVersionHistory" }),
    );
    expect(
      screen.getAllByRole("button", { name: /restoreVersionAria/ }),
    ).toHaveLength(2);
  });

  it("keeps each successful operation as a restorable version", async () => {
    configureSnapshots(["A", "AB", "ABC"]);
    renderArtifact();
    await clickAction("emoji");
    await waitFor(() => expectEditorValue("ABC"));

    configureSnapshots(["D", "DE"]);
    await clickAction("emoji");
    await waitFor(() => expectEditorValue("DE"));

    fireEvent.click(
      screen.getByRole("button", { name: "toggleVersionHistory" }),
    );
    const versions = screen.getAllByRole("button", {
      name: /restoreVersionAria/,
    });
    expect(versions).toHaveLength(3);

    fireEvent.click(versions[1]);
    expectEditorValue("ABC");
    fireEvent.click(screen.getByRole("button", { name: "save" }));
  });

  it("restores the original content and creates no version for blank output", async () => {
    configureSnapshots([" ", "   "]);
    renderArtifact();

    await clickAction("emoji");

    await waitFor(() => expectEditorValue("old"));
    expect(screen.getByRole("status").textContent).toContain(
      "artifactUpdateFailed",
    );

    fireEvent.click(
      screen.getByRole("button", { name: "toggleVersionHistory" }),
    );
    expect(
      screen.getAllByRole("button", { name: /restoreVersionAria/ }),
    ).toHaveLength(1);
  });

  it("restores the original content and reports stream failures", async () => {
    configureFailure(new Error("network down"));
    renderArtifact();

    await clickAction("emoji");

    await waitFor(() => expectEditorValue("old"));
    expect(screen.getByRole("status").textContent).toContain(
      "artifactUpdateFailedWithError",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "toggleVersionHistory" }),
    );
    expect(
      screen.getAllByRole("button", { name: /restoreVersionAria/ }),
    ).toHaveLength(1);
  });
});
