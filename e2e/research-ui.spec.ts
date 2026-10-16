import {
  expect,
  test,
  type Locator,
  type Page,
  type TestInfo,
} from "@playwright/test";
import { createHash } from "node:crypto";
import { createResearchReportRun } from "../src/lib/research/orchestration/runGraph";
import { createResearchTask } from "../src/lib/research/task";
import type {
  ResearchPlanVersion,
  ResearchTask,
} from "../src/lib/research/types";
import { storedRecordSchema } from "../src/services/research/taskRepository/schema/task";
import {
  DEFAULT_DB_NAME,
  RESEARCH_TASK_STORAGE_VERSION,
  SESSION_INDEX,
  STORE_NAME,
} from "../src/services/research/taskRepository/constants";
import messages from "../src/i18n/locales/en/Research.json" with { type: "json" };
import questions from "../src/i18n/locales/en/EvidenceQuestions.json" with { type: "json" };

test.use({ serviceWorkers: "block" });

const sessionId = "research-ui-session";
const messageId = "research-ui-message";
const taskId = "research-ui-task";
const model = "research-ui-provider:fixture-model";
const title =
  "How do changes in ocean temperatures affect the East Asian monsoon, regional agriculture, water availability, and long-term adaptation decisions across communities with different levels of exposure?";
const now = Date.now() - 60_000;
const persisted = (state: Record<string, unknown>) =>
  JSON.stringify({ state, version: 6 });
const reportMarkdown = `# Monsoon research fixture

## Executive summary
Ocean temperatures influence regional rainfall. This is a local UI fixture.

## Key findings
- Regional effects differ.

## Evidence gaps
Seasonal uncertainty remains.

## Sources
Local fixture source appendix.
`;
const reportFile = `${createHash("sha256").update(reportMarkdown).digest("hex")}.md`;
const artifactId = `opfs://chat/research-artifacts/${reportFile}`;

function makeTask(completed = false): ResearchTask {
  const task = createResearchTask({
    id: taskId,
    sessionId,
    cardMessageId: messageId,
    requestModel: model,
    goal: title,
    now,
  });
  const plan: ResearchPlanVersion = {
    id: "research-ui-plan-1",
    version: 1,
    title,
    summary: "Compare mechanisms, observations, and practical implications.",
    objective: title,
    scope: {
      audience: "General readers",
      includes: ["Regional rainfall"],
      excludes: ["Individual forecasts"],
      allowedSourceTypes: ["web"],
    },
    assumptions: [],
    deliverable: {
      kind: "research_report",
      description: "A concise report",
      requiredSections: ["Executive summary", "Key findings", "Sources"],
    },
    strategy: task.requestedStrategy!,
    recon: {
      status: "skipped",
      sourceFeasibility: "unverified",
      startedAt: now,
      completedAt: now,
      timeoutMs: 30_000,
      queryLimit: 1,
      resultsPerQuery: 3,
      usage: { queryCount: 0, resultCount: 0, wallTimeMs: 0 },
      queries: [],
    },
    steps: [
      "Explain ocean-atmosphere mechanisms",
      "Compare observations and contrasting findings",
      "Summarize uncertainty and adaptation choices",
    ].map((step, index) => ({
      id: `step-${index + 1}`,
      title: step,
      objective: step,
      questions: [step],
      queryTopics: [step],
      sourcePriorities: [{ sourceType: "web", priority: "high" }],
      evidenceCriteria: ["Prefer attributable primary sources"],
      priority: "high",
    })),
    completionCriteria: ["Distinguish evidence from uncertainty"],
    createdAt: now,
  };
  task.status = "plan_ready";
  task.planVersions = [plan];
  task.activePlanVersion = 1;
  task.sourceSnapshot = {
    model,
    approvalMode: "balanced",
    searchEnabled: true,
    toolIds: ["web_search"],
    pluginIds: [],
    skillIds: [],
    knowledgeCollectionIds: [],
    attachmentIds: [],
    workspaceFileIds: [],
    memoryScopes: [],
    memoryScopeIds: {},
    capturedAt: now,
  };
  if (completed) {
    const run = createResearchReportRun({
      id: "research-ui-run",
      taskId,
      plan,
      now,
    });
    run.phase = "completed";
    run.nodes = run.nodes.map((node) => ({ ...node, status: "completed" }));
    run.frontierNodeIds = [];
    run.endedAt = now;
    task.status = "completed";
    task.endedAt = now;
    task.reportRuns = [run];
    task.activeReportRunId = run.id;
    task.reportVersions = [
      {
        id: "research-ui-report",
        version: 1,
        artifactId,
        planVersion: 1,
        researchRunId: run.id,
        createdAt: now,
        summary: "Ocean temperatures influence regional rainfall.",
        keyFindings: ["Regional effects differ."],
        gaps: ["Seasonal uncertainty remains."],
        kind: "initial",
      },
    ];
    task.activeReportVersion = 1;
  }
  return task;
}

