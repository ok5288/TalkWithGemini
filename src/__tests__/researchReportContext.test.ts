import { beforeEach, describe, expect, it, vi } from "vitest";
import { projectResearchReportContext } from "@/lib/research/reportContext";
import {
  createResearchTask,
  type ResearchTask,
  type ResearchReportVersion,
} from "@/lib/research";
import type { Message } from "@/types";
const mocks = vi.hoisted(() => ({
  tasks: {} as Record<string, ResearchTask>,
  read: vi.fn(),
  load: vi.fn(),
}));
vi.mock("@/store/core/researchStore", () => ({
  useResearchStore: {
    getState: () => ({ tasksById: mocks.tasks, loadSessionTasks: mocks.load }),
  },
}));
vi.mock("@/utils/opfs", () => ({ resolveOPFSBlob: mocks.read }));
import { resolveResearchReportHistory } from "@/lib/research/runtime/reportContext";
const report = {
  id: "report",
  version: 1,
  artifactId: "artifact",
  summary: "Summary",
  keyFindings: ["Finding"],
  gaps: ["Gap"],
} as ResearchReportVersion;
const message = (id: string): Message => ({
  id,
  role: "model",
  content: "card",
  timestamp: 1,
  outputBlocks: [{ id: "block", type: "research_task", taskId: id }],
});
const task = (id: string, sessionId = "session"): ResearchTask => ({
  ...createResearchTask({ id, sessionId, goal: "Research" }),
  status: "completed",
  reportVersions: [report],
  activeReportVersion: 1,
});

describe("report follow-up context", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.tasks = {};
    mocks.read.mockResolvedValue(new Blob(["# Report\n\nBody"]));
  });
  it("retains source appendices and reference definitions", () => {
    const value = projectResearchReportContext(
      "## Key findings\n\nA [finding][ref].\n\n## Sources\n\nLong appendix\n\n[ref]: https://example.com",
      report,
    );
    expect(value).toContain("[ref]: https://example.com");
    expect(value).toContain("Long appendix");
  });
  it("retains the URL mapping for standard source markers", () => {
    const markdown =
      "## Key findings\n\nSupported finding [Source 1].\n\n## Sources\n\n[Source 1] https://example.com/evidence";
    expect(projectResearchReportContext(markdown, report)).toBe(markdown);
  });
  it("bounds oversized reports using summary, findings and gaps", () => {
    const value = projectResearchReportContext("x".repeat(25_000), report);
    expect(value).toContain("Research report version 1");
    expect(value).toContain("do not invent source links");
    expect(value).toContain("Summary");
    expect(value).toContain("Finding");
    expect(value).toContain("Gap");
    expect(value.length).toBeLessThanOrEqual(24_000);
  });
  it("loads only completed cards on this session's supplied branch", async () => {
    mocks.tasks = {
      visible: task("visible"),
      hidden: task("hidden"),
      foreign: task("foreign", "other"),
      running: { ...task("running"), status: "researching" },
    };
    const result = await resolveResearchReportHistory(
      [message("visible"), message("foreign"), message("running")],
      "session",
    );
    expect(mocks.read).toHaveBeenCalledTimes(1);
    expect(result[0].content).toContain("Body");
    expect(result[1].content).toBe("card");
    expect(result[2].content).toBe("card");
  });
  it("falls back when the artifact is unavailable and stays lazy without cards", async () => {
    mocks.tasks = { visible: task("visible") };
    mocks.read.mockRejectedValue(new Error("missing"));
    expect(
      (await resolveResearchReportHistory([message("visible")], "session"))[0]
        .content,
    ).toContain("Gap");
    vi.clearAllMocks();
    await resolveResearchReportHistory([], "session");
    expect(mocks.load).not.toHaveBeenCalled();
  });
  it("discards storage results if continuation starts while reading", async () => {
    mocks.tasks = { visible: task("visible") };
    mocks.read.mockImplementationOnce(async () => {
      mocks.tasks.visible = { ...mocks.tasks.visible, status: "researching" };
      return new Blob(["Stale report"]);
    });
    expect(
      (await resolveResearchReportHistory([message("visible")], "session"))[0]
        .content,
    ).toBe("card");
  });
});
