import { describe, expect, it } from "vitest";
import {
  hydrateChatImageUploads,
  readChatRequestBody,
} from "../lib/api/chatMultipart";

function jpegFile(name = "photo.jpg") {
  return new File([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], name, {
    type: "image/jpeg",
  });
}

describe("chat multipart parsing", () => {
  it("parses a bounded multipart payload and hydrates referenced files", async () => {
    const form = new FormData();
    form.set(
      "payload",
      JSON.stringify({
        history: [],
        attachments: [
          {
            id: "photo",
            uploadId: "image-0",
            mimeType: "image/jpeg",
            fileName: "photo.jpg",
          },
        ],
      }),
    );
    form.set("image:image-0", jpegFile());
    const encoded = new Request("https://example.test/api/chat", {
      method: "POST",
      body: form,
    });
    const bytes = await encoded.arrayBuffer();
    const request = new Request(encoded.url, {
      method: "POST",
      headers: {
        "content-type": encoded.headers.get("content-type")!,
        "content-length": String(bytes.byteLength),
      },
      body: bytes,
    });

    const body = await readChatRequestBody(request);
    const hydrated = await hydrateChatImageUploads(
      body.payload as {
        history: never[];
        attachments: Array<Record<string, unknown>>;
      },
      body.files,
    );

    expect(hydrated.attachments[0]).toMatchObject({
      id: "photo",
      mimeType: "image/jpeg",
      fileName: "photo.jpg",
    });
    expect(hydrated.attachments[0].file).toBeInstanceOf(File);
    expect(hydrated.attachments[0]).not.toHaveProperty("uploadId");
  });

  it("rejects missing and unreferenced multipart files", async () => {
    await expect(
      hydrateChatImageUploads(
        {
          history: [],
          attachments: [
            {
              id: "missing",
              uploadId: "image-0",
              mimeType: "image/jpeg",
              fileName: "missing.jpg",
            },
          ],
        },
        new Map(),
      ),
    ).rejects.toThrow(/missing/i);

    await expect(
      hydrateChatImageUploads(
        { history: [], attachments: [] },
        new Map([["image-0", jpegFile()]]),
      ),
    ).rejects.toThrow(/unreferenced/i);
  });

  it("rejects files whose bytes do not match the declared image MIME", async () => {
    const fakeJpeg = new File(["<html>not an image</html>"], "fake.jpg", {
      type: "image/jpeg",
    });

    await expect(
      hydrateChatImageUploads(
        {
          history: [],
          attachments: [
            {
              id: "fake",
              uploadId: "image-0",
              mimeType: "image/jpeg",
              fileName: "fake.jpg",
            },
          ],
        },
        new Map([["image-0", fakeJpeg]]),
      ),
    ).rejects.toThrow(/content does not match/i);
  });
});
