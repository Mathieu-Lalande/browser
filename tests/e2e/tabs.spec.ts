import { readdirSync, writeFileSync } from "node:fs";
import type { ElectronApplication, Page } from "@playwright/test";
import type { BrowserApi } from "@shared/ipc";
import type { BrowserState, HistoryEntry, TabId } from "@shared/types";
import { attachedViews, chromeOf, clickInTab, evalInTab, expect, launch, overlayOf, tabUrls, test } from "./fixtures";

type Global = { browser: BrowserApi };
/** Uncaught exceptions of the main process, collected by `watchErrors`. */
type MainGlobal = { mainErrors: string[] };

async function visit(chrome: Page, url: string, title: string): Promise<void> {
  const address = chrome.getByLabel("Barre d'adresse");
  await address.fill(url);
  await address.press("Enter");
  await expect(chrome.locator(".tab.active .title")).toHaveText(title);
}

async function newTab(chrome: Page, url: string, title: string): Promise<void> {
  await chrome.getByRole("button", { name: "Nouvel onglet" }).click();
  await visit(chrome, url, title);
}

const state = (chrome: Page) => chrome.evaluate(() => (globalThis as unknown as Global).browser.getState()) as Promise<BrowserState>;

const run = (chrome: Page, id: Parameters<BrowserApi["commands"]["run"]>[0]) =>
  chrome.evaluate((id) => (globalThis as unknown as Global).browser.commands.run(id), id);

const chromePages = (app: ElectronApplication) => app.windows().filter((page) => page.url() === "app://browser/index.html");

/** Records the main process's uncaught exceptions (instead of Electron's error dialog). */
async function watchErrors(app: ElectronApplication): Promise<() => Promise<string[]>> {
  await app.evaluate(() => {
    const target = globalThis as unknown as MainGlobal;
    target.mainErrors = [];
    process.on("uncaughtException", (error) => target.mainErrors.push(String(error)));
  });
  return () => app.evaluate(() => (globalThis as unknown as MainGlobal).mainErrors);
}

/** Clicks an item of the next native tab context menu (`Menu.popup` is intercepted). */
async function tabMenuClick(app: ElectronApplication, chrome: Page, tabId: TabId, itemId: string): Promise<void> {
  await app.evaluate(({ Menu }, itemId) => {
    Menu.prototype.popup = function (this: Electron.Menu) {
      setTimeout(() => this.getMenuItemById(itemId)!.click(), 0);
    };
  }, itemId);
  await chrome.evaluate((id) => (globalThis as unknown as Global).browser.tabs.contextMenu(id), tabId);
}

/**
 * Replaces the history search handler: every query finds the page `stale`, and queries containing
 * `slowWord` answer only after `delayMs` (a request still in flight while the user keeps typing).
 */
async function slowHistorySearch(app: ElectronApplication, stale: HistoryEntry, slowWord: string, delayMs: number): Promise<void> {
  await app.evaluate(
    ({ ipcMain }, { stale, slowWord, delayMs }) => {
      ipcMain.removeHandler("history:search");
      ipcMain.handle("history:search", async (_event, query: string) => {
        if (query.includes(slowWord)) await new Promise((resolve) => setTimeout(resolve, delayMs));
        return [stale];
      });
    },
    { stale, slowWord, delayMs },
  );
}

