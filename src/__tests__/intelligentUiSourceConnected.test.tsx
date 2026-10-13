// @vitest-environment jsdom
import React from "react";
import { IntelligentUiDisplayProvider } from "@/components/content/intelligentUi/IntelligentUiDisplayContext";
import IntelligentUiViewer from "@/components/content/intelligentUi/IntelligentUiViewer";
import { webcrypto } from "node:crypto";
import { EXPLORER_TRAVEL_EXAMPLE } from "@/lib/intelligentUi/explorer/example";
import { createMessageSourceContext } from "@/lib/intelligentUi/sources/adapters";
import {
  loadActiveUiSourceContext,
  createActiveUiSourceScope,
  createFrozenUiSourceScope,
  buildActiveUiSourcePrompt,
  resolveBlockUiProjectionData,
} from "@/lib/intelligentUi/sourceContext";
import { resolveOPFSBlob } from "@/utils/opfs";
import type { Plugin, ToolCall } from "@/types";
import { createPluginFunctionFingerprint } from "@/lib/plugin/confirmation";
import { captureToolResultView } from "@/lib/intelligentUi/toolResults/adapters";
import { DEFAULT_AGENT_PROFILE } from "@/lib/assistant/profile";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Message } from "@/types";
import type { IntelligentUiBlock } from "@/lib/intelligentUi/types";
import { parseIntelligentUiText } from "@/lib/intelligentUi/parser";
import { normalizeSessionMessageTree } from "@/lib/chat/messageTree";
import { useSettingsStore } from "@/store/core/settingsStore";
import ConnectedIntelligentUiBlock from "@/components/content/ConnectedIntelligentUiBlock";
import messages from "@/i18n/locales/en/IntelligentUi.json";
vi.mock("next/dynamic", () => ({ default: () => () => null }));
const { appDb, stored } = vi.hoisted(() => {
  const stored = new Map<string, unknown>();
  return {
    stored,
    appDb: {
      getItem: vi.fn(async (key: string) => stored.get(key)),
      setItem: vi.fn(async (key: string, value: unknown) => {
        stored.set(key, value);
      }),
      removeItem: vi.fn(async (key: string) => {
        stored.delete(key);
      }),
    },
  };
});
vi.mock("@/store/storage/storageConfig", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/store/storage/storageConfig")>()),
  appDb,
  getAppDbStorage: () => ({
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
  }),
  STORAGE_KEYS: { CHAT: "neo-chat-storage" },
  STORAGE_VERSION: 2,
}));
vi.mock("@/services/sharing/client", () => ({
  revokeSessionShareBeforeDelete: vi.fn(async () => undefined),
  cancelSessionShareDeletion: vi.fn(async () => undefined),
}));
vi.mock("@/utils/opfs", () => ({
  deleteFromOPFS: vi.fn(async () => undefined),
  resolveOPFSBlob: vi.fn(),
}));
vi.mock("@/services/workspace/sessionArtifact", () => ({
  deleteSessionArtifacts: vi.fn(async () => undefined),
  duplicateSessionArtifacts: vi.fn(async () => new Map()),
}));
vi.mock("@/store/core/agentRunStore", () => ({
  useAgentRunStore: {
    getState: () => ({ clearSessionRuns: vi.fn(async () => undefined) }),
  },
}));
const { useChatStore } = await import("@/store/core/chatStore");

