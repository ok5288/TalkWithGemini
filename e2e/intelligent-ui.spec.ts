import { expect, test, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import {
  EXPLORER_TRAVEL_EXAMPLE,
  EXPLORER_TRAVEL_V2_EXAMPLE,
} from "../src/lib/intelligentUi/explorer/example";
import type { Message } from "../src/types";

const sessionId = "intelligent-ui-viewer-session";
const messageId = "intelligent-ui-viewer-message";
const model = "ui-provider:ui-model";
const persisted = (state: Record<string, unknown>) =>
  JSON.stringify({ state, version: 6 });

async function put(page: Page, key: string, value: unknown) {
  await page.evaluate(
    async ({ key, value }) => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("neo-chat");
        request.onupgradeneeded = () => {
          if (!request.result.objectStoreNames.contains("app_data"))
            request.result.createObjectStore("app_data");
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction("app_data", "readwrite");
        transaction.objectStore("app_data").put(value, key);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
      });
      database.close();
    },
    { key, value },
  );
}

async function seed(
  page: Page,
  blocks: Array<Record<string, unknown>>,
  content = "",
  input?: Message,
) {
  await page.route("https://model.example.test/**", (route) => route.abort());
  await page.goto("/manifest.webmanifest");
  await page.evaluate(
    (value) => {
      localStorage.setItem("neo-chat-core-settings", value);
    },
    persisted({
      theme: "light",
      language: "en",
      defaultModels: {},
      providers: [
        {
          id: "ui-provider",
          name: "UI fixture",
          type: "OpenAI Compatible",
          baseUrl: "https://model.example.test/v1",
          apiKey: "",
          enabled: true,
          models: ["ui-model"],
          modelsList: ["ui-model"],
        },
      ],
    }),
  );
  await put(
    page,
    "neo-chat-settings",
    persisted({
      system: {
        enableIntelligentUi: true,
        enableAutoTitle: false,
        enableRelatedQuestions: false,
        enableAutoCompression: false,
      },
    }),
  );
  await put(
    page,
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
  );
  await put(
    page,
    "neo-chat-storage",
    persisted({
      sessions: [
        {
          id: sessionId,
          title: "Intelligent UI viewer fixture",
          messageCount: input ? 2 : 1,
          updatedAt: Date.now(),
          model,
        },
      ],
      workspaces: [],
      currentSessionId: sessionId,
      selectedModel: model,
      chatConfig: { useSearch: false, useRAG: false },
    }),
  );
  await put(page, `session_messages_${sessionId}`, {
    nodesById: {
      ...(input
        ? {
            [input.id]: {
              id: input.id,
              message: input,
              childMessageIds: [messageId],
              activeChildMessageId: messageId,
            },
          }
        : {}),
      [messageId]: {
        id: messageId,
        message: {
          id: messageId,
          role: "model",
          content,
          timestamp: Date.now(),
          outputBlocks: blocks,
        },
        childMessageIds: [],
        ...(input ? { parentMessageId: input.id } : {}),
      },
    },
    rootMessageIds: [input?.id ?? messageId],
    activeRootMessageId: input?.id ?? messageId,
  });
  await page.goto("/");
  await page
    .getByRole("button", {
      name: "Intelligent UI viewer fixture",
      exact: true,
    })
    .click();
  await expect(page.locator(`[data-message-id="${messageId}"]`)).toBeVisible();
}

function block(definition: Record<string, unknown>) {
  return {
    id: "viewer-block",
    type: "intelligent_ui",
    schemaVersion: 1,
    renderer: "html",
    definition,
    definitionRevision: 1,
    status: "ready",
    fallbackMarkdown: definition.summary,
    state: {},
    stateRevision: 0,
    staticSnapshot: "",
    sourceRefs: [],
  };
}

const counter = {
  version: 1,
  title: "Viewer counter",
  summary: "Local counter fixture.",
  html: `<label for="count">Count</label><input id="count" type="number">
<output id="epoch"></output><script>
const input = document.getElementById("count");
input.value = String(window.intelligentUi.initialState.count ?? 2);
document.getElementById("epoch").textContent = String(Math.random());
function save() {
  window.intelligentUi.setState({ count: Number(input.value) });
  window.intelligentUi.reportSnapshot("Count: " + input.value);
}
input.addEventListener("input", save); save();
</script>`,
};