function record(task: ResearchTask) {
  return storedRecordSchema.parse({
    storageVersion: RESEARCH_TASK_STORAGE_VERSION,
    taskId: task.id,
    sessionId: task.sessionId,
    updatedAt: task.updatedAt,
    task,
  });
}
// Validate fixtures during Playwright collection, before launching a browser.
const planRecord = record(makeTask());
const completedRecord = record(makeTask(true));

async function seed(page: Page, theme: "light" | "dark", completed = false) {
  const modelRequests: string[] = [];
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.href === "https://basellm.github.io/llm-metadata/api/all.json") {
      await route.fulfill({ json: {} });
    } else if (
      url.pathname === "/api/chat" ||
      url.hostname === "model.example.test"
    ) {
      modelRequests.push(url.href);
      await route.abort();
    } else if (!["127.0.0.1", "localhost"].includes(url.hostname)) {
      await route.abort();
    } else await route.continue();
  });
  await page.goto("/manifest.webmanifest");
  await page.evaluate(
    async (input) => {
      localStorage.setItem("neo-chat-core-settings", input.core);
      const open = (name: string, version?: number) =>
        new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open(name, version);
          request.onupgradeneeded = () => {
            const db = request.result;
            if (name === "neo-chat") db.createObjectStore("app_data");
            else {
              const store = db.createObjectStore(input.store, {
                keyPath: "taskId",
              });
              store.createIndex(input.index, input.index, { unique: false });
            }
          };
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
      const db = await open("neo-chat");
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction("app_data", "readwrite");
        for (const [key, value] of input.entries)
          transaction.objectStore("app_data").put(value, key);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
      });
      db.close();
      const research = await open(input.database, input.version);
      await new Promise<void>((resolve, reject) => {
        const transaction = research.transaction(input.store, "readwrite");
        transaction.objectStore(input.store).put(input.record);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
      });
      research.close();
      if (input.completed) {
        const root = await navigator.storage.getDirectory();
        const chat = await root.getDirectoryHandle("chat", { create: true });
        const artifacts = await chat.getDirectoryHandle("research-artifacts", {
          create: true,
        });
        const file = await artifacts.getFileHandle(input.reportFile, {
          create: true,
        });
        const writer = await file.createWritable();
        await writer.write(input.reportMarkdown);
        await writer.close();
      }
    },
    {
      core: persisted({
        theme,
        language: "en",
        defaultModels: {},
        providers: [
          {
            id: "research-ui-provider",
            name: "Research UI fixture",
            type: "OpenAI Compatible",
            baseUrl: "https://model.example.test/v1",
            apiKey: "",
            enabled: true,
            models: ["fixture-model"],
            modelsList: ["fixture-model"],
          },
        ],
      }),
      entries: [
        [
          "neo-chat-settings",
          persisted({
            customModelMetadata: {
              "fixture-model": {
                id: "fixture-model",
                name: "Fixture Model",
                tool_call: true,
              },
            },
            system: {
              enableAutoTitle: false,
              enableRelatedQuestions: false,
              enableAutoCompression: false,
            },
          }),
        ],
        [
          "neo-chat-memory",
          persisted({
            settings: {
              enabled: false,
              searchEnabled: false,
              autoRecordEnabled: false,
              dreamEnabled: false,
            },
            memories: [],
            dreamStatus: { isRunning: false },
          }),
        ],
        [
          "neo-chat-storage",
          persisted({
            sessions: [
              {
                id: sessionId,
                title: "Research UI fixture",
                messageCount: 1,
                updatedAt: now,
                model,
                config: {
                  chatMode: "research",
                  useDeepResearch: true,
                  useSearch: true,
                },
              },
            ],
            workspaces: [],
            currentSessionId: sessionId,
            selectedModel: model,
            chatConfig: {
              chatMode: "research",
              useDeepResearch: true,
              useSearch: true,
              useRAG: false,
            },
          }),
        ],
        [
          `session_messages_${sessionId}`,
          {
            nodesById: {
              [messageId]: {
                id: messageId,
                message: {
                  id: messageId,
                  role: "model",
                  content: "",
                  timestamp: now,
                  outputBlocks: [
                    { id: "research-ui-block", type: "research_task", taskId },
                  ],
                },
                childMessageIds: [],
              },
            },
            rootMessageIds: [messageId],
            activeRootMessageId: messageId,
          },
        ],
      ] as Array<[string, unknown]>,
      database: DEFAULT_DB_NAME,
      version: RESEARCH_TASK_STORAGE_VERSION,
      store: STORE_NAME,
      index: SESSION_INDEX,
      record: completed ? completedRecord : planRecord,
      completed,
      reportFile,
      reportMarkdown,
    },
  );
  await page.goto("/");
  await openFixtureSession(page);
  const message = page.locator(`[data-message-id="${messageId}"]`);
  await expect(message).toBeVisible();
  return { message, modelRequests };
}