test("a page that closes itself is removed cleanly, and its window still closes and wipes its session", async ({ app, chrome, server }) => {
  const errors = await watchErrors(app);
  await visit(chrome, server.url("/one"), "Page one");
  await newTab(chrome, server.url("/closer"), "Page closer");
  await evalInTab(app, server.url("/closer"), "window.close(); true").catch(() => {});
  await expect.poll(() => tabUrls(app)).toEqual([server.url("/one")]);
  await expect.poll(async () => (await state(chrome)).tabs.map((tab) => tab.url)).toEqual([server.url("/one")]);
  await expect(chrome.locator(".tab.active .title")).toHaveText("Page one");
  await expect.poll(async () => (await attachedViews(app)).map((view) => view.url)).toEqual([server.url("/one")]);

  // The remaining tab keeps working: zoom (every tab of the site is visited) and navigation.
  await run(chrome, "zoom-in");
  await expect.poll(async () => (await state(chrome)).tabs[0].zoom).toBe(110);
  await run(chrome, "zoom-reset");
  await visit(chrome, server.url("/two"), "Page two");

  // In a private window: a page closes itself, then the window closes.
  await run(chrome, "new-private-window");
  await expect.poll(() => chromePages(app).length).toBe(2);
  let priv: Page | undefined;
  await expect
    .poll(async () => {
      for (const page of chromePages(app)) if ((await state(page).catch(() => null))?.isPrivate) priv = page;
      return !!priv;
    })
    .toBe(true);
  await priv!.waitForSelector(".sidebar");
  await visit(priv!, server.url("/private-one"), "Page private-one");
  await evalInTab(app, server.url("/private-one"), "document.cookie = 'c=1; path=/'; true");
  await app.evaluate(({ webContents }, url) => {
    const page = webContents.getAllWebContents().find((contents) => contents.getURL() === url)!;
    (globalThis as unknown as { privateSession: Electron.Session }).privateSession = page.session;
  }, server.url("/private-one"));
  await newTab(priv!, server.url("/private-closer"), "Page private-closer");
  await evalInTab(app, server.url("/private-closer"), "window.close(); true").catch(() => {});
  await expect.poll(async () => (await state(priv!)).tabs.map((tab) => tab.url)).toEqual([server.url("/private-one")]);
  await priv!.evaluate(() => (globalThis as unknown as Global).browser.window.close()).catch(() => {});
  await expect.poll(() => chromePages(app).length).toBe(1);
  // Its session was still wiped.
  await expect
    .poll(() => app.evaluate(async () => (await (globalThis as unknown as { privateSession: Electron.Session }).privateSession.cookies.get({})).length))
    .toBe(0);
  expect(await errors()).toEqual([]);
});

test("a v1 session.json is migrated, not set aside as corrupt", async ({ profile, server }) => {
  const tab = (name: string) => ({ url: server.url(`/${name}`), title: `Page ${name}`, favicon: null, pinned: false });
  writeFileSync(`${profile}/session.json`, JSON.stringify({ version: 1, data: { windows: [{ tabs: [tab("kept-one"), tab("kept-two")], activeIndex: 1 }] } }));
  const app = await launch(profile);
  try {
    const chrome = await chromeOf(app);
    await expect(chrome.locator(".tabs [role=tab]")).toHaveCount(2);
    await expect(chrome.locator(".tab.active .title")).toHaveText("Page kept-two");
    expect(readdirSync(profile).filter((name) => name.includes(".corrupt-"))).toEqual([]);
  } finally {
    await app.close();
  }
});

test("Back from an internal page re-attaches the page, Forward goes back to the internal page", async ({ app, chrome, server }) => {
  const back = chrome.getByRole("button", { name: "Précédent" });
  const forward = chrome.getByRole("button", { name: "Suivant" });
  const address = chrome.getByLabel("Barre d'adresse");
  await visit(chrome, server.url("/one"), "Page one");
  await visit(chrome, "browser://settings", "Paramètres");
  await expect.poll(() => attachedViews(app)).toEqual([]);
  await expect(back).toBeEnabled();
  await expect(forward).toBeDisabled();

  await back.click();
  await expect(chrome.locator(".tab.active .title")).toHaveText("Page one");
  await expect.poll(async () => (await attachedViews(app)).map((view) => view.url)).toEqual([server.url("/one")]);
  await expect(address).toHaveValue(/\/one$/);
  await expect(back).toBeDisabled();
  await expect(forward).toBeEnabled();

  await forward.click();
  await expect(chrome.locator(".tab.active .title")).toHaveText("Paramètres");
  await expect.poll(() => attachedViews(app)).toEqual([]);
  await expect(address).toHaveValue("browser://settings");
  await expect(forward).toBeDisabled();

  // Back again, then a new page: the internal page leaves the forward list.
  await back.click();
  await expect.poll(async () => (await attachedViews(app)).map((view) => view.url)).toEqual([server.url("/one")]);
  await evalInTab(app, server.url("/one"), "document.getElementById('next').click(); true");
  await expect(chrome.locator(".tab.active .title")).toHaveText("Page next");
  await expect(forward).toBeDisabled();
  await back.click();
  await expect(chrome.locator(".tab.active .title")).toHaveText("Page one");
  await expect.poll(async () => (await attachedViews(app)).map((view) => view.url)).toEqual([server.url("/one")]);
  // The page's own forward entry, not the internal page.
  await forward.click();
  await expect(chrome.locator(".tab.active .title")).toHaveText("Page next");
});