test("moves one HTML runtime, restores flushed state and retains it across responsive layouts", async ({
  page,
}, testInfo) => {
  await seed(page, [block(counter)]);
  const frame = () => page.frameLocator('iframe[title="Viewer counter"]');
  await expect(frame().getByLabel("Count")).toHaveValue("2");
  await frame().getByLabel("Count").fill("7");
  await page
    .getByRole("button", { name: "Open in viewer", exact: true })
    .click();
  const viewer = page.getByTestId("intelligent-ui-viewer");
  await expect(viewer).toBeVisible();
  await expect(page.locator('iframe[title="Viewer counter"]')).toHaveCount(1);
  await expect(frame().getByLabel("Count")).toHaveValue("7");
  const epoch = await frame().locator("#epoch").textContent();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(viewer).toBeVisible();
  await expect(viewer).toHaveAttribute("role", "dialog");
  await expect(viewer).toHaveAttribute("aria-modal", "true");
  await expect(frame().locator("#epoch")).toHaveText(epoch!);
  expect(
    await page
      .locator('textarea[name="message"]')
      .evaluate((element) => !!element.closest("[inert]")),
  ).toBe(true);
  await frame().getByLabel("Count").focus();
  for (let index = 0; index < 7; index++) {
    await page.keyboard.press("Tab");
    expect(
      await viewer.evaluate((element) =>
        element.contains(document.activeElement),
      ),
    ).toBe(true);
  }
  await frame().getByLabel("Count").focus();
  await page.keyboard.press("Shift+Tab");
  expect(
    await viewer.evaluate((element) =>
      element.contains(document.activeElement),
    ),
  ).toBe(true);
  const width = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(width.scroll).toBeLessThanOrEqual(width.client);
  await testInfo.attach("intelligent-ui-mobile-viewer", {
    body: await page.screenshot({
      path: process.env.NEO_CHAT_UI_REVIEW_SCREENSHOT,
    }),
    contentType: "image/png",
  });
  await frame().getByLabel("Count").fill("11");
  await frame().getByLabel("Count").focus();
  await page.keyboard.press("Escape");
  await expect(viewer).toHaveCount(0);
  await expect(page.locator('iframe[title="Viewer counter"]')).toHaveCount(1);
  await expect(frame().getByLabel("Count")).toHaveValue("11");
  await expect(page.locator("body")).not.toHaveAttribute("inert", "");
  await expect
    .poll(() =>
      page.evaluate(() => {
        const active = document.activeElement;
        return !!active?.closest("[data-ui-viewer-origin]");
      }),
    )
    .toBe(true);
});

test("host explanation keeps the draft and freezes visible results until manual send", async ({
  page,
}) => {
  const requests: Array<{ newMessage: string }> = [];
  await page.route("**/api/chat", async (route) => {
    requests.push(route.request().postDataJSON());
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: 'data: {"type":"content","content":"Fixture explanation."}\n\ndata: {"type":"done"}\n\n',
    });
  });
  await seed(page, [block(counter)]);
  const frame = page.frameLocator('iframe[title="Viewer counter"]');
  await expect(frame.getByLabel("Count")).toHaveValue("2");
  const composer = page.locator('textarea[name="message"]');
  await composer.fill("Existing draft");
  await frame.getByLabel("Count").fill("21");
  await page
    .getByRole("button", { name: "Explain current result", exact: true })
    .click();
  await expect(composer).toHaveValue(/Existing draft/);
  await expect(composer).toBeFocused();
  expect(requests).toHaveLength(0);
  await frame.getByLabel("Count").fill("22");
  await composer.fill("Explain the captured result in detail");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(
    page.getByText("Fixture explanation.", { exact: true }),
  ).toBeVisible();
  expect(requests).toHaveLength(1);
  expect(requests[0].newMessage).toContain(
    "Explain the captured result in detail",
  );
  expect(requests[0].newMessage).toContain("Count: 21");
  expect(requests[0].newMessage).not.toContain("Count: 22");
});