const userMessage = (): Message => ({
  id: "input",
  role: "user",
  content: "Explore",
  timestamp: 1,
  attachments: [
    {
      id: "data",
      mimeType: "application/json",
      fileName: "private.json",
      url: "opfs://private.json",
    },
  ],
});
let sourceText = "";
async function install() {
  const definition = structuredClone(EXPLORER_TRAVEL_EXAMPLE);
  if (definition.props.dataset.kind !== "inline") throw Error("fixture");
  definition.props.dataset.data.rows[0].values.name = "Confidential choice";
  sourceText = JSON.stringify(definition.props.dataset.data);
  const input = userMessage();
  const context = await createMessageSourceContext({
    sessionId: "session",
    messages: [input],
    attachmentTexts: new Map([["data", sourceText]]),
  });
  const [alias, material] = [...context.materials][0];
  definition.props.dataset = {
    kind: "context",
    alias,
    version: material.version,
  };
  definition.props.provenance = "source";
  const parsed = parseIntelligentUiText(
    "```intelligent-ui\n" + JSON.stringify(definition) + "\n```",
    { final: true, idPrefix: "message" },
  )[0];
  if (parsed?.type !== "intelligent_ui" || parsed.block.status !== "ready")
    throw Error("fixture schema");
  const conversation: Message[] = [
    input,
    {
      id: "message",
      role: "model",
      content: "",
      timestamp: 2,
      outputBlocks: [parsed.block],
    },
  ];
  useChatStore.setState({
    _hasHydrated: true,
    currentSessionId: "session",
    sessions: [
      {
        id: "session",
        title: "Session",
        model: "model",
        updatedAt: 1,
        messageCount: 2,
      },
    ],
    activeMessages: conversation,
    activeMessageTree: normalizeSessionMessageTree(conversation),
    isActiveSessionLoading: false,
    pendingSessionId: null,
  });
  vi.mocked(resolveOPFSBlob).mockResolvedValue({
    size: sourceText.length,
    text: async () => sourceText,
  } as Blob);
}
const currentBlock = () =>
  useChatStore.getState().activeMessages[1]
    .outputBlocks![0] as IntelligentUiBlock;
