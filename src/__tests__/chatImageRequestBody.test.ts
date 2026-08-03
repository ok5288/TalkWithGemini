import { describe, expect, it, vi } from "vitest";
import { bytesToBase64 } from "../lib/utils/binary";
import { createChatRequestBody } from "../lib/api/chatImageRequestBody";

const basePayload = {
  provider: { type: "Google" },
  modelName: "gemini-test",
  history: [],
  newMessage: "Describe this image",
};

describe("chat image request body", () => {
  it("sends OPFS images as multipart Files without local URLs or Base64", async () => {
    const resolveOPFSBlob = vi.fn(
      async () =>
        new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], {
          type: "image/jpeg",
        }),
    );

    const request = await createChatRequestBody(
      {
        ...basePayload,
        attachments: [
          {
            id: "photo",
            mimeType: "image/jpeg",
            fileName: "photo.jpg",
            url: "opfs://chat/images/photo.jpg",
          },
        ],
      },
      { resolveOPFSBlob },
    );

    expect(request.body).toBeInstanceOf(FormData);
    expect(request.headers).toBeUndefined();
    const form = request.body as FormData;
    const payload = JSON.parse(String(form.get("payload")));
    expect(payload.attachments[0]).toMatchObject({
      id: "photo",
      uploadId: "image-0",
      mimeType: "image/jpeg",
      fileName: "photo.jpg",
    });
    expect(payload.attachments[0]).not.toHaveProperty("url");
    expect(payload.attachments[0]).not.toHaveProperty("data");
    expect(JSON.stringify(payload)).not.toContain("base64");

    const file = form.get("image:image-0");
    expect(file).toBeInstanceOf(File);
    expect(file).toMatchObject({
      name: "photo.jpg",
      type: "image/jpeg",
      size: 4,
    });
  });

  it("moves legacy inline images out of JSON and into multipart Files", async () => {
    const data = bytesToBase64(new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
    const request = await createChatRequestBody({
      ...basePayload,
      history: [
        {
          id: "old-user",
          role: "user" as const,
          content: "Old image",
          timestamp: 1,
          attachments: [
            {
              id: "legacy",
              mimeType: "image/png",
              fileName: "legacy.png",
              data,
            },
          ],
        },
      ],
    });

    const form = request.body as FormData;
    const payloadText = String(form.get("payload"));
    expect(payloadText).not.toContain(data);
    expect(payloadText).not.toContain('"data"');
    expect(form.get("image:image-0")).toBeInstanceOf(File);
  });

  it("passes transient compressed Files through without encoding them", async () => {
    const file = new File(
      [new Uint8Array([0xff, 0xd8, 0xff, 0xd9])],
      "compressed.jpg",
      { type: "image/jpeg" },
    );
    const request = await createChatRequestBody({
      ...basePayload,
      attachments: [
        {
          id: "compressed",
          mimeType: "image/jpeg",
          fileName: "compressed.jpg",
          file,
        } as any,
      ],
    });

    const form = request.body as FormData;
    expect(form.get("image:image-0")).toMatchObject({
      name: "compressed.jpg",
      size: 4,
    });
    expect(String(form.get("payload"))).not.toContain('"file"');
    expect(String(form.get("payload"))).not.toContain('"data"');
  });

  it("uploads a repeated OPFS image once across history and current input", async () => {
    const resolveOPFSBlob = vi.fn(
      async () =>
        new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], {
          type: "image/jpeg",
        }),
    );
    const image = {
      id: "photo",
      mimeType: "image/jpeg",
      fileName: "photo.jpg",
      url: "opfs://chat/images/photo.jpg",
    };

    const request = await createChatRequestBody(
      {
        ...basePayload,
        history: [
          {
            id: "old-user",
            role: "user" as const,
            content: "Earlier",
            timestamp: 1,
            attachments: [image],
          },
        ],
        attachments: [image],
      },
      { resolveOPFSBlob },
    );

    const form = request.body as FormData;
    const payload = JSON.parse(String(form.get("payload")));
    expect(payload.history[0].attachments[0].uploadId).toBe("image-0");
    expect(payload.attachments[0].uploadId).toBe("image-0");
    expect(resolveOPFSBlob).toHaveBeenCalledOnce();
    expect([...form.keys()].filter((key) => key.startsWith("image:"))).toEqual([
      "image:image-0",
    ]);
  });

  it("keeps requests with only remote images as JSON", async () => {
    const request = await createChatRequestBody({
      ...basePayload,
      attachments: [
        {
          id: "remote",
          mimeType: "image/jpeg",
          fileName: "remote.jpg",
          url: "https://cdn.example.com/remote.jpg",
        },
      ],
    });

    expect(request.headers).toEqual({ "Content-Type": "application/json" });
    expect(typeof request.body).toBe("string");
    expect(JSON.parse(request.body as string).attachments[0].url).toBe(
      "https://cdn.example.com/remote.jpg",
    );
  });
});