test("offers manual repair for uniquely located malformed content without executing it", async ({
  page,
}) => {
  const malformed =
    '```intelligent-ui\n{"version":1,"kind":"checklist",broken}\n```';
  await seed(
    page,
    [
      {
        ...block({}),
        id: "fixture-text-ui-0",
        renderer: "native",
        definition: null,
        status: "failed",
        fallbackMarkdown: "Incomplete fixture",
        diagnostic: { code: "invalid_json" },
      },
    ],
    malformed,
  );
  await expect(
    page.getByText("The interface contains invalid JSON.", { exact: true }),
  ).toBeVisible();
  await expect(page.locator("iframe")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Request repair", exact: true })
    .click();
  await expect(page.locator('textarea[name="message"]')).not.toHaveValue("");
  await expect(page.locator('textarea[name="message"]')).toBeFocused();
  await expect(
    page.getByRole("button", { name: "Send message", exact: true }),
  ).toBeEnabled();
});

test("keeps an unconfirmed import in its owner until explicitly cancelled", async ({
  page,
}) => {
  await seed(page, [
    {
      ...block(EXPLORER_TRAVEL_EXAMPLE as unknown as Record<string, unknown>),
      renderer: "native",
    },
  ]);
  await page.getByRole("button", { name: "Import data", exact: true }).click();
  await page
    .getByLabel("Paste data", { exact: true })
    .fill("invalid unconfirmed data");
  await page
    .getByRole("button", { name: "Open in viewer", exact: true })
    .click();
  await expect(page.getByTestId("intelligent-ui-viewer")).toHaveCount(0);
  await expect(page.getByLabel("Paste data", { exact: true })).toHaveValue(
    "invalid unconfirmed data",
  );
  await page
    .getByRole("button", { name: "Cancel import", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Open in viewer", exact: true })
    .click();
  await expect(page.getByTestId("intelligent-ui-viewer")).toBeVisible();
  await page
    .getByRole("button", { name: "Locate message", exact: true })
    .click();
  await expect(page.locator(`[data-message-id="${messageId}"]`)).toBeVisible();
});

test("a source-backed viewer can send a host request without revoking itself on appended messages", async ({
  page,
}) => {
  const definition = structuredClone(EXPLORER_TRAVEL_EXAMPLE);
  if (definition.props.dataset.kind !== "inline")
    throw Error("Expected inline fixture");
  const dataset = JSON.stringify(definition.props.dataset.data);
  const hash = (text: string) =>
    createHash("sha256").update(text).digest("hex");
  const version = hash(dataset);
  const alias = `source-${hash(`${sessionId}\u0000source-input:attachment:data\u0000${version}`).slice(0, 16)}`;
  definition.props.dataset = { kind: "context", alias, version };
  definition.props.provenance = "source";
  let requests = 0;
  await page.route("**/api/chat", async (route) => {
    requests++;
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: 'data: {"type":"content","content":"Source fixture explanation."}\n\ndata: {"type":"done"}\n\n',
    });
  });
  await seed(
    page,
    [
      {
        ...block(definition as unknown as Record<string, unknown>),
        renderer: "native",
      },
    ],
    "",
    {
      id: "source-input",
      role: "user",
      content: "Explore the supplied travel data.",
      timestamp: 1,
      attachments: [
        {
          id: "data",
          fileName: "travel.json",
          mimeType: "application/json",
          data: Buffer.from(dataset).toString("base64"),
        },
      ],
    },
  );
  await expect(
    page.getByRole("checkbox", { name: "Select row b", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Open in viewer", exact: true })
    .click();
  const viewer = page.getByTestId("intelligent-ui-viewer");
  await expect(viewer).toBeVisible();
  await viewer
    .getByRole("checkbox", { name: "Select row b", exact: true })
    .check();
  await viewer
    .getByRole("button", { name: "Explain current result", exact: true })
    .click();
  const composer = page.locator('textarea[name="message"]');
  await expect(composer).not.toHaveValue("");
  expect(requests).toBe(0);
  await composer.fill("Explain my selected travel option.");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(
    page.getByText("Source fixture explanation.", { exact: true }),
  ).toBeVisible();
  expect(requests).toBe(1);
  await expect(viewer).toBeVisible();
  await expect(
    viewer.getByRole("checkbox", { name: "Select row b", exact: true }),
  ).toBeChecked();
});

test("Explorer v2 keeps both charts and metrics linked to the same filtered dataset", async ({
  page,
}, testInfo) => {
  await seed(page, [
    {
      ...block(
        EXPLORER_TRAVEL_V2_EXAMPLE as unknown as Record<string, unknown>,
      ),
      renderer: "native",
    },
  ]);
  const total = page.getByRole("region", {
    name: "Total by option",
    exact: true,
  });
  const person = page.getByRole("region", {
    name: "Cost per person",
    exact: true,
  });
  await expect(total.locator("canvas").first()).toBeVisible();
  await expect(person.locator("canvas").first()).toBeVisible();
  await page.getByLabel("Nights", { exact: true }).fill("3");
  await expect(
    page.getByRole("checkbox", { name: "Select row a", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("checkbox", { name: "Select row b", exact: true })
    .check();
  const metrics = page.getByRole("region", {
    name: "Calculated metrics",
    exact: true,
  });
  await expect(metrics).toContainText("460");
  const table = page.getByRole("table").first();
  await expect(table).toContainText("230");
  const before = await person
    .locator("canvas")
    .first()
    .evaluate((element) => (element as HTMLCanvasElement).toDataURL());
  await page.getByLabel("People", { exact: true }).fill("4");
  await expect(table).toContainText("115");
  await expect(metrics).toContainText("460");
  await expect
    .poll(() =>
      person
        .locator("canvas")
        .first()
        .evaluate((element) => (element as HTMLCanvasElement).toDataURL()),
    )
    .not.toBe(before);
  await expect(total.locator("canvas").first()).toBeVisible();
  await testInfo.attach("intelligent-ui-explorer-v2", {
    body: await page.screenshot({
      path: process.env.NEO_CHAT_UI_EXPLORER_REVIEW_SCREENSHOT,
    }),
    contentType: "image/png",
  });
  await page
    .getByRole("button", { name: "Open in viewer", exact: true })
    .click();
  const viewer = page.getByTestId("intelligent-ui-viewer");
  await expect(
    viewer
      .getByRole("region", { name: "Cost per person", exact: true })
      .locator("canvas")
      .first(),
  ).toBeVisible();
  await expect(
    viewer.getByRole("checkbox", { name: "Select row b", exact: true }),
  ).toBeChecked();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(viewer).toHaveAttribute("aria-modal", "true");
  const size = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(size.scroll).toBeLessThanOrEqual(size.client);
});