function Harness({
  mode = "interactive",
}: {
  mode?: "interactive" | "static-original" | "static-current";
}) {
  const block = useChatStore(
    (state) =>
      state.activeMessages.find((message) => message.id === "message")
        ?.outputBlocks?.[0],
  ) as IntelligentUiBlock | undefined;
  return block ? (
    <NextIntlClientProvider locale="en" messages={{ IntelligentUi: messages }}>
      <ConnectedIntelligentUiBlock
        sessionId="session"
        messageId="message"
        block={block}
        mode={mode}
      />
    </NextIntlClientProvider>
  ) : null;
}
beforeEach(async () => {
  vi.stubGlobal("crypto", webcrypto);
  stored.clear();
  vi.clearAllMocks();
  useSettingsStore.setState((state) => ({
    system: { ...state.system, enableIntelligentUi: true },
  }));
  await install();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Connected source data with authoritative store", () => {
  it("duplicates a bound explorer with new source identity and preserved private progress", async () => {
    render(<Harness />);
    await waitFor(() => expect(currentBlock().sourceBindings).toHaveLength(1));
    const original = structuredClone(currentBlock());
    await act(async () => {
      await useChatStore
        .getState()
        .updateIntelligentUiState(
          "session",
          "message",
          original.id,
          original.definitionRevision,
          { ...currentBlock().state, selected: ["a"] },
        );
    });
    await act(async () => {
      await useChatStore.getState().duplicateSession("session");
    });
    const store = useChatStore.getState();
    const copiedMessage = store.activeMessages[1];
    const copied = copiedMessage.outputBlocks![0] as IntelligentUiBlock;
    expect(store.currentSessionId).not.toBe("session");
    expect(copied.sourceBindings?.[0]).toMatchObject({
      contentHash: original.sourceBindings![0].contentHash,
      version: original.sourceBindings![0].version,
      bindingStatus: "unverified",
    });
    expect(copied.sourceBindings?.[0].alias).not.toBe(
      original.sourceBindings![0].alias,
    );
    expect(copied.sourceBindings?.[0].sourceRef).toContain(
      store.activeMessages[0].id,
    );
    expect(copied.state.selected).toEqual(["a"]);
    const projection = await resolveBlockUiProjectionData(
      copied,
      store.currentSessionId!,
      copiedMessage.id,
    );
    expect(projection.dataset?.rows[0].values.name).toBe("Confidential choice");
    expect(original.state.selected).toEqual([]);
    useChatStore
      .getState()
      .updateMessage(store.currentSessionId!, store.activeMessages[0].id, {
        attachments: [],
      });
    expect(
      (
        await resolveBlockUiProjectionData(
          copied,
          store.currentSessionId!,
          copiedMessage.id,
        )
      ).dataset,
    ).toBeUndefined();
  });
  it("remaps a not-yet-bound context alias by exact message identity rather than guessed content", async () => {
    const original = currentBlock();
    expect(original.sourceBindings).toBeUndefined();
    await useChatStore.getState().duplicateSession("session");
    const store = useChatStore.getState();
    const copiedMessage = store.activeMessages[1];
    const copied = copiedMessage.outputBlocks![0] as IntelligentUiBlock;
    expect(copied.sourceBindings).toBeUndefined();
    expect(
      (
        await resolveBlockUiProjectionData(
          copied,
          store.currentSessionId!,
          copiedMessage.id,
        )
      ).dataset?.rows,
    ).toHaveLength(3);
  });
  it("invalidates pending source reads as soon as session loading starts", async () => {
    let finish!: (blob: Blob) => void;
    vi.mocked(resolveOPFSBlob).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const pending = loadActiveUiSourceContext("session", "message");
    useChatStore.setState({
      isActiveSessionLoading: true,
      pendingSessionId: "next",
    });
    finish({ size: sourceText.length, text: async () => sourceText } as Blob);
    expect((await pending).materials.size).toBe(0);
  });
  it("loads authorized source disclosure in read-only mode without interactions or persisted bindings", async () => {
    render(<Harness mode="static-original" />);
    await screen.findByText(/private\.json/);
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Bring into conversation" }),
    ).toBeNull();
    expect(currentBlock().stateRevision).toBe(0);
    expect(currentBlock().sourceBindings).toBeUndefined();
  });
  it("keeps the authorized original source when a private import snapshot exists", async () => {
    const sourceDataset = EXPLORER_TRAVEL_EXAMPLE.props.dataset;
    if (sourceDataset.kind !== "inline") throw Error("fixture");
    const imported = structuredClone(sourceDataset.data);
    imported.id = "private-import";
    imported.version = "local-1";
    imported.rows = [
      {
        id: "private",
        values: { name: "PRIVATE_ROW", transport: 1, hotel: 1, rating: 1 },
      },
    ];
    useChatStore.setState((state) => ({
      activeMessages: state.activeMessages.map((message) => ({
        ...message,
        outputBlocks: message.outputBlocks?.map((block) =>
          block.id === currentBlock().id
            ? { ...block, dataSnapshot: imported }
            : block,
        ),
      })),
    }));
    render(<Harness mode="static-original" />);
    await waitFor(() =>
      expect(document.body.textContent).toContain("Confidential choice"),
    );
    expect(screen.queryByText(/PRIVATE_ROW/)).toBeNull();
  });
  it("rechecks current enabled functions and definition fingerprints before exposing tool data", async () => {
    const outputSchema = {
      type: "object",
      properties: { intelligentUiFormat: { const: "table-v1" } },
    };
    const plugin: Plugin = {
      id: "tables",
      title: "Tables",
      description: "",
      logoUrl: "",
      manifestUrl: "https://example.com/manifest",
      functions: [
        { name: "table", description: "Rows", parameters: {}, outputSchema },
      ],
    };
    const fingerprint = await createPluginFunctionFingerprint(
      plugin,
      plugin.functions[0],
    );
    const call: ToolCall = {
      id: "table-call",
      name: "table",
      pluginId: plugin.id,
      functionFingerprint: fingerprint,
      args: {},
      status: "success",
      result: {
        ok: true,
        trust: "external_untrusted",
        provenance: { origin: "plugin", toolName: "table" },
        data: {
          intelligentUiFormat: "table-v1",
          columns: [{ id: "n", label: "Name", type: "text" }],
          rows: [{ id: "one", values: { n: "Private tool row" } }],
        },
      },
    };
    call.intelligentUiResult = await captureToolResultView({
      callId: call.id,
      toolName: call.name,
      pluginId: call.pluginId,
      definitionFingerprint: fingerprint,
      retrievedAt: 1,
      result: call.result,
      outputSchema,
      outputSchemaValidated: true,
    });
    useSettingsStore.setState({
      installedPlugins: [plugin],
      activePlugins: [plugin.id],
      pluginConfigs: {},
    });
    useChatStore
      .getState()
      .updateMessage("session", "message", { toolCalls: [call] });
    const material = (await loadActiveUiSourceContext("session", "message"))
      .materials;
    expect(
      [...material.values()].find((source) => source.kind === "tool")?.access,
    ).toBe("allowed");
    useSettingsStore.setState({
      pluginConfigs: { [plugin.id]: { disabledFunctions: ["table"] } },
    });
    expect(
      [
        ...(
          await loadActiveUiSourceContext("session", "message")
        ).materials.values(),
      ].find((source) => source.kind === "tool")?.access,
    ).not.toBe("allowed");
    useSettingsStore.setState({
      pluginConfigs: {},
      installedPlugins: [
        {
          ...plugin,
          functions: [
            { ...plugin.functions[0], parameters: { type: "object" } },
          ],
        },
      ],
    });
    expect(
      [
        ...(
          await loadActiveUiSourceContext("session", "message")
        ).materials.values(),
      ].find((source) => source.kind === "tool")?.access,
    ).not.toBe("allowed");
    useSettingsStore.setState({
      installedPlugins: [plugin],
      pluginConfigs: {},
    });
    const deniedProfile = structuredClone(DEFAULT_AGENT_PROFILE);
    useChatStore.setState((state) => ({
      sessions: state.sessions.map((session) => ({
        ...session,
        workspaceId: "workspace",
      })),
      workspaces: [
        {
          id: "workspace",
          name: "Workspace",
          files: [],
          knowledgeCollectionIds: [],
          createdAt: 1,
          agentProfile: deniedProfile,
        },
      ],
    }));
    const toolAccess = async () =>
      [
        ...(
          await loadActiveUiSourceContext("session", "message")
        ).materials.values(),
      ].find((source) => source.kind === "tool")?.access;
    expect(await toolAccess()).not.toBe("allowed");
    // The shared resolver gives an explicit session profile precedence over workspace.
    useChatStore.getState().updateSessionConfig("session", {
      agentProfile: {
        ...deniedProfile,
        capabilities: { pluginIds: [plugin.id] },
      },
    });
    expect(await toolAccess()).toBe("allowed");
    useChatStore
      .getState()
      .updateSessionConfig("session", { agentProfile: deniedProfile });
    expect(await toolAccess()).not.toBe("allowed");
  });
  it("does not read unrelated source bodies for a block with no source dependencies", async () => {
    const block = {
      ...currentBlock(),
      definition: {
        version: 1 as const,
        kind: "checklist" as const,
        title: "Tasks",
        summary: "",
        props: { items: [{ id: "one", label: "One" }] },
      },
    };
    expect(
      await resolveBlockUiProjectionData(block, "session", "message"),
    ).toEqual({ sourceSummary: [] });
    expect(resolveOPFSBlob).not.toHaveBeenCalled();
  });
  it("shows exact-version data, saves bindings and reuses source content across local edits", async () => {
    render(<Harness />);
    await waitFor(() => expect(currentBlock().sourceBindings).toHaveLength(1));
    await screen.findByText("Confidential choice");
    await waitFor(() =>
      expect(currentBlock().sourceBindings?.[0].bindingStatus).toBe("resolved"),
    );
    const calls = vi.mocked(resolveOPFSBlob).mock.calls.length;
    const checkbox = screen
      .getAllByRole("checkbox")
      .find((input) => !(input as HTMLInputElement).checked);
    expect(checkbox).toBeTruthy();
    fireEvent.click(checkbox!);
    await waitFor(() =>
      expect(currentBlock().stateRevision).toBeGreaterThan(1),
    );
    expect(vi.mocked(resolveOPFSBlob).mock.calls.length).toBe(calls);
    const projection = await resolveBlockUiProjectionData(
      structuredClone(currentBlock()),
      "session",
      "message",
    );
    expect(projection.dataset?.rows[0].values.name).toBe("Confidential choice");
    expect(JSON.stringify(projection.sourceSummary)).not.toContain(
      "private.json",
    );
  });
  it("removes data and rejects old callbacks immediately after attachment revocation", async () => {
    render(<Harness />);
    await screen.findByText("Confidential choice");
    await waitFor(() => expect(currentBlock().sourceBindings).toHaveLength(1));
    const oldCheckbox = screen.getAllByRole("checkbox")[0];
    const revision = currentBlock().stateRevision;
    act(() => {
      const input = useChatStore.getState().activeMessages[0];
      useChatStore.getState().updateMessage("session", "input", {
        attachments: input.attachments!.map((attachment) => ({
          ...attachment,
          localFileMissing: true,
        })),
      });
    });
    expect(screen.queryByText("Confidential choice")).toBeNull();
    fireEvent.click(oldCheckbox);
    expect(currentBlock().stateRevision).toBe(revision);
    const projection = await resolveBlockUiProjectionData(
      currentBlock(),
      "session",
      "message",
    );
    expect(projection.dataset).toBeUndefined();
    expect(JSON.stringify(projection.sourceSummary)).not.toContain(
      "Confidential",
    );
  });
  it("discards a pending read even after switching away and back to the same session", async () => {
    let finish!: (blob: Blob) => void;
    vi.mocked(resolveOPFSBlob).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const pending = loadActiveUiSourceContext("session", "message");
    useChatStore.setState({ currentSessionId: "other" });
    useChatStore.setState({ currentSessionId: "session" });
    finish({ size: sourceText.length, text: async () => sourceText } as Blob);
    expect((await pending).materials.size).toBe(0);
  });
  it("discards an in-flight read after a same-session branch/material change", async () => {
    let finish!: (blob: Blob) => void;
    vi.mocked(resolveOPFSBlob).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const pending = loadActiveUiSourceContext("session", "message");
    useChatStore
      .getState()
      .updateMessage("session", "input", { attachments: [] });
    finish({ size: sourceText.length, text: async () => sourceText } as Blob);
    expect((await pending).materials.size).toBe(0);
  });
  it("discards an in-flight read after settings are disabled and re-enabled", async () => {
    let finish!: (blob: Blob) => void;
    vi.mocked(resolveOPFSBlob).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const pending = loadActiveUiSourceContext("session", "message");
    useSettingsStore.setState((state) => ({
      system: { ...state.system, enableIntelligentUi: false },
    }));
    useSettingsStore.setState((state) => ({
      system: { ...state.system, enableIntelligentUi: true },
    }));
    finish({ size: sourceText.length, text: async () => sourceText } as Blob);
    expect((await pending).materials.size).toBe(0);
  });
});

