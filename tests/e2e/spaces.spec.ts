import type { ElectronApplication, Page } from "@playwright/test";
import type { BrowserApi } from "@shared/ipc";
import type { BrowserState, SpaceInput } from "@shared/types";
import { attachedViews, chromeOf, evalInTab, expect, launch, tabUrls, test } from "./fixtures";

async function visit(chrome: Page, url: string, title: string): Promise<void> {
  const address = chrome.getByLabel("Barre d'adresse");
  await address.fill(url);
  await address.press("Enter");
  await expect(chrome.locator(".tab.active .title")).toHaveText(title);
}

const state = (chrome: Page) => chrome.evaluate(() => (globalThis as unknown as { browser: BrowserApi }).browser.getState()) as Promise<BrowserState>;

/** Creates a space through the same IPC as the "+" button (it becomes the shown space). */
async function createSpace(chrome: Page, input: SpaceInput): Promise<string> {
  const space = await chrome.evaluate((input) => (globalThis as unknown as { browser: BrowserApi }).browser.spaces.create(input), input);
  await expect.poll(async () => (await state(chrome)).activeSpaceId).toBe(space!.id);
  return space!.id;
}

/** Native key press through the main process, so menu accelerators fire (see library.spec.ts). */
async function press(app: ElectronApplication, keyCode: string, modifiers: ("control" | "shift" | "alt")[]): Promise<void> {
  await app.evaluate(
    ({ BrowserWindow }, { keyCode, modifiers }) => {
      const contents = BrowserWindow.getAllWindows()[0].webContents;
      contents.sendInputEvent({ type: "keyDown", keyCode, modifiers });
      contents.sendInputEvent({ type: "keyUp", keyCode, modifiers });
    },
    { keyCode, modifiers },
  );
}

test("spaces have their own tabs; switching back and forth shows each space's pages", async ({ app, chrome, server }) => {
  await visit(chrome, server.url("/one"), "Page one");

  await chrome.getByRole("button", { name: "Nouvel espace" }).click();
  const editor = chrome.getByRole("dialog", { name: "Modifier l'espace" });
  await expect(editor).toBeVisible();
  await editor.getByLabel("Nom de l'espace").fill("Travail");
  // Icons are Lucide icons picked from a grid (no emoji), drawn in the theme's colors.
  const icons = editor.getByRole("radiogroup", { name: "Icône" }).getByRole("radio");
  await expect(icons).toHaveCount(32);
  await expect(icons.locator("svg.lucide")).toHaveCount(32);
  await editor.getByRole("radio", { name: "Voyages" }).click();
  await expect(editor.getByRole("radio", { name: "Voyages" })).toHaveAttribute("aria-checked", "true");
  await expect(editor.locator(".preview svg")).toHaveClass(/lucide-plane/);
  await editor.getByRole("button", { name: "Terminé" }).click();
  await expect(editor).toHaveCount(0);

  const spaces = chrome.getByRole("tablist", { name: "Espaces" }).getByRole("tab");
  await expect(spaces).toHaveCount(2);
  await expect(spaces.nth(1)).toHaveAttribute("aria-selected", "true");
  await expect(spaces.nth(0)).toHaveAttribute("data-icon", "circle-user");
  await expect(spaces.nth(1)).toHaveAttribute("data-icon", "plane");
  await expect(spaces.nth(1).locator("svg")).toHaveClass(/lucide-plane/);
  expect((await state(chrome)).spaces.map((space) => space.icon)).toEqual(["circle-user", "plane"]);
  await expect(chrome.locator(".space-name")).toHaveText("Travail");
  // A new space starts on a start page, without the other space's tabs.
  await expect(chrome.locator(".start")).toBeVisible();
  await expect(chrome.locator(".tabs [role=tab]")).toHaveCount(1);
  await expect.poll(() => attachedViews(app)).toEqual([]);
  await visit(chrome, server.url("/two"), "Page two");

  await spaces.nth(0).click();
  await expect(chrome.locator(".tab.active .title")).toHaveText("Page one");
  await expect(chrome.locator(".tabs [role=tab]")).toHaveCount(1);
  await expect.poll(async () => (await attachedViews(app)).map((view) => view.url)).toEqual([server.url("/one")]);

  // Ctrl+Alt+2: the second space, its page is back on screen.
  await press(app, "2", ["control", "alt"]);
  await expect(chrome.locator(".tab.active .title")).toHaveText("Page two");
  await expect.poll(async () => (await attachedViews(app)).map((view) => view.url)).toEqual([server.url("/two")]);
  // Ctrl+Alt+→ wraps around to the first one.
  await press(app, "Right", ["control", "alt"]);
  await expect(chrome.locator(".tab.active .title")).toHaveText("Page one");
});