test("Back from the start page shown over a page re-attaches the page", async ({ app, chrome, server }) => {
  const back = chrome.getByRole("button", { name: "Précédent" });
  // An internal page without any page under it has nothing to go back to.
  await visit(chrome, "browser://settings", "Paramètres");
  await expect(back).toBeDisabled();

  await visit(chrome, server.url("/one"), "Page one");
  await visit(chrome, "", "Nouvel onglet");
  await expect(chrome.locator(".start")).toBeVisible();
  await expect.poll(() => attachedViews(app)).toEqual([]);
  await back.click();
  await expect(chrome.locator(".tab.active .title")).toHaveText("Page one");
  await expect.poll(async () => (await attachedViews(app)).map((view) => view.url)).toEqual([server.url("/one")]);
  await expect(chrome.getByLabel("Barre d'adresse")).toHaveValue(/\/one$/);
  expect((await state(chrome)).tabs[0].url).toBe(server.url("/one"));
});

test("a link opened from a pinned tab lands after the pinned tabs", async ({ app, chrome, server }) => {
  await visit(chrome, server.url("/popup"), "Opener");
  await newTab(chrome, server.url("/pinned-b"), "Page pinned-b");
  const [a, b] = (await state(chrome)).tabs;
  await chrome.evaluate(
    ([a, b]) => {
      const { browser } = globalThis as unknown as Global;
      browser.tabs.togglePin(a);
      browser.tabs.togglePin(b);
      browser.tabs.activate(a);
    },
    [a.id, b.id],
  );
  await expect.poll(async () => (await state(chrome)).tabs.map((tab) => tab.isPinned)).toEqual([true, true]);
  // A real user click on a target=_blank link (the popup blocker needs trusted input, ADR-018).
  await clickInTab(app, server.url("/popup"), "#open");
  await expect.poll(async () => (await state(chrome)).tabs.length).toBe(3);
  expect((await state(chrome)).tabs.map((tab) => [tab.url, tab.isPinned])).toEqual([
    [server.url("/popup"), true],
    [server.url("/pinned-b"), true],
    [server.url("/second"), false],
  ]);
});

test("pinned tabs stay first when a tab is moved across them", async ({ chrome, server }) => {
  await visit(chrome, server.url("/one"), "Page one");
  await newTab(chrome, server.url("/two"), "Page two");
  await newTab(chrome, server.url("/three"), "Page three");
  const [one, two, three] = (await state(chrome)).tabs;
  await chrome.evaluate((id) => (globalThis as unknown as Global).browser.tabs.togglePin(id), one.id);
  await expect.poll(async () => (await state(chrome)).tabs.map((tab) => tab.isPinned)).toEqual([true, false, false]);
  const order = async () => (await state(chrome)).tabs.map((tab) => tab.id);
  const move = (id: TabId, index: number) =>
    chrome.evaluate(([id, index]) => (globalThis as unknown as Global).browser.tabs.move(id, index), [id, index] as const);

  // An unpinned tab cannot go before a pinned one…
  await move(three.id, 0);
  await expect.poll(order).toEqual([one.id, three.id, two.id]);
  // …nor a pinned tab after an unpinned one.
  await move(one.id, 2);
  await expect.poll(order).toEqual([one.id, three.id, two.id]);
});