describe("frozen output source authority", () => {
  it("shares a non-current branch without selecting it and rejects revoked material", async () => {
    await install();
    const session = useChatStore.getState().sessions[0];
    const branch = structuredClone(useChatStore.getState().activeMessages);
    stored.set(`session_messages_${session.id}`, branch);
    useChatStore.setState({
      currentSessionId: "other",
      activeMessages: [],
      activeMessageTree: normalizeSessionMessageTree([]),
    });
    const scope = await createFrozenUiSourceScope(session, branch);
    const block = branch[1].outputBlocks![0] as IntelligentUiBlock;
    const projected = await resolveBlockUiProjectionData(
      block,
      session.id,
      branch[1].id,
      "static-original",
      scope,
    );
    expect(JSON.stringify(projected.dataset)).toContain("Confidential choice");
    const { prepareSessionShare, assertPreparedSessionShareValid } =
      await import("@/services/sharing/snapshot");
    const prepared = await prepareSessionShare({
      session,
      messages: branch,
      sourceScope: scope,
    });
    expect(JSON.stringify(prepared.snapshot)).toContain("Confidential choice");
    await assertPreparedSessionShareValid(prepared);
    await scope.assertValid();
    expect(useChatStore.getState().currentSessionId).toBe("other");
    expect(useChatStore.getState().activeMessages).toEqual([]);
    vi.mocked(resolveOPFSBlob).mockResolvedValue(null);
    await expect(scope.assertValid()).rejects.toThrow("UI_SOURCE_STALE");
  });

  it("keeps frozen output valid across ordinary UI state changes", async () => {
    await install();
    const state = useChatStore.getState();
    const scope = await createFrozenUiSourceScope(
      state.sessions[0],
      state.activeMessages,
    );
    await scope.load("message");
    const branch = structuredClone(state.activeMessages);
    const block = branch[1].outputBlocks![0] as IntelligentUiBlock;
    block.state = { local: 123 };
    block.stateRevision++;
    useChatStore.setState({ activeMessages: branch });
    await expect(scope.assertValid()).resolves.toBeUndefined();
  });

  it("includes the latest 24 available aliases after permission filtering", async () => {
    await install();
    const branch: Message[] = Array.from({ length: 26 }, (_, index) => ({
      id: `input-${index}`,
      role: "user",
      content: "",
      timestamp: index,
      attachments: [
        {
          id: `file-${index}`,
          fileName: `dataset-${index}.json`,
          mimeType: "application/json",
          url: `opfs://dataset-${index}`,
          localFileMissing: index === 25,
        },
      ],
    }));
    useChatStore.setState({ activeMessages: branch });
    const prompt = await buildActiveUiSourcePrompt("session");
    expect(prompt).toContain("dataset-24.json");
    expect(prompt).not.toContain("dataset-0.json");
    expect(prompt).not.toContain("dataset-25.json");
  });
});

