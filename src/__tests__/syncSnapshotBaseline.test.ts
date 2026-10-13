import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppExportPayload } from "@/lib/data/appExport";

const mocks = vi.hoisted(() => ({
  appDb: {
    getItem: vi.fn(),
    keys: vi.fn(),
    removeItem: vi.fn(),
    setItem: vi.fn(),
  },
  createBrowserAppExportPayload: vi.fn(),
  insideExclusiveLock: false,
  runWithExclusiveAppDataLock: vi.fn(
    async (operation: () => Promise<unknown>) => {
      mocks.insideExclusiveLock = true;
      try {
        return await operation();
      } finally {
        mocks.insideExclusiveLock = false;
      }
    },
  ),
  writeBlobToOPFS: vi.fn(),
}));

vi.mock("@/lib/data/appExport", () => ({
  collectReferencedOpfsUrls: vi.fn(() => new Set<string>()),
  createBrowserAppExportPayload: mocks.createBrowserAppExportPayload,
}));

vi.mock("@/lib/data/appRestoreJournal", () => ({
  runWithExclusiveAppDataLock: mocks.runWithExclusiveAppDataLock,
}));

vi.mock("@/store/storage/storageConfig", () => ({
  appDb: mocks.appDb,
  STORAGE_KEYS: {
    CHAT: "chat-storage",
    CORE_SETTINGS: "core-settings-storage",
    KNOWLEDGE: "knowledge-storage",
    MEMORY: "memory-storage",
    SETTINGS: "settings-storage",
  },
  validateRestoredAppData: vi.fn(),
}));

vi.mock("@/utils/opfs", () => ({
  writeBlobToOPFS: mocks.writeBlobToOPFS,
}));

vi.mock("@/lib/sync/applyJournal", () => ({
  commitSyncApplyTransaction: vi.fn(),
  createBrowserSyncApplyJournalOptions: vi.fn(),
  createSyncApplyTransaction: vi.fn(),
  ensureInterruptedSyncApplyRecovery: vi.fn(),
  setSyncApplyPhase: vi.fn(),
}));

function exportPayload(
  title: string,
  includeMessage: boolean,
): AppExportPayload {
  return {
    exportVersion: 3,
    storageVersion: 6,
    exportedAt: "2026-09-05T00:00:00.000Z",
    metadata: {
      opfs: { mode: "bundled", includesBlobs: true },
      security: { credentialsIncluded: false, excluded: [] },
    },
    data: {
      chat: {
        state: {
          currentSessionId: "session-1",
          sessions: [{ id: "session-1", title }],
          workspaces: [],
        },
        version: 6,
      },
      sessionMessages: {
        "session-1": {
          rootMessageIds: includeMessage ? ["message-1"] : [],
          nodesById: includeMessage
            ? {
                "message-1": {
                  id: "message-1",
                  content: "Written during download",
                },
              }
            : {},
          activeChildByParentId: {},
        },
      },
      knowledge: { state: { collections: [] }, version: 6 },
    },
  };
}

describe("sync apply baseline", () => {
  beforeEach(() => {
    mocks.appDb.getItem.mockReset();
    mocks.appDb.keys.mockReset();
    mocks.appDb.removeItem.mockReset();
    mocks.appDb.setItem.mockReset();
    mocks.createBrowserAppExportPayload.mockReset();
    mocks.insideExclusiveLock = false;
    mocks.runWithExclusiveAppDataLock.mockClear();
    mocks.writeBlobToOPFS.mockReset();
  });

  it("rejects a stale materialization inside the lock before overwriting a new title or message", async () => {
    const { applySyncedAppData, captureLocalSyncSnapshot } =
      await import("@/lib/sync/snapshot");
    const beforeDownload = exportPayload("Before download", false);
    const writtenDuringDownload = exportPayload("New title", true);
    mocks.createBrowserAppExportPayload.mockResolvedValueOnce(beforeDownload);
    const baseline = await captureLocalSyncSnapshot();
    mocks.createBrowserAppExportPayload.mockImplementationOnce(async () => {
      expect(mocks.insideExclusiveLock).toBe(true);
      return writtenDuringDownload;
    });

    const applied = applySyncedAppData(
      beforeDownload.data,
      new Map([["opfs://chat/session-1/image.png", new Uint8Array([1])]]),
      { baseline },
    );

    await expect(applied).rejects.toMatchObject({
      name: "StaleSyncSnapshotError",
      code: "SYNC_LOCAL_BASELINE_STALE",
      retryable: true,
    });
    expect(mocks.createBrowserAppExportPayload).toHaveBeenLastCalledWith({
      flushMessageWrites: false,
    });
    expect(mocks.appDb.setItem).not.toHaveBeenCalled();
    expect(mocks.appDb.removeItem).not.toHaveBeenCalled();
    expect(mocks.writeBlobToOPFS).not.toHaveBeenCalled();
  });
});