test("an isolated space has its own cookies, and the same blocker and permission prompts", async ({ app, chrome, server }) => {
  await visit(chrome, server.url("/cookie-default"), "Page cookie-default");
  await evalInTab(app, server.url("/cookie-default"), "document.cookie = 'who=default; path=/'");

  // A shared (non-isolated) space sees the default session's cookies.
  await createSpace(chrome, { name: "Partagé" });
  await visit(chrome, server.url("/cookie-shared"), "Page cookie-shared");
  expect(await evalInTab(app, server.url("/cookie-shared"), "document.cookie")).toBe("who=default");

  await createSpace(chrome, { name: "Conteneur", isolated: true });
  await expect(chrome.locator(".space-title .badge")).toHaveText("Isolé");
  await visit(chrome, server.url("/cookie-isolated"), "Page cookie-isolated");
  expect(await evalInTab(app, server.url("/cookie-isolated"), "document.cookie")).toBe("");
  await evalInTab(app, server.url("/cookie-isolated"), "document.cookie = 'who=isolated; path=/'");
  expect(
    await app.evaluate(({ session, webContents }, url) => {
      const page = webContents.getAllWebContents().find((contents) => contents.getURL() === url)!;
      return page.session !== session.defaultSession;
    }, server.url("/cookie-isolated")),
  ).toBe(true);

  // Hardened like the default session: the test filter list blocks the decoy ads…
  await visit(chrome, server.url("/shields"), "Shields");
  await expect(chrome.locator(".address .shield .count")).toHaveText("2");
  expect(await evalInTab(app, server.url("/shields"), "window.adLoaded === true")).toBe(false);
  // …and permission requests go through the permission bar.
  await visit(chrome, server.url("/permission"), "Permission");
  await evalInTab(
    app,
    server.url("/permission"),
    "Notification.requestPermission().then((result) => (document.title = 'result: ' + result)); true",
  );
  const bar = chrome.getByRole("alertdialog", { name: "Demande d'autorisation" });
  await expect(bar).toContainText("vous envoyer des notifications");
  await bar.getByRole("button", { name: "Bloquer" }).click();
  await expect(chrome.locator(".tab.active .title")).toHaveText("result: denied");

  // The default session never saw the isolated cookie.
  await chrome.getByRole("tablist", { name: "Espaces" }).getByRole("tab").first().click();
  await expect(chrome.locator(".tab.active .title")).toHaveText("Page cookie-default");
  expect(await evalInTab(app, server.url("/cookie-default"), "document.cookie")).toBe("who=default");
});

test("tabs move between spaces, and spaces, tabs and splits survive a restart", async ({ profile, server }) => {
  let app = await launch(profile);
  let chrome = await chromeOf(app);
  await visit(chrome, server.url("/keep"), "Page keep");
  await chrome.getByRole("button", { name: "Nouvel onglet" }).click();
  await visit(chrome, server.url("/moved"), "Page moved");
  const work = await createSpace(chrome, { name: "Travail", icon: "briefcase", color: "#4fc3a1" });
  await visit(chrome, server.url("/work-a"), "Page work-a");
  await chrome.getByRole("button", { name: "Nouvel onglet" }).click();
  await visit(chrome, server.url("/work-b"), "Page work-b");
  const workTabs = (await state(chrome)).tabs.map((tab) => tab.id);
  await chrome.evaluate((id) => (globalThis as unknown as { browser: BrowserApi }).browser.split.open(id), workTabs[0]);
  await expect(chrome.locator(".split-group [role=tab]")).toHaveCount(2);

  // Back to the first space, move "moved" to Travail: same session, the live page moves along.
  await chrome.evaluate((id) => (globalThis as unknown as { browser: BrowserApi }).browser.spaces.switchTo(id), (await state(chrome)).spaces[0].id);
  await expect(chrome.locator(".tab.active .title")).toHaveText("Page moved");
  const moved = (await state(chrome)).activeTabId!;
  const pageId = await app.evaluate(({ webContents }, url) => webContents.getAllWebContents().find((c) => c.getURL() === url)!.id, server.url("/moved"));
  await chrome.evaluate(([tabId, spaceId]) => (globalThis as unknown as { browser: BrowserApi }).browser.tabs.moveToSpace(tabId, spaceId), [moved, work] as const);
  await expect(chrome.locator(".tabs [role=tab]")).toHaveCount(1);
  await expect(chrome.locator(".tab.active .title")).toHaveText("Page keep");
  await chrome.evaluate((id) => (globalThis as unknown as { browser: BrowserApi }).browser.spaces.switchTo(id), work);
  await chrome.locator(".tabs [role=tab]", { hasText: "Page moved" }).click();
  await expect(chrome.locator(".tab.active .title")).toHaveText("Page moved");
  expect(
    await app.evaluate(({ webContents }, url) => webContents.getAllWebContents().find((c) => c.getURL() === url)!.id, server.url("/moved")),
  ).toBe(pageId);
  await app.close();

  app = await launch(profile);
  try {
    chrome = await chromeOf(app);
    const spaces = chrome.getByRole("tablist", { name: "Espaces" }).getByRole("tab");
    await expect(spaces).toHaveCount(2);
    await expect(spaces.nth(1)).toHaveAttribute("aria-label", "Travail");
    await expect(spaces.nth(1)).toHaveAttribute("data-icon", "briefcase");
    await expect(spaces.nth(1)).toHaveAttribute("aria-selected", "true");
    await expect(chrome.locator(".space-name")).toHaveText("Travail");
    await expect(chrome.locator(".tabs [role=tab]")).toHaveCount(3);
    await expect(chrome.locator(".split-group [role=tab]")).toHaveCount(2);
    // The active tab (Page moved) is not in the split: only it loads; the other space waits.
    await expect.poll(() => tabUrls(app)).toEqual([server.url("/moved")]);
    await chrome.locator(".split-group [role=tab]").first().click();
    await expect.poll(async () => (await attachedViews(app)).length).toBe(2);
    // Attached first, then loaded: wait for both split pages to commit their URL.
    await expect
      .poll(async () => (await tabUrls(app)).sort())
      .toEqual([server.url("/moved"), server.url("/work-a"), server.url("/work-b")].sort());
  } finally {
    await app.close();
  }
});