it("loads referenced Research V1 from the repository without the active task cache", async () => {
  const { createResearchTask } = await import("@/lib/research/task");
  const { getResearchTaskRepository } =
    await import("@/services/research/runtime");
  const { getResearchExtensionRepository } =
    await import("@/services/research/extensionRepository");
  const { useResearchStore } = await import("@/store/core/researchStore");
  const task = createResearchTask({
    id: "task",
    sessionId: "session",
    goal: "Report",
    now: 1,
  });
  task.status = "completed";
  const report = {
    id: "r1",
    version: 1,
    artifactId: "artifact1",
    planVersion: 1,
    researchRunId: "run1",
    createdAt: 1,
    summary: "V1",
    keyFindings: [],
    gaps: [],
    kind: "initial" as const,
    evidenceSnapshotStatus: "available" as const,
  };
  task.reportVersions = [
    report,
    {
      ...report,
      id: "r2",
      version: 2,
      artifactId: "artifact2",
      researchRunId: "run2",
    },
  ];
  const getTask = vi
    .spyOn(getResearchTaskRepository(), "get")
    .mockResolvedValue(task);
  const getSnapshot = vi
    .spyOn(getResearchExtensionRepository(), "get")
    .mockResolvedValue({
      schemaVersion: 1,
      id: "snap1",
      taskId: task.id,
      sessionId: task.sessionId,
      reportId: report.id,
      runId: report.researchRunId,
      artifactId: report.artifactId,
      reportMarkdown: "V1 frozen source",
      gaps: [],
      evidence: [],
      claims: [],
      citations: {},
      createdAt: 1,
      origin: "publication",
    });
  try {
    useResearchStore.setState({ tasksById: {} });
    const message: Message = {
      id: "report-message",
      role: "user",
      content: "",
      timestamp: 1,
      attachments: [
        {
          id: "report",
          mimeType: "text/markdown",
          fileName: "report.md",
          url: report.artifactId,
          intelligentUiSource: {
            kind: "report",
            taskId: task.id,
            reportId: report.id,
            version: 1,
            artifactId: report.artifactId,
          },
        },
      ],
    };
    useChatStore.setState({
      activeMessages: [message],
      activeMessageTree: normalizeSessionMessageTree([message]),
    });
    const scope = await createFrozenUiSourceScope(
      useChatStore.getState().sessions[0],
      [message],
    );
    const context = await scope.load(message.id);
    expect(
      [...context.materials.values()].find(
        (material) => material.kind === "report",
      )?.content,
    ).toBe("V1 frozen source");
    expect(getTask).toHaveBeenCalledWith("task");
    expect(getSnapshot).toHaveBeenCalledWith("evidence_snapshot", "r1");
    await scope.assertValid();
    const active = await loadActiveUiSourceContext("session", message.id);
    expect(
      [...active.materials.values()].find(
        (material) => material.kind === "report",
      )?.content,
    ).toBe("V1 frozen source");
    const activeScope = await createActiveUiSourceScope("session", message.id);
    getSnapshot.mockResolvedValue(null);
    await expect(activeScope.assertValid()).rejects.toThrow("UI_SOURCE_STALE");
  } finally {
    getTask.mockRestore();
    getSnapshot.mockRestore();
  }
});