async function openFixtureSession(page: Page) {
  // The shell intentionally opens on the welcome screen after hydration.
  // Desktop expands its sidebar in an effect; narrow screens use the drawer.
  if ((page.viewportSize()?.width ?? 1440) < 1280) {
    await page
      .getByRole("button", { name: "Open sidebar", exact: true })
      .last()
      .click();
  }
  await page
    .getByRole("button", { name: "Research UI fixture", exact: true })
    .click();
}

async function readTask(page: Page) {
  return page.evaluate(
    async ({ database, store, id }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(database);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const value = await new Promise<{ task: ResearchTask }>(
        (resolve, reject) => {
          const request = db
            .transaction(store, "readonly")
            .objectStore(store)
            .get(id);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        },
      );
      db.close();
      return value.task;
    },
    { database: DEFAULT_DB_NAME, store: STORE_NAME, id: taskId },
  );
}

async function noHorizontalOverflow(page: Page, surface: Locator) {
  const viewport = await page.evaluate(() => ({
    width: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(viewport.scroll).toBeLessThanOrEqual(viewport.width + 1);
  expect(
    await surface.evaluate(
      (element) => element.scrollWidth - element.clientWidth,
    ),
  ).toBeLessThanOrEqual(1);
}

async function readWaveCheckpoint(page: Page) {
  const path = (await readTask(page)).checkpoint?.historyPath;
  if (!path) return null;
  return page.evaluate(
    async ({ session, path }) => {
      const segments = ["chat", "workspace", session, ...path.split("/")];
      const name = segments.pop()!;
      let directory = await navigator.storage.getDirectory();
      for (const segment of segments) {
        directory = await directory.getDirectoryHandle(segment);
      }
      const file = await (await directory.getFileHandle(name)).getFile();
      return JSON.parse(await file.text()) as {
        executedQueries?: string[];
        toolCalls?: unknown[];
      };
    },
    { session: sessionId, path },
  );
}

async function capture(page: Page, info: TestInfo, name: string) {
  const path = info.outputPath(`${name}.png`);
  await page.screenshot({ path, fullPage: true, animations: "disabled" });
  await info.attach(name, { path, contentType: "image/png" });
}

for (const theme of ["light", "dark"] as const) {
  test(`research approval is blue in ${theme} and thoroughness persists a real plan version`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const { message, modelRequests } = await seed(page, theme);
    const start = message.getByRole("button", {
      name: messages.actions.start,
      exact: true,
    });
    await expect(start).toBeVisible();
    await expect
      .poll(() =>
        page
          .locator("html")
          .evaluate((element) => element.classList.contains("dark")),
      )
      .toBe(theme === "dark");
    // Color() resolves CSS custom properties and modern color syntax through canvas.
    const [red, green, blue, alpha] = await start.evaluate((element) => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 1;
      const context = canvas.getContext("2d")!;
      context.fillStyle = getComputedStyle(element).backgroundColor;
      context.fillRect(0, 0, 1, 1);
      return Array.from(context.getImageData(0, 0, 1, 1).data);
    });
    expect(alpha).toBe(255);
    expect(blue).toBeGreaterThan(red + 30);
    expect(blue).toBeGreaterThan(green);
    await message
      .getByRole("radio", { name: messages.budget.quick, exact: true })
      .check();
    await expect
      .poll(async () => (await readTask(page)).budgetPreset)
      .toBe("quick");
    const updated = await readTask(page);
    expect(updated.status).toBe("plan_ready");
    expect(updated.activePlanVersion).toBe(2);
    expect(updated.planVersions).toHaveLength(2);
    expect(updated.budget.maxDurationMs).toBeLessThanOrEqual(5 * 60_000);
    expect(updated.budget.maxDurationMs).toBeLessThan(
      planRecord.task.budget.maxDurationMs,
    );
    expect(updated.planVersions[1].strategy.maxQueries).toBeLessThan(
      updated.planVersions[0].strategy.maxQueries,
    );
    await page.reload();
    await openFixtureSession(page);
    await expect(
      message.getByRole("radio", { name: messages.budget.quick, exact: true }),
    ).toBeChecked();
    await expect(start).toBeVisible();
    await capture(page, info, `research-plan-desktop-${theme}`);
    expect(modelRequests).toEqual([]);
  });
}

for (const viewport of [
  { name: "desktop", width: 1440, height: 900 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "mobile", width: 390, height: 844 },
]) {
  test(`research plan and edit sheet remain usable on ${viewport.name} with reduced motion`, async ({
    page,
  }, info) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: "reduce" });
    const { message, modelRequests } = await seed(page, "light");
    await expect(
      message.getByRole("heading", { name: title, exact: true }),
    ).toBeVisible();
    await noHorizontalOverflow(page, message);
    await expect(
      message.getByRole("radio", {
        name: messages.budget.standard,
        exact: true,
      }),
    ).toBeVisible();
    await capture(page, info, `research-plan-${viewport.name}`);
    const edit = message.getByRole("button", {
      name: messages.actions.adjust,
      exact: true,
    });
    await edit.click();
    const dialog = page.getByRole("dialog", {
      name: messages.adjust.title,
      exact: true,
    });
    await expect(dialog).toBeVisible();
    await dialog
      .getByRole("textbox", { name: messages.adjust.label })
      .fill("Focus on regional uncertainty and adaptation choices.");
    await expect(
      dialog.getByRole("button", { name: messages.adjust.submit, exact: true }),
    ).toBeEnabled();
    await noHorizontalOverflow(page, dialog);
    const bounds = await dialog.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width + 1);
    expect(
      await page.evaluate(
        () => matchMedia("(prefers-reduced-motion: reduce)").matches,
      ),
    ).toBe(true);
    await capture(page, info, `research-edit-${viewport.name}`);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(edit).toBeFocused();
    expect((await readTask(page)).activePlanVersion).toBe(1);
    await message
      .getByRole("button", { name: messages.actions.viewProgress, exact: true })
      .click();
    const tabs = page.getByRole("tablist", {
      name: messages.workbench.contentTabs,
    });
    await expect(
      tabs.getByRole("tab", { name: messages.tabs.process, exact: true }),
    ).toHaveAttribute("aria-selected", "true");
    const advanced = page.getByRole("button", {
      name: messages.process.advancedDetails,
      exact: true,
    });
    await advanced.click();
    const contentId = await advanced.getAttribute("aria-controls");
    expect(contentId).toBeTruthy();
    expect(
      await page.evaluate(
        (id) =>
          getComputedStyle(document.getElementById(id!)!).transitionProperty,
        contentId,
      ),
    ).toBe("none");
    await noHorizontalOverflow(page, page.getByRole("tabpanel"));
    expect(modelRequests).toEqual([]);
  });
}

