import { describe, expect, it, vi } from "vitest";
import {
  createMessageSourceContext,
  createResearchSourceMaterials,
} from "@/lib/intelligentUi/sources/adapters";
import {
  createUiSourceContext,
  deriveMessageSourceAliases,
  hashUiSourceContent,
  projectUiSources,
  publicUiSourceUrl,
  resolveUiSources,
  revalidateUiSources,
} from "@/lib/intelligentUi/sources/resolver";
import { resolveUiSourceDataset } from "@/lib/intelligentUi/sources/dataset";
import { loadUiResearchSnapshots } from "@/lib/intelligentUi/sources/research";
import { captureToolResultView } from "@/lib/intelligentUi/toolResults/adapters";
import type { UiSourceMaterial } from "@/lib/intelligentUi/sources/types";
import { normalizeUiSourceBindings } from "@/lib/intelligentUi/sources/types";
import type { Message } from "@/lib/chat/types";
import { createResearchTask } from "@/lib/research/task";
import type { ResearchReportVersion } from "@/lib/research/types";
import type { ResearchEvidenceSnapshot } from "@/lib/research/evidenceConversations";

async function fixture(overrides: Partial<UiSourceMaterial> = {}) {
  const material: UiSourceMaterial = {
    sessionId: "session",
    sourceRef: "private-id",
    kind: "attachment",
    title: "/private/name.csv",
    version: "v1",
    content: "name,amount\nTrip,100",
    contentHash: await hashUiSourceContent("name,amount\nTrip,100"),
    capturedAt: 1,
    access: "allowed",
    availability: "available",
    retentionPolicy: "session",
    ...overrides,
  };
  const context = await createUiSourceContext("session", [material]);
  const alias = [...context.materials.keys()][0];
  const bindings = resolveUiSources(
    [{ alias, version: "v1" }],
    context,
    "session",
  );
  return { material, context, alias, bindings };
}
const message = (extra: Partial<Message> = {}): Message => ({
  id: "m",
  role: "user",
  content: "",
  timestamp: 1,
  ...extra,
});

