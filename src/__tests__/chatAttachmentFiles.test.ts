import { describe, expect, it } from "vitest";
import { ATTACHMENT_LIMITS, IMAGE_ATTACHMENT_LIMITS } from "../config/limits";
import {
  extractChatAttachmentFilesFromClipboard,
  extractChatAttachmentFilesFromDrop,
  getChatAttachmentFileSelectionMessage,
  selectChatAttachmentFiles,
} from "../lib/utils/chatAttachmentFiles";

describe("chat attachment file selection", () => {
  it("rejects oversized files before FileReader work begins", () => {
    const selection = selectChatAttachmentFiles(0, [
      { name: "small.txt", size: 100 },
      { name: "huge.txt", size: ATTACHMENT_LIMITS.maxFileBytes + 1 },
    ]);

    expect(selection.accepted.map((file) => file.name)).toEqual(["small.txt"]);
    expect(selection.rejectedBySize.map((file) => file.name)).toEqual([
      "huge.txt",
    ]);
  });

  it("uses the runtime max file size when provided", () => {
    const selection = selectChatAttachmentFiles(
      0,
      [
        { name: "accepted.txt", size: 1024 },
        { name: "blocked.txt", size: 2048 },
      ],
      { maxFileBytes: 1500 },
    );

    expect(selection.accepted.map((file) => file.name)).toEqual([
      "accepted.txt",
    ]);
    expect(selection.rejectedBySize.map((file) => file.name)).toEqual([
      "blocked.txt",
    ]);
  });

  it("allows images through the 20 MiB preprocessing boundary", () => {
    const selection = selectChatAttachmentFiles(0, [
      {
        name: "compress-me.jpg",
        size: IMAGE_ATTACHMENT_LIMITS.compressionThresholdBytes + 1,
        type: "image/jpeg",
      },
      {
        name: "largest-allowed.HEIC",
        size: IMAGE_ATTACHMENT_LIMITS.maxSourceBytes,
        type: "",
      },
      {
        name: "too-large.heif",
        size: IMAGE_ATTACHMENT_LIMITS.maxSourceBytes + 1,
        type: "image/heif",
      },
    ]);

    expect(selection.accepted.map((file) => file.name)).toEqual([
      "compress-me.jpg",
      "largest-allowed.HEIC",
    ]);
    expect(selection.rejectedBySize.map((file) => file.name)).toEqual([
      "too-large.heif",
    ]);
  });

  it("recognizes common mobile image extensions when MIME is empty", () => {
    const selection = selectChatAttachmentFiles(0, [
      {
        name: "camera.JPG",
        size: ATTACHMENT_LIMITS.maxFileBytes + 1,
        type: "",
      },
      {
        name: "screenshot.png",
        size: ATTACHMENT_LIMITS.maxFileBytes + 1,
        type: "",
      },
    ]);

    expect(selection.accepted.map((file) => file.name)).toEqual([
      "camera.JPG",
      "screenshot.png",
    ]);
  });

  it("keeps the runtime limit for non-image files", () => {
    const selection = selectChatAttachmentFiles(
      0,
      [
        {
          name: "photo.png",
          size: ATTACHMENT_LIMITS.maxFileBytes + 1,
          type: "image/png",
        },
        {
          name: "archive.pdf",
          size: ATTACHMENT_LIMITS.maxFileBytes + 1,
          type: "application/pdf",
        },
      ],
      { maxFileBytes: ATTACHMENT_LIMITS.maxFileBytes },
    );

    expect(selection.accepted.map((file) => file.name)).toEqual(["photo.png"]);
    expect(selection.rejectedBySize.map((file) => file.name)).toEqual([
      "archive.pdf",
    ]);
  });

  it("rejects files that would exceed the attachment count limit", () => {
    const selection = selectChatAttachmentFiles(
      ATTACHMENT_LIMITS.maxCount - 1,
      [
        { name: "accepted.txt", size: 1 },
        { name: "extra.txt", size: 1 },
      ],
    );

    expect(selection.accepted.map((file) => file.name)).toEqual([
      "accepted.txt",
    ]);
    expect(selection.rejectedByCount.map((file) => file.name)).toEqual([
      "extra.txt",
    ]);
  });

  it("describes rejected files with user-facing messages", () => {
    const message = getChatAttachmentFileSelectionMessage(
      {
        rejectedByCount: [{ name: "extra.txt", size: 1 }],
        rejectedBySize: [
          { name: "huge-a.txt", size: ATTACHMENT_LIMITS.maxFileBytes + 1 },
          { name: "huge-b.txt", size: ATTACHMENT_LIMITS.maxFileBytes + 2 },
        ],
      },
      { maxFileBytes: 1500 },
    );

    expect(message).toContain("Attachment limit reached");
    expect(message).toContain("Skipped 2 file(s)");
    expect(message).toContain("1.5 KB");
  });

  it("extracts dropped files from a file list", () => {
    const first = new File(["a"], "a.txt", { type: "text/plain" });
    const second = new File(["b"], "b.txt", { type: "text/plain" });

    expect(
      extractChatAttachmentFilesFromDrop({
        files: [first, second],
      }),
    ).toEqual([first, second]);
  });

  it("extracts pasted files from clipboard file items", () => {
    const image = new File(["image"], "image.png", { type: "image/png" });

    expect(
      extractChatAttachmentFilesFromClipboard({
        items: [
          {
            kind: "string",
            getAsFile: () => null,
          },
          {
            kind: "file",
            getAsFile: () => image,
          },
        ],
      }),
    ).toEqual([image]);
  });
});