test("saved report opens three tabs and an independently dismissible Q&A sheet", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { message, modelRequests } = await seed(page, "light", true);
  await message.locator("summary").first().click();
  await message
    .getByRole("button", { name: messages.actions.openWorkbench, exact: true })
    .click();
  const tabs = page.getByRole("tablist", {
    name: messages.workbench.contentTabs,
  });
  await expect(tabs.getByRole("tab")).toHaveCount(3);
  await expect(
    tabs.getByRole("tab", { name: messages.tabs.report, exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  const panel = page.getByRole("tabpanel");
  await expect(panel).toContainText("This is a local UI fixture.");
  await expect(panel.getByRole("combobox")).toHaveCount(0);
  await panel
    .getByRole("button", { name: messages.report.notesAndLimits })
    .click();
  await expect(panel).toContainText("Seasonal uncertainty remains.");
  await tabs
    .getByRole("tab", { name: new RegExp(`^${messages.tabs.sources}`) })
    .click();
  await expect(panel).toContainText("Local fixture source appendix.");
  await tabs
    .getByRole("tab", { name: messages.tabs.process, exact: true })
    .click();
  await expect(panel).toContainText("Explain ocean-atmosphere mechanisms");
  await tabs
    .getByRole("tab", { name: messages.tabs.report, exact: true })
    .click();
  await page
    .getByRole("button", { name: messages.actions.askEvidence, exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: questions.title,
    exact: true,
  });
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("textbox", { name: questions.askLabel, exact: true }),
  ).toBeVisible();
  await expect(dialog.getByText(questions.hint, { exact: true })).toBeVisible();
  await expect(
    dialog.getByRole("status", { name: questions.loading, exact: true }),
  ).toHaveCount(0);
  await noHorizontalOverflow(page, dialog);
  await capture(page, info, "research-report-questions-mobile");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(tabs).toBeVisible();
  await capture(page, info, "research-report-mobile");
  expect(modelRequests).toEqual([]);
});

test("a hard refresh retains an in-flight query reservation and rejects replay after manual resume", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const query = "ocean temperature regional monsoon observations";
  const { message } = await seed(page, "light");
  let modelRequests = 0;
  let searchRequests = 0;
  const searchObservation: {
    checkpoint: Awaited<ReturnType<typeof readWaveCheckpoint>>;
  } = { checkpoint: null };
  let duplicateRejected = false;
  let releaseSearch = () => {};
  const searchHeld = new Promise<void>((resolve) => {
    releaseSearch = resolve;
  });
  await page.route("**/api/chat", async (route) => {
    modelRequests += 1;
    if (modelRequests > 2) {
      duplicateRejected = JSON.stringify(
        route.request().postDataJSON(),
      ).includes("RESEARCH_QUERY_DUPLICATE");
      await route.abort();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: [
        {
          type: "tool_call",
          toolCall: {
            id: `in-flight-query-${modelRequests}`,
            name: "web_search",
            args: { query },
            status: "pending",
          },
        },
        { type: "done" },
      ]
        .map((event) => `data: ${JSON.stringify(event)}\n\n`)
        .join(""),
    });
  });
  await page.route("https://api.firecrawl.dev/v2/search", async (route) => {
    searchRequests += 1;
    searchObservation.checkpoint = await readWaveCheckpoint(page);
    await searchHeld;
    await route.abort().catch(() => {});
  });

  try {
    await message
      .getByRole("button", { name: messages.actions.start, exact: true })
      .click();
    await expect
      .poll(() => searchObservation.checkpoint?.executedQueries)
      .toEqual([query]);
    // There is no terminal tool receipt when the browser is refreshed.
    expect(searchObservation.checkpoint?.toolCalls).toEqual([]);
    expect(searchRequests).toBe(1);
    await page.reload();
    releaseSearch();
    await openFixtureSession(page);
    await expect.poll(async () => (await readTask(page)).status).toBe("paused");
    expect(modelRequests).toBe(1);
    expect(searchRequests).toBe(1);
    expect((await readWaveCheckpoint(page))?.executedQueries).toEqual([query]);

    await page
      .locator(`[data-message-id="${messageId}"]`)
      .getByRole("button", {
        name: messages.actions.resume,
        exact: true,
      })
      .click();
    await expect.poll(() => duplicateRejected).toBe(true);
    await expect.poll(async () => (await readTask(page)).status).toBe("paused");
    expect(searchRequests).toBe(1);
    expect((await readWaveCheckpoint(page))?.executedQueries).toEqual([query]);
  } finally {
    releaseSearch();
    await page.unrouteAll({ behavior: "wait" });
  }
});