describe("host source bindings", () => {
  it("restores identities without trusting serialized resolution or hidden fields", async () => {
    const { bindings, context } = await fixture();
    const normalized = normalizeUiSourceBindings([
      { ...bindings[0], content: "secret", bindingStatus: "resolved" },
    ]);
    expect(normalized[0].bindingStatus).toBe("unverified");
    expect(normalized[0]).not.toHaveProperty("content");
    expect(revalidateUiSources(normalized, context)[0].bindingStatus).toBe(
      "resolved",
    );
    expect(
      normalizeUiSourceBindings([{ ...bindings[0], contentHash: "fake" }]),
    ).toEqual([]);
  });
  it("hashes exact content and rejects foreign sessions and model authority fields", async () => {
    const { material, context, alias } = await fixture();
    expect(material.contentHash).toHaveLength(64);
    expect(await hashUiSourceContent(material.content!)).toBe(
      material.contentHash,
    );
    expect(
      resolveUiSources([{ alias }], context, "other")[0].bindingStatus,
    ).toBe("unverified");
    expect(
      resolveUiSources(
        [{ alias, bindingStatus: "resolved" } as never],
        context,
        "session",
      )[0].bindingStatus,
    ).toBe("unverified");
    expect(
      (await createUiSourceContext("other", [material])).materials.size,
    ).toBe(0);
  });
  it("refuses forged aliases, versions, locators and persisted hashes", async () => {
    const { context, alias, bindings } = await fixture();
    expect(
      resolveUiSources(
        [{ alias: "source-0000000000000000" }],
        context,
        "session",
      )[0].bindingStatus,
    ).toBe("unavailable");
    const mismatched = resolveUiSources(
      [{ alias, version: "v2" }],
      context,
      "session",
    );
    expect(revalidateUiSources(mismatched, context)[0].bindingStatus).toBe(
      "version-mismatch",
    );
    expect(
      resolveUiSources([{ alias, locator: "page:999" }], context, "session")[0]
        .bindingStatus,
    ).toBe("unverified");
    expect(
      revalidateUiSources(
        [{ ...bindings[0], contentHash: "fake", bindingStatus: "resolved" }],
        context,
      )[0].bindingStatus,
    ).toBe("version-mismatch");
  });
  it("revokes content immediately even with a matching retained hash", async () => {
    const { material, bindings } = await fixture({
      publicMetadata: { title: "Public label" },
    });
    const context = await createUiSourceContext("session", [
      { ...material, access: "denied", retentionPolicy: "fixed-snapshot" },
    ]);
    expect(
      projectUiSources(bindings, context, {
        publicOnly: false,
        includeContent: true,
      }),
    ).toEqual([
      {
        title: "Public label",
        version: "v1",
        url: undefined,
        bindingStatus: "access-denied",
      },
    ]);
  });
  it("only retains unavailable content when the host explicitly allows the fixed snapshot", async () => {
    const { material, bindings } = await fixture();
    const denied = await createUiSourceContext("session", [
      { ...material, availability: "unavailable" },
    ]);
    expect(
      projectUiSources(bindings, denied, {
        publicOnly: false,
        includeContent: true,
      })[0].content,
    ).toBeUndefined();
    const retained = await createUiSourceContext("session", [
      {
        ...material,
        availability: "unavailable",
        retentionPolicy: "fixed-snapshot",
      },
    ]);
    expect(
      projectUiSources(bindings, retained, {
        publicOnly: false,
        includeContent: true,
      })[0].content,
    ).toBe(material.content);
  });
  it("public projection never includes private titles, IDs, locators or body", async () => {
    const { bindings, context } = await fixture({
      locator: "private/path",
      publicMetadata: {
        title: "Dataset",
        url: "https://example.com/data?token=secret",
      },
    });
    const serialized = JSON.stringify(
      projectUiSources(bindings, context, {
        publicOnly: true,
        includeContent: true,
      }),
    );
    expect(serialized).toContain("Dataset");
    for (const secret of ["private", "Trip", "secret", "source-"])
      expect(serialized).not.toContain(secret);
    for (const link of [
      "file:///private",
      "https://localhost/a",
      "https://127.0.0.1/a",
      "https://example.com/a#token",
      "https://user:pass@example.com/a",
    ])
      expect(publicUiSourceUrl(link)).toBeUndefined();
    expect(publicUiSourceUrl("https://example.com/data")).toBe(
      "https://example.com/data",
    );
  });
  it("advertises aliases without internal IDs and resolves exact-version CSV", async () => {
    const { context, alias, material } = await fixture();
    expect(deriveMessageSourceAliases(context)).not.toContain("private-id");
    expect(JSON.parse(deriveMessageSourceAliases(context))[0]).toMatchObject({
      rowCount: 1,
      columns: [{ id: "c1" }, { id: "c2" }],
    });
    expect(deriveMessageSourceAliases(context)).not.toContain("Trip");
    const result = resolveUiSourceDataset(
      { alias, version: "v1" },
      context,
      "session",
    );
    expect(result.dataset?.version).toBe(material.contentHash);
    expect(result.dataset?.rows[0].values).toMatchObject({ c2: 100 });
    expect(
      resolveUiSourceDataset(
        { alias, version: "v2" },
        context,
        "session",
        result.binding,
      ).dataset,
    ).toBeNull();
    expect(
      resolveUiSourceDataset({ alias, version: "v2" }, context, "session")
        .dataset,
    ).toBeNull();
  });
});

describe("actual message source adapters", () => {
  it("decodes inline attachments and treats missing local files as denied", async () => {
    const context = await createMessageSourceContext({
      sessionId: "session",
      messages: [
        message({
          attachments: [
            {
              id: "a",
              mimeType: "text/csv",
              fileName: "data.csv",
              data: btoa("name,amount\nTrip,100"),
            },
            {
              id: "missing",
              mimeType: "text/plain",
              fileName: "lost",
              localFileMissing: true,
            },
          ],
        }),
      ],
    });
    const materials = [...context.materials.values()];
    expect(materials[0].content).toBe("name,amount\nTrip,100");
    expect(materials[1].access).toBe("denied");
  });
  it("denies unavailable knowledge files and separates current extraction versions", async () => {
    const messages = [
      message({
        ragSources: [
          {
            title: "Note",
            url: "knowledge://f",
            content: "A",
            metadata: { fileId: "f", chunkIndex: 2 },
          },
        ],
      }),
    ];
    const missing = await createMessageSourceContext({
      sessionId: "session",
      messages,
    });
    expect([...missing.materials.values()][0].access).toBe("denied");
    const file = {
      id: "f",
      name: "Note",
      size: 1,
      type: "text/plain",
      uploadedAt: 1,
      status: "saved" as const,
    };
    const before = await createMessageSourceContext({
      sessionId: "session",
      messages,
      knowledgeFiles: [file],
    });
    const after = await createMessageSourceContext({
      sessionId: "session",
      messages,
      knowledgeFiles: [{ ...file, contentEditedAt: 2 }],
    });
    expect([...before.materials.values()][0].locator).toBe("chunk:2");
    expect([...before.materials.keys()]).not.toEqual([
      ...after.materials.keys(),
    ]);
  });
  it("only captures successful tools and requires current host permission", async () => {
    const result = {
      ok: true,
      trust: "external_untrusted",
      provenance: { origin: "builtin", toolName: "web_search" },
      data: {
        sources: [
          {
            title: "Trip",
            url: "https://example.com/trip",
            snippet: "Costs",
            token: "secret-token",
          },
        ],
        _meta: { credential: "secret-credential" },
      },
    };
    const descriptor = await captureToolResultView({
      callId: "ok",
      toolName: "web_search",
      retrievedAt: 1,
      result,
    });
    const messages = [
      message({
        toolCalls: [
          {
            id: "ok",
            name: "web_search",
            args: {},
            status: "success",
            result,
            intelligentUiResult: descriptor,
          },
          {
            id: "bad",
            name: "table",
            args: {},
            status: "error",
            result: "secret",
          },
        ],
      }),
    ];
    const denied = await createMessageSourceContext({
      sessionId: "session",
      messages,
    });
    expect(denied.materials.size).toBe(1);
    expect([...denied.materials.values()][0].access).toBe("unknown");
    const allowed = await createMessageSourceContext({
      sessionId: "session",
      messages,
      canAccessTool: () => true,
    });
    const [alias, material] = [...allowed.materials][0];
    expect(material.content).not.toContain("secret");
    expect(material.content).not.toContain("_meta");
    expect(
      resolveUiSourceDataset(
        { alias, version: material.version },
        allowed,
        "session",
      ).dataset?.rows,
    ).toHaveLength(1);
    messages[0].toolCalls![0].intelligentUiResult = undefined;
    expect(
      (
        await createMessageSourceContext({
          sessionId: "session",
          messages,
          canAccessTool: () => true,
        })
      ).materials.size,
    ).toBe(0);
  });
});

