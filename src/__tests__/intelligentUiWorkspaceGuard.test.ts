import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  writeWorkspaceText,
  writeWorkspaceBlob,
} from "@/services/workspace/sessionWorkspace";
import { writeToOPFS, writeBlobToOPFS } from "@/utils/opfs";

vi.mock("@/utils/opfs", () => ({
  listOPFSDirectory: async () => [],
  statOPFSFileSize: async () => null,
  writeToOPFS: vi.fn(),
  writeBlobToOPFS: vi.fn(),
}));
vi.mock("@/services/workspace/workspaceManifest", () => ({
  isWorkspaceManifestPath: () => false,
  reconcileWorkspaceManifest: async () => new Map(),
  recordWorkspaceManifestFile: async () => ({
    contentHash: "hash",
    revision: "revision",
    updatedAt: 1,
    source: "agent",
    bytes: 1,
  }),
}));
beforeEach(() => {
  vi.mocked(writeToOPFS).mockReset().mockResolvedValue();
  vi.mocked(writeBlobToOPFS).mockReset().mockResolvedValue();
});
describe("workspace host dispatch guard", () => {
  it("checks current authority after a queued previous write completes", async () => {
    let release!: () => void;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.mocked(writeToOPFS).mockImplementationOnce(async () => {
      await hold;
    });
    const first = writeWorkspaceText("session", "first.md", "first", "create");
    await vi.waitFor(() => expect(writeToOPFS).toHaveBeenCalledTimes(1));
    let authorized = true;
    const queued = writeWorkspaceText(
      "session",
      "second.md",
      "second",
      "create",
      { beforeWrite: () => authorized },
    );
    authorized = false;
    release();
    expect((await first).ok).toBe(true);
    expect(await queued).toMatchObject({
      ok: false,
      error: { code: "WORKSPACE_REVISION_CONFLICT" },
    });
    expect(writeToOPFS).toHaveBeenCalledTimes(1);
  });
  it("also honors the optional guard for binary writes, preserving unguarded contracts", async () => {
    expect(
      (
        await writeWorkspaceBlob("session", "blocked.bin", new Blob(["x"]), {
          beforeWrite: () => false,
        })
      ).ok,
    ).toBe(false);
    expect(writeBlobToOPFS).not.toHaveBeenCalled();
    expect(
      (await writeWorkspaceBlob("session", "allowed.bin", new Blob(["x"]))).ok,
    ).toBe(true);
    expect(writeBlobToOPFS).toHaveBeenCalledTimes(1);
  });
});