test("duplicating a sleeping tab keeps its history", async ({ app, chrome, server }) => {
  await visit(chrome, server.url("/a"), "Page a");
  await visit(chrome, server.url("/b"), "Page b");
  await newTab(chrome, server.url("/c"), "Page c");
  await run(chrome, "sleep-other-tabs");
  await expect.poll(() => tabUrls(app)).toEqual([server.url("/c")]);
  const sleeping = (await state(chrome)).tabs[0];
  await tabMenuClick(app, chrome, sleeping.id, "duplicate");
  await expect(chrome.locator(".tabs [role=tab]")).toHaveCount(3);
  await expect(chrome.locator(".tab.active .title")).toHaveText("Page b");
  await expect(chrome.getByRole("button", { name: "Précédent" })).toBeEnabled();
  await chrome.getByRole("button", { name: "Précédent" }).click();
  await expect(chrome.locator(".tab.active .title")).toHaveText("Page a");
});

test("moving a sleeping tab to another space keeps its history", async ({ app, chrome, server }) => {
  await visit(chrome, server.url("/a"), "Page a");
  await visit(chrome, server.url("/b"), "Page b");
  await newTab(chrome, server.url("/c"), "Page c");
  await run(chrome, "sleep-other-tabs");
  await expect.poll(() => tabUrls(app)).toEqual([server.url("/c")]);
  const { tabs, activeSpaceId: home } = await state(chrome);
  const sleeping = tabs[0];

  const space = await chrome.evaluate(() => (globalThis as unknown as Global).browser.spaces.create({ name: "Travail" }));
  await expect.poll(async () => (await state(chrome)).activeSpaceId).toBe(space!.id);
  await chrome.evaluate(
    ([home, tabId, spaceId]) => {
      const { browser } = globalThis as unknown as Global;
      browser.spaces.switchTo(home);
      browser.tabs.moveToSpace(tabId, spaceId);
      browser.spaces.switchTo(spaceId);
      browser.tabs.activate(tabId);
    },
    [home, sleeping.id, space!.id] as const,
  );
  await expect.poll(async () => (await state(chrome)).activeSpaceId).toBe(space!.id);
  await expect(chrome.locator(".tab.active .title")).toHaveText("Page b");
  await expect(chrome.getByRole("button", { name: "Précédent" })).toBeEnabled();
  await chrome.getByRole("button", { name: "Précédent" }).click();
  await expect(chrome.locator(".tab.active .title")).toHaveText("Page a");
});

test("the address bar never picks a suggestion computed for older text", async ({ app, chrome, server }) => {
  const stale: HistoryEntry = { url: server.url("/stale"), title: "Stale", favicon: null, visitCount: 1, lastVisit: Date.now() };
  await slowHistorySearch(app, stale, "fresh", 2000);
  const address = chrome.getByLabel("Barre d'adresse");
  await address.click();
  await address.fill("stale");
  await expect(chrome.getByRole("option", { name: /Stale/ })).toBeVisible();
  // New text while its suggestions are still being looked up: ArrowDown + Enter right away.
  await address.fill(server.url("/fresh"));
  await address.press("ArrowDown");
  await address.press("Enter");
  await expect(chrome.locator(".tab.active .title")).toHaveText("Page fresh");
});

test("the command palette never runs a suggestion computed for older text", async ({ app, chrome, server }) => {
  const stale: HistoryEntry = { url: server.url("/stale"), title: "Stale", favicon: null, visitCount: 1, lastVisit: Date.now() };
  await slowHistorySearch(app, stale, "zzfresh", 2000);
  const overlay = await overlayOf(app);
  await run(chrome, "command-palette");
  const input = overlay.getByRole("combobox", { name: "Palette de commandes" });
  await expect(input).toBeFocused();
  await input.fill("stale");
  await expect(overlay.getByRole("option", { name: /Stale/ })).toBeVisible();
  // The first row for the new text is the web search, never the stale page.
  await input.fill("zzfresh words");
  await input.press("Enter");
  await expect.poll(async () => (await state(chrome)).tabs[0].url).toMatch(/^https:\/\/duckduckgo\.com\/\?q=zzfresh/);
});