describe("published report adapter", () => {
  function reportFixture() {
    const task = createResearchTask({
      id: "task",
      sessionId: "session",
      goal: "Report",
      now: 1,
    });
    task.status = "completed";
    const report: ResearchReportVersion = {
      id: "r1",
      version: 1,
      artifactId: "artifact1",
      planVersion: 1,
      researchRunId: "run1",
      createdAt: 1,
      summary: "V1",
      keyFindings: [],
      gaps: [],
      kind: "initial",
      evidenceSnapshotStatus: "available",
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
    const snapshot: ResearchEvidenceSnapshot = {
      schemaVersion: 1,
      id: "snap1",
      taskId: task.id,
      sessionId: task.sessionId,
      reportId: report.id,
      runId: report.researchRunId,
      artifactId: report.artifactId,
      reportMarkdown: "V1 original",
      gaps: [],
      evidence: [],
      claims: [],
      citations: {},
      createdAt: 1,
      origin: "publication",
    };
    const selected = message({
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
    });
    return { task, report, snapshot, selected };
  }
  it("loads the selected V1 rather than latest V2 and never mutates evidence", async () => {
    const { task, report, snapshot, selected } = reportFixture();
    const before = JSON.stringify(task);
    const read = vi.fn().mockResolvedValue(snapshot);
    const snapshots = await loadUiResearchSnapshots(
      { sessionId: "session", messages: [selected], researchTasks: [task] },
      read,
    );
    expect(read).toHaveBeenCalledExactlyOnceWith("r1");
    const materials = await createResearchSourceMaterials(
      task,
      report,
      snapshots[0],
    );
    expect(materials[0]).toMatchObject({
      version: "1",
      content: "V1 original",
    });
    expect(JSON.stringify(task)).toBe(before);
  });
  it("rejects forged report attachments and foreign sessions before reading storage", async () => {
    const { task, selected } = reportFixture();
    const read = vi.fn();
    expect(
      await loadUiResearchSnapshots(
        { sessionId: "other", messages: [selected], researchTasks: [task] },
        read,
      ),
    ).toEqual([]);
    selected.attachments![0].intelligentUiSource!.version = 99;
    expect(
      await loadUiResearchSnapshots(
        { sessionId: "session", messages: [selected], researchTasks: [task] },
        read,
      ),
    ).toEqual([]);
    expect(read).not.toHaveBeenCalled();
    selected.attachments![0].data = btoa("Old private report");
    const context = await createMessageSourceContext({
      sessionId: "session",
      messages: [selected],
      attachmentTexts: new Map([["report", "Old private report"]]),
    });
    expect(context.materials.size).toBe(0);
  });
  it("does not substitute a different returned report snapshot", async () => {
    const { task, snapshot, selected } = reportFixture();
    const read = vi.fn().mockResolvedValue({ ...snapshot, reportId: "r2" });
    expect(
      await loadUiResearchSnapshots(
        { sessionId: "session", messages: [selected], researchTasks: [task] },
        read,
      ),
    ).toEqual([]);
  });
});