test("split view lays two pages side by side, resizes, and Ctrl+Shift+\\ leaves it", async ({ app, chrome, server }) => {
  await visit(chrome, server.url("/left"), "Page left");
  await chrome.getByRole("button", { name: "Nouvel onglet" }).click();
  await visit(chrome, server.url("/right"), "Page right");
  const { tabs } = await state(chrome);
  await chrome.evaluate((id) => (globalThis as unknown as { browser: BrowserApi }).browser.split.open(id), tabs[0].id);

  const viewport = (await chrome.locator(".viewport").boundingBox())!;
  await expect.poll(async () => (await attachedViews(app)).length).toBe(2);
  let views = (await attachedViews(app)).sort((a, b) => a.x - b.x);
  // Active tab first: the split is [right, left] in pane order.
  expect(views.map((view) => view.url)).toEqual([server.url("/right"), server.url("/left")]);
  const [first, second] = views;
  expect(first.x).toBe(Math.round(viewport.x));
  expect(first.x + first.width).toBeLessThan(second.x);
  expect(second.x + second.width).toBe(Math.round(viewport.x) + Math.round(viewport.width));
  for (const view of views) expect(view.height).toBe(Math.round(viewport.height));
  await expect(chrome.locator(".split-group [role=tab]")).toHaveCount(2);
  await expect(chrome.locator(".split .pane.focused")).toHaveCount(1);
  await expect(chrome.getByRole("separator", { name: "Redimensionner la vue scindée" })).toBeVisible();

  // The divider ratio (as the drag reports it) moves the boundary.
  await chrome.evaluate(() => (globalThis as unknown as { browser: BrowserApi }).browser.split.setRatios(0.3, 0.5));
  await expect.poll(async () => (await attachedViews(app)).sort((a, b) => a.x - b.x)[0].width).toBeLessThan(first.width);

  // Focusing the other pane makes it the active tab (address bar).
  await app.evaluate(({ webContents }, url) => webContents.getAllWebContents().find((c) => c.getURL() === url)!.focus(), server.url("/left"));
  await expect(chrome.locator(".tab.active .title")).toHaveText("Page left");
  await expect(chrome.getByLabel("Barre d'adresse")).toHaveValue(/\/left/);

  await press(app, "\\", ["control", "shift"]);
  await expect.poll(async () => (await attachedViews(app)).length).toBe(1);
  views = await attachedViews(app);
  expect(views[0]).toMatchObject({ url: server.url("/left"), width: Math.round(viewport.width), x: Math.round(viewport.x) });
  await expect(chrome.locator(".split-group")).toHaveCount(0);

  // Same shortcut again: the active tab side by side with the next one.
  await press(app, "\\", ["control", "shift"]);
  await expect.poll(async () => (await attachedViews(app)).length).toBe(2);
});

test("spaces saved with emoji icons by earlier versions get Lucide icons", async ({ profile }) => {
  const { writeFileSync } = await import("node:fs");
  const space = (id: string, name: string, icon: string) => ({ id, name, icon, color: null, isolated: false });
  writeFileSync(
    `${profile}/session.json`,
    JSON.stringify({
      version: 2,
      data: {
        spaces: [space("personal", "Personnel", "🏠"), space("work", "Travail", "💼"), space("odd", "Autre", "🦄")],
        windows: [{ activeSpaceId: "work", spaces: [{ spaceId: "work", tabs: [{ url: "", title: "", favicon: null, pinned: false }], activeIndex: 0 }] }],
      },
    }),
  );
  const app = await launch(profile);
  try {
    const chrome = await chromeOf(app);
    const spaces = chrome.getByRole("tablist", { name: "Espaces" }).getByRole("tab");
    await expect(spaces).toHaveCount(3);
    expect(await spaces.evaluateAll((tabs) => tabs.map((tab) => tab.getAttribute("data-icon")))).toEqual(["circle-user", "briefcase", "star"]);
    await expect(spaces.nth(1).locator("svg")).toHaveClass(/lucide-briefcase/);
    // No emoji left anywhere in the window's UI.
    expect(await chrome.locator("body").innerText()).not.toMatch(/\p{Extended_Pictographic}/u);
  } finally {
    await app.close();
  }
});