it("prepares source data and tool-group results for the same knowledge/copy boundary", async () => {
  const { prepareMessageUiForStatic, projectMessageUiForExport } =
    await import("@/lib/chat/intelligentUiPortability");
  const call: ToolCall = {
    id: "search",
    name: "web_search",
    args: {},
    status: "success",
    result: {
      ok: true,
      trust: "external_untrusted",
      provenance: { origin: "builtin", toolName: "web_search" },
      data: {
        sources: [
          {
            title: "Verified tool projection",
            url: "https://example.com/",
            snippet: "Result",
          },
        ],
      },
    },
  };
  call.intelligentUiResult = await captureToolResultView({
    callId: call.id,
    toolName: call.name,
    retrievedAt: 1,
    result: call.result,
  });
  const branch = structuredClone(useChatStore.getState().activeMessages);
  branch[1].outputBlocks!.push({
    id: "tool-group",
    type: "tool_group",
    toolCalls: [call],
  });
  useChatStore.setState({
    activeMessages: branch,
    activeMessageTree: normalizeSessionMessageTree(branch),
  });
  expect(call.intelligentUiResult).toBeDefined();
  const diagnosticScope = await createFrozenUiSourceScope(
    useChatStore.getState().sessions[0],
    branch,
  );
  expect(
    [...(await diagnosticScope.load("message")).materials.values()].find(
      (material) => material.kind === "tool",
    )?.access,
  ).toBe("allowed");
  const { readSessionForPresentation } =
    await import("@/lib/chat/readSessionForPresentation");
  const normalized = await readSessionForPresentation(
    useChatStore.getState().sessions[0],
  );
  const normalizedScope = await createFrozenUiSourceScope(
    normalized,
    normalized.messages,
  );
  expect(
    [...(await normalizedScope.load("message")).materials.values()].find(
      (material) => material.kind === "tool",
    )?.access,
  ).toBe("allowed");
  const prepared = await prepareMessageUiForStatic(branch[1], "session", {
    purpose: "static-original",
  });
  const content = await projectMessageUiForExport(branch[1], "session", {
    purpose: "static-original",
  });
  expect(content).toContain("Confidential choice");
  expect(content).toContain("Verified tool projection");
  expect(
    prepared.outputBlocks
      ?.filter((block) => block.type === "text")
      .map((block) => block.content)
      .join("\n\n"),
  ).toBe(content);
});