it("recovers unopened Explorer v2 quarantine in both capture and split documents without writing DB", async () => {
  const { EXPLORER_TRAVEL_V2_EXAMPLE } =
    await import("@/lib/intelligentUi/explorer");
  const { captureLocalSyncSnapshot } = await import("@/lib/sync/snapshot");
  const { hasUnsupportedUiContent } =
    await import("@/lib/intelligentUi/compatibility");
  const captured = exportPayload("Unopened", true);
  const wrapper = {
    id: "quarantined",
    type: "intelligent_ui",
    schemaVersion: 1,
    renderer: "native",
    definition: null,
    definitionRevision: 1,
    status: "failed",
    fallbackMarkdown: "Travel",
    state: {},
    stateRevision: 0,
    staticSnapshot: "",
    sourceRefs: [],
    unsupportedPayload: JSON.stringify(EXPLORER_TRAVEL_V2_EXAMPLE),
  };
  captured.data.sessionMessages["unopened"] = JSON.stringify({
    rootMessageIds: ["message"],
    nodesById: {
      message: {
        id: "message",
        childMessageIds: [],
        message: {
          id: "message",
          role: "model",
          content: "",
          timestamp: 0,
          outputBlocks: [wrapper],
        },
      },
    },
  });
  mocks.createBrowserAppExportPayload.mockResolvedValue(captured);
  mocks.appDb.setItem.mockClear();
  const snapshot = await captureLocalSyncSnapshot();
  expect(hasUnsupportedUiContent(snapshot.exported.data)).toBe(false);
  expect(hasUnsupportedUiContent(snapshot.documents)).toBe(false);
  expect(JSON.stringify(snapshot.documents)).toContain('"version":2');
  expect(wrapper.unsupportedPayload).toBeDefined();
  expect(mocks.appDb.setItem).not.toHaveBeenCalled();
});

it("exposes unknown quarantine from a stored JSON session to the sync rejection gate", async () => {
  const { captureLocalSyncSnapshot } = await import("@/lib/sync/snapshot");
  const { hasUnsupportedUiContent } =
    await import("@/lib/intelligentUi/compatibility");
  const captured = exportPayload("Future", false);
  const wrapper = {
    id: "future",
    type: "intelligent_ui",
    schemaVersion: 1,
    renderer: "native",
    definition: null,
    definitionRevision: 1,
    status: "failed",
    fallbackMarkdown: "Future",
    state: {},
    stateRevision: 0,
    staticSnapshot: "",
    sourceRefs: [],
    unsupportedPayload: '{"version":3,"kind":"explorer"}',
  };
  captured.data.sessionMessages.unopened = JSON.stringify({
    rootMessageIds: ["m"],
    nodesById: {
      m: { id: "m", childMessageIds: [], message: { outputBlocks: [wrapper] } },
    },
  });
  mocks.createBrowserAppExportPayload.mockResolvedValue(captured);
  const snapshot = await captureLocalSyncSnapshot();
  expect(hasUnsupportedUiContent(snapshot.exported.data)).toBe(true);
  expect(hasUnsupportedUiContent(snapshot.documents)).toBe(true);
});

vi.mock("@/services/sharing/client", () => ({
  withSessionSharesRemoved: async (
    _ids: unknown,
    operation: () => Promise<unknown>,
  ) => operation(),
}));

it("does not reintroduce the local quarantine marker while applying recovered sync data", async () => {
  const { EXPLORER_TRAVEL_V2_EXAMPLE } =
    await import("@/lib/intelligentUi/explorer");
  const { captureLocalSyncSnapshot, applySyncedAppData } =
    await import("@/lib/sync/snapshot");
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      localStorage: {
        getItem: () => null,
        setItem: vi.fn(),
        removeItem: vi.fn(),
      },
    },
  });
  try {
    const captured = exportPayload("Before", false);
    const wrapper = {
      id: "ui",
      type: "intelligent_ui",
      schemaVersion: 1,
      renderer: "native",
      definition: null,
      definitionRevision: 1,
      status: "failed",
      fallbackMarkdown: "Travel",
      state: {},
      stateRevision: 0,
      staticSnapshot: "",
      sourceRefs: [],
      unsupportedPayload: JSON.stringify(EXPLORER_TRAVEL_V2_EXAMPLE),
    };
    const tree = {
      rootMessageIds: ["m"],
      nodesById: {
        m: {
          id: "m",
          childMessageIds: [],
          message: {
            id: "m",
            role: "model",
            timestamp: 0,
            content: "",
            outputBlocks: [wrapper],
          },
        },
      },
    };
    captured.data.sessionMessages.unopened = JSON.stringify(tree);
    mocks.createBrowserAppExportPayload.mockResolvedValue(captured);
    mocks.appDb.keys.mockResolvedValue(["session_messages_unopened"]);
    mocks.appDb.getItem.mockImplementation(async (key: string) =>
      key === "session_messages_unopened"
        ? JSON.stringify(tree)
        : key === "chat-storage"
          ? JSON.stringify(captured.data.chat)
          : null,
    );
    mocks.appDb.setItem.mockClear();
    const snapshot = await captureLocalSyncSnapshot();
    const remote = structuredClone(snapshot.exported.data);
    remote.chat = exportPayload("After", false).data.chat;
    expect(await applySyncedAppData(remote, new Map())).toBe(true);
    const written = mocks.appDb.setItem.mock.calls.find(
      ([key]) => key === "session_messages_unopened",
    )?.[1];
    expect(written).toBeDefined();
    expect(written).not.toContain("unsupportedPayload");
    expect(written).toContain('"version":2');
  } finally {
    if (originalWindow)
      Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});