it("does not load historical OPFS sources for plain text exports", async () => {
  const { prepareMessageUiForStatic } =
    await import("@/lib/chat/intelligentUiPortability");
  const read = vi.mocked(resolveOPFSBlob);
  read.mockClear();
  const plain: Message = {
    id: "plain",
    role: "model",
    content: "Plain answer",
    timestamp: 3,
  };
  const output = await prepareMessageUiForStatic(plain, "session", {
    purpose: "static-original",
  });
  expect(JSON.stringify(output)).toContain("Plain answer");
  expect(read).not.toHaveBeenCalled();
});

it("default tool-only share enforces host plugin permission", async () => {
  const call: ToolCall = {
    id: "disabled-call",
    name: "private_table",
    args: {},
    status: "success",
    pluginId: "disabled-plugin",
    functionFingerprint: "captured-fingerprint",
    result: {
      ok: true,
      trust: "external_untrusted",
      provenance: { origin: "plugin", toolName: "private_table" },
      data: {
        intelligentUiFormat: "table-v1",
        columns: [{ id: "secret", label: "Secret", type: "text" }],
        rows: [{ id: "row", values: { secret: "revoked-private-data" } }],
      },
    },
  };
  call.intelligentUiResult = await captureToolResultView({
    callId: call.id,
    toolName: call.name,
    pluginId: call.pluginId,
    definitionFingerprint: call.functionFingerprint,
    retrievedAt: 1,
    result: call.result,
    outputSchemaValidated: true,
    outputSchema: {
      properties: { intelligentUiFormat: { const: "table-v1" } },
    },
  });
  expect(call.intelligentUiResult).toBeDefined();
  const branch: Message[] = [
    {
      id: "model",
      role: "model",
      content: "",
      timestamp: 1,
      outputBlocks: [{ id: "tools", type: "tool_group", toolCalls: [call] }],
    },
  ];
  useChatStore.setState({
    activeMessages: branch,
    activeMessageTree: normalizeSessionMessageTree(branch),
  });
  useSettingsStore.setState({ activePlugins: [], installedPlugins: [] });
  const { prepareSessionShare } = await import("@/services/sharing/snapshot");
  const { readSessionForPresentation } =
    await import("@/lib/chat/readSessionForPresentation");
  const session = await readSessionForPresentation(
    useChatStore.getState().sessions[0],
  );
  const normalizedBranch = session.messages;
  const unchecked = await prepareSessionShare({
    session,
    messages: normalizedBranch,
  });
  expect(JSON.stringify(unchecked.snapshot)).not.toContain(
    "revoked-private-data",
  );
  const scope = await createFrozenUiSourceScope(session, normalizedBranch);
  const checked = await prepareSessionShare({
    session,
    messages: normalizedBranch,
    sourceScope: scope,
  });
  expect(JSON.stringify(checked.snapshot)).not.toContain(
    "revoked-private-data",
  );
});

it("reloads mounted source data and invalidates leases on repository mutation", async () => {
  const { createMemoryResearchExtensionRepository } =
    await import("@/services/research/extensionRepository");
  const { getActiveUiSourceContextKey } =
    await import("@/lib/intelligentUi/sourceContext");
  render(<Harness />);
  await waitFor(() => expect(currentBlock().sourceBindings).toHaveLength(1));
  const key = getActiveUiSourceContextKey("session", "message");
  const read = vi.mocked(resolveOPFSBlob);
  read.mockClear();
  await act(async () => {
    await createMemoryResearchExtensionRepository().remove(
      "evidence_snapshot",
      "revoked",
    );
  });
  expect(getActiveUiSourceContextKey("session", "message")).not.toBe(key);
  await waitFor(() => expect(read).toHaveBeenCalled());
});

it("dispatch source validation accepts only this turn's suffix after the frozen original branch", async () => {
  const original = useChatStore.getState().activeMessages;
  // Sending from an older UI must preserve later original messages too.
  const later: Message = {
    id: "later",
    role: "user",
    content: "Later",
    timestamp: 4,
  };
  useChatStore.setState({ activeMessages: [...original, later] });
  const scope = await createActiveUiSourceScope("session", "message");
  const user: Message = {
    id: "new-user",
    role: "user",
    content: "Ask",
    timestamp: 5,
  };
  const bot: Message = {
    id: "new-bot",
    role: "model",
    content: "",
    timestamp: 6,
  };
  useChatStore.setState({ activeMessages: [...original, later, user, bot] });
  await expect(
    scope.assertDispatchValid([user.id, bot.id]),
  ).resolves.toBeUndefined();
  await expect(scope.assertValid()).rejects.toThrow("UI_SOURCE_STALE");
  vi.mocked(resolveOPFSBlob).mockImplementationOnce(async () => {
    useChatStore.setState({
      activeMessages: [
        ...original,
        later,
        user,
        {
          ...bot,
          toolCalls: [
            {
              id: "tool",
              name: "web_search",
              args: {},
              status: "success",
              result: "new suffix only",
            },
          ],
        },
      ],
    });
    return new Blob([sourceText]);
  });
  await expect(
    scope.assertDispatchValid([user.id, bot.id]),
  ).resolves.toBeUndefined();
  useChatStore.setState({
    activeMessages: [...original, later, user, bot, { ...user, id: "foreign" }],
  });
  await expect(scope.assertDispatchValid([user.id, bot.id])).rejects.toThrow(
    "UI_SOURCE_STALE",
  );
});

it("closes a persistent source viewer immediately when its source is revoked", async () => {
  render(
    <NextIntlClientProvider locale="en" messages={{ IntelligentUi: messages }}>
      <IntelligentUiDisplayProvider>
        <Harness />
        <IntelligentUiViewer onLocate={vi.fn()} />
      </IntelligentUiDisplayProvider>
    </NextIntlClientProvider>,
  );
  await waitFor(() => expect(currentBlock().sourceBindings).toHaveLength(1));
  fireEvent.click(screen.getByRole("button", { name: "Open in viewer" }));
  await screen.findByTestId("intelligent-ui-viewer");
  act(() => {
    void useChatStore
      .getState()
      .updateMessage("session", "input", { attachments: [] });
  });
  expect(screen.queryByTestId("intelligent-ui-viewer")).toBeNull();
  await waitFor(() =>
    expect(screen.queryAllByText("Confidential choice")).toHaveLength(0),
  );
});

it("keeps a source owner and its dispatch scope valid while appending its own user and model messages", async () => {
  render(
    <NextIntlClientProvider locale="en" messages={{ IntelligentUi: messages }}>
      <IntelligentUiDisplayProvider>
        <Harness />
        <IntelligentUiViewer onLocate={vi.fn()} />
      </IntelligentUiDisplayProvider>
    </NextIntlClientProvider>,
  );
  await waitFor(() => expect(currentBlock().sourceBindings).toHaveLength(1));
  fireEvent.click(screen.getByRole("button", { name: "Open in viewer" }));
  await screen.findByTestId("intelligent-ui-viewer");
  const scope = await createActiveUiSourceScope("session", "message");
  await act(async () => {
    await useChatStore.getState().addMessage("session", {
      id: "host-user",
      role: "user",
      content: "Explain current result",
      timestamp: 3,
    });
    await useChatStore.getState().addMessage("session", {
      id: "host-model",
      role: "model",
      content: "",
      timestamp: 4,
    });
    await scope.assertDispatchValid(["host-user", "host-model"]);
  });
  expect(screen.getByTestId("intelligent-ui-viewer")).toBeTruthy();
  expect(screen.getAllByText("Confidential choice").length).toBeGreaterThan(0);
  act(() => {
    void useChatStore
      .getState()
      .updateMessage("session", "input", { attachments: [] });
  });
  expect(screen.queryByTestId("intelligent-ui-viewer")).toBeNull();
});
