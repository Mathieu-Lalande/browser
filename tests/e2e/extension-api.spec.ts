import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import type { BrowserApi } from "@shared/ipc";
import { chromeOf, evalInTab, expect, launch, sandboxAvailable, tabUrls, test, visit, type ElectronApplication } from "./fixtures";

/**
 * The chrome.* APIs added for extensions (ADR-053), through a local MV3 extension: from its
 * options page (frame preload, any environment) and from its service worker (whose preload only
 * runs in sandboxed renderers: launched with the OS sandbox where it can start).
 */

type Global = { browser: BrowserApi };
type MenuGlobal = { menuIds?: string[] };
const EXTENSION = fileURLToPath(new URL("./extension-api", import.meta.url));

/** Installs the test extension from its folder and pins its button; resolves to its id. */
async function install(app: ElectronApplication, chrome: Page): Promise<string> {
  await app.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [folder] })) as unknown as typeof dialog.showOpenDialog;
  }, EXTENSION);
  await chrome.evaluate(() => (globalThis as unknown as Global).browser.commands.run("open-extensions"));
  await chrome.getByTestId("extensions-page").getByRole("button", { name: "Charger un dossier" }).click();
  await expect(chrome.getByText("« API de test » est installée.")).toBeVisible();
  const id = (await chrome.locator("[data-extension-id]").first().getAttribute("data-extension-id"))!;
  await chrome.evaluate((extensionId) => (globalThis as unknown as Global).browser.extensions.setPinned(extensionId, true), id);
  return id;
}

/** Right-clicks the tab page at `url`, clicking the native menu's `itemId`; resolves to the menu's entry ids. */
async function rightClick(app: ElectronApplication, url: string, itemId: string): Promise<string[]> {
  await app.evaluate(({ Menu }, itemId) => {
    const target = globalThis as unknown as MenuGlobal;
    target.menuIds = undefined;
    Menu.prototype.popup = function (this: Electron.Menu) {
      const collect = (menu: Electron.Menu): string[] => menu.items.flatMap((entry) => [entry.id, ...(entry.submenu ? collect(entry.submenu) : [])]);
      target.menuIds = collect(this).filter(Boolean);
      const item = this.getMenuItemById(itemId);
      if (item) setTimeout(() => item.click(), 0);
    };
  }, itemId);
  await app.evaluate(({ webContents }, prefix) => {
    const contents = webContents.getAllWebContents().find((item) => item.getURL().startsWith(prefix))!;
    contents.sendInputEvent({ type: "mouseMove", x: 200, y: 200 });
    contents.sendInputEvent({ type: "mouseDown", x: 200, y: 200, button: "right", clickCount: 1 });
    contents.sendInputEvent({ type: "mouseUp", x: 200, y: 200, button: "right", clickCount: 1 });
  }, url);
  await expect.poll(() => app.evaluate(() => (globalThis as unknown as MenuGlobal).menuIds ?? null)).not.toBeNull();
  return app.evaluate(() => (globalThis as unknown as MenuGlobal).menuIds!);
}

/** What the extension reported: the `#…` of its `page.html` tabs. */
const reports = async (app: ElectronApplication) =>
  (await tabUrls(app)).flatMap((url) => {
    const match = /^chrome-extension:\/\/[a-p]{32}\/page\.html#(.+)$/.exec(url);
    return match ? [decodeURIComponent(match[1])] : [];
  });

const badge = (chrome: Page, id: string) => chrome.locator(`[data-extension-action="${id}"] [data-extension-badge]`);

test("an extension page opens tabs, lists windows, sets the badge, adds a page menu item and hears its button; web pages get nothing", async ({
  app,
  chrome,
  server,
}) => {
  const id = await install(app, chrome);
  expect(await chrome.evaluate((extensionId) => (globalThis as unknown as Global).browser.extensions.openOptions(extensionId), id)).toBe(true);

  // windows.getAll, tabs.getCurrent, `browser` completed too, tabs.create refusing file:, then tabs.create.
  await expect.poll(() => reports(app)).toContain("page-ready:1:tab:function:yes");
  // chrome.action: the badge, its color, on the extension's button.
  await expect(badge(chrome, id)).toHaveText("P");
  await expect(badge(chrome, id)).toHaveCSS("background-color", "rgb(0, 128, 0)");

  // chrome.contextMenus: merged into the page menu of a web page (in another tab: the options page keeps listening).
  await chrome.evaluate(() => (globalThis as unknown as Global).browser.commands.run("new-tab"));
  const page = server.url("/menu-page");
  await visit(chrome, page, "Page menu-page");
  const ids = await rightClick(app, page, `ext-menu:${id}:api-page`);
  expect(ids).toContain(`ext-menu:${id}:api-page`);
  expect(ids.indexOf(`ext-menu:${id}:api-page`)).toBeLessThan(ids.indexOf("inspect"));
  // The click reaches onClicked; activeTab is not declared, so the tab comes without its URL.
  await expect.poll(() => reports(app)).toContain("page-menu:nourl");

  // No popup: a click on the button reaches action.onClicked.
  await chrome.locator(`[data-extension-action="${id}"]`).click();
  await expect.poll(() => reports(app)).toContain("page-action:nourl");

  // A web page gets nothing: the same globals as a page of a session without the preload, no
  // chrome.tabs/action, no `browser` (the preload returns at once outside chrome-extension:).
  const globals = await evalInTab<string[]>(app, page, "Object.getOwnPropertyNames(globalThis).sort()");
  const fresh = await app.evaluate(async ({ BrowserWindow, session }, url) => {
    const probe = new BrowserWindow({ show: false, webPreferences: { session: session.fromPartition("extension-api-probe"), sandbox: true } });
    await probe.loadURL(url);
    const names: string[] = await probe.webContents.executeJavaScript("Object.getOwnPropertyNames(globalThis).sort()");
    probe.destroy();
    return names;
  }, page);
  expect(globals).toEqual(fresh);
  expect(await evalInTab(app, page, "[typeof browser, typeof chrome?.tabs, typeof chrome?.action, typeof chrome?.windows, typeof __browserExtensionApis]")).toEqual([
    "undefined",
    "undefined",
    "undefined",
    "undefined",
    "undefined",
  ]);
});

/** Native key press through main, so menu accelerators fire (extension shortcuts live in the app menu). */
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

test("extension shortcuts fire commands.onCommand and press the button; the browser's win; menus survive a restart (ADR-054)", async ({ profile, server }) => {
  let app = await launch(profile);
  let id = "";
  try {
    const chrome = await chromeOf(app);
    id = await install(app, chrome);

    // browser://extensions, Détails: the shortcuts, the one the browser keeps (Ctrl+T) marked inactive.
    const row = chrome.locator(`[data-extension-id="${id}"]`);
    await row.getByRole("button", { name: "Détails" }).click();
    const shortcuts = row.getByTestId("extension-shortcuts");
    await expect(shortcuts.locator('[data-command="say-hello"]')).toHaveAttribute("data-active", "true");
    await expect(shortcuts.locator('[data-command="_execute_action"]')).toHaveAttribute("data-active", "true");
    await expect(shortcuts.locator('[data-command="steal-new-tab"]')).toHaveAttribute("data-active", "false");
    await expect(shortcuts.locator('[data-command="steal-new-tab"]')).toContainText("Nouvel onglet");

    // The options page listens to onCommand (and to action.onClicked) and creates its page menu item.
    expect(await chrome.evaluate((extensionId) => (globalThis as unknown as Global).browser.extensions.openOptions(extensionId), id)).toBe(true);
    await expect.poll(() => reports(app)).toContain("page-ready:1:tab:function:yes");
    const page = server.url("/menu-page");
    await chrome.evaluate(() => (globalThis as unknown as Global).browser.commands.run("new-tab"));
    await visit(chrome, page, "Page menu-page");

    await press(app, "H", ["alt", "shift"]);
    await expect.poll(() => reports(app)).toContain("command:say-hello:tab:say-hello=Alt+Shift+H,_execute_action=Ctrl+Shift+Y,steal-new-tab=");
    // _execute_action: as a click on its button (no popup: action.onClicked).
    await press(app, "Y", ["control", "shift"]);
    await expect.poll(() => reports(app)).toContain("page-action:nourl");
    // Ctrl+T stays the browser's: a new tab, no command.
    const before = await chrome.locator(".tab").count();
    await press(app, "T", ["control"]);
    await expect.poll(() => chrome.locator(".tab").count()).toBeGreaterThan(before);
    expect((await reports(app)).some((report) => report.startsWith("command:steal-new-tab"))).toBe(false);
  } finally {
    await app.close();
  }

  // Next run: the page menu item the options page created is still there, without the page running.
  app = await launch(profile);
  try {
    const chrome = await chromeOf(app);
    await expect(chrome.locator(`[data-extension-action="${id}"]`)).toBeVisible();
    const page = server.url("/menu-page");
    await visit(chrome, page, "Page menu-page");
    await expect.poll(async () => (await rightClick(app, page, "none")).includes(`ext-menu:${id}:api-page`), { timeout: 10_000 }).toBe(true);
    // Disabling the extension forgets them, on disk too.
    await chrome.evaluate((extensionId) => (globalThis as unknown as Global).browser.extensions.setEnabled(extensionId, false), id);
    await expect.poll(() => readFileSync(join(profile, "extension-menus.json"), "utf8")).not.toContain(id);
  } finally {
    await app.close();
  }
});

test("an extension's service worker opens tabs, lists windows, sets its badge, adds a page menu item and hears its button", async ({ profile, server }) => {
  test.skip(!sandboxAvailable, "the service-worker preload needs the OS sandbox, which cannot start here");
  const app = await launch(profile, {}, [], { sandboxed: true });
  try {
    const chrome = await chromeOf(app);
    const id = await install(app, chrome);

    // chrome.action from the worker: badge and title (what windows.getAll, commands.getAll and `browser` gave).
    await expect(badge(chrome, id)).toHaveText("7");
    await expect(badge(chrome, id)).toHaveCSS("background-color", "rgb(208, 0, 0)");
    const button = chrome.locator(`[data-extension-action="${id}"]`);
    await expect
      .poll(async () => JSON.parse(((await button.getAttribute("title")) ?? "{}").replace(/ \(7\)$/, "")))
      .toEqual({ windows: 1, tabs: expect.any(Number), urls: 0, browser: "function", commands: "say-hello,_execute_action,steal-new-tab" });

    // contextMenus.create from the worker, in the page menu; the click wakes onClicked, which calls tabs.create.
    const page = server.url("/menu-page");
    await visit(chrome, page, "Page menu-page");
    expect(await rightClick(app, page, `ext-menu:${id}:api-test`)).toContain(`ext-menu:${id}:api-test`);
    await expect.poll(() => reports(app)).toContain("menu:api-test:page:tab:nourl");
    await expect(badge(chrome, id)).toHaveText("ok");

    // No popup: the button's click reaches action.onClicked with the active tab (tabs.query agrees).
    await button.click();
    await expect.poll(() => reports(app)).toContain("action:same");
  } finally {
    await app.close();
  }
});

test("the shortcut editor changes, clears and refuses extension shortcuts (ADR-057)", async ({ app, chrome, server }) => {
  const id = await install(app, chrome);
  expect(await chrome.evaluate((extensionId) => (globalThis as unknown as Global).browser.extensions.openOptions(extensionId), id)).toBe(true);
  await expect.poll(() => reports(app)).toContain("page-ready:1:tab:function:yes");
  await chrome.evaluate(() => (globalThis as unknown as Global).browser.commands.run("open-extensions"));
  await chrome.getByTestId("extension-shortcuts-toggle").click();
  const editor = chrome.getByTestId("extension-shortcut-editor");
  const row = (command: string) => editor.locator(`[data-extension-id="${id}"][data-command="${command}"]`);

  // A key of the browser's is refused, with why.
  await row("steal-new-tab").getByRole("button", { name: "Modifier le raccourci" }).click();
  await press(app, "T", ["control"]);
  await expect(row("steal-new-tab").getByRole("alert")).toContainText("Nouvel onglet");
  await press(app, "Escape", []);

  // A new key for "Dire bonjour": installed at once, the old one gone.
  await row("say-hello").getByRole("button", { name: "Modifier le raccourci" }).click();
  await press(app, "J", ["alt", "shift"]);
  await expect(row("say-hello")).toContainText("J");
  await expect(row("say-hello").getByRole("button", { name: "Rétablir le raccourci proposé par l'extension" })).toBeVisible();
  // Another extension command cannot take it.
  await row("steal-new-tab").getByRole("button", { name: "Modifier le raccourci" }).click();
  await press(app, "J", ["alt", "shift"]);
  await expect(row("steal-new-tab").getByRole("alert")).toContainText("API de test");
  await press(app, "Escape", []);

  const page = server.url("/menu-page");
  await chrome.evaluate(() => (globalThis as unknown as Global).browser.commands.run("new-tab"));
  await visit(chrome, page, "Page menu-page");
  await press(app, "J", ["alt", "shift"]);
  await expect.poll(() => reports(app)).toContain("command:say-hello:tab:say-hello=Alt+Shift+J,_execute_action=Ctrl+Shift+Y,steal-new-tab=");

  // Cleared: no shortcut; then back to the extension's suggestion.
  await chrome.evaluate(() => (globalThis as unknown as Global).browser.commands.run("open-extensions"));
  await chrome.getByTestId("extension-shortcuts-toggle").click();
  await row("say-hello").getByRole("button", { name: "Modifier le raccourci" }).click();
  await press(app, "Backspace", []);
  await expect(row("say-hello")).toContainText("Aucun raccourci");
  await row("say-hello").getByRole("button", { name: "Rétablir le raccourci proposé par l'extension" }).click();
  await expect(row("say-hello")).toContainText("H");
  const stored = await chrome.evaluate((extensionId) => (globalThis as unknown as Global).browser.extensions.shortcuts().then((rows) => rows.find((r) => r.extensionId === extensionId && r.command === "say-hello")), id);
  expect(stored).toMatchObject({ accelerator: "Alt+Shift+H", active: true, custom: false });
});

test("an extension allowed in private browsing loads into a throwaway profile, deleted when the window closes (ADR-057)", async ({ app, chrome, server }) => {
  const id = await install(app, chrome);
  const openPrivate = async () => {
    await chrome.evaluate(() => (globalThis as unknown as Global).browser.commands.run("new-private-window"));
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(2);
  };
  /** The private window's tab session: whether it is on disk, where, and the extensions loaded there. */
  const privateSession = () =>
    app.evaluate(({ webContents, session }) => {
      const page = webContents.getAllWebContents().find((contents) => /\/private-page/.test(contents.getURL()));
      if (!page || page.session === session.defaultSession) return null;
      return { path: page.session.storagePath, extensions: page.session.extensions.getAllExtensions().map((extension) => extension.name) };
    });
  const privateChrome = async () => {
    for (const page of app.windows()) {
      if (!page.url().startsWith("app://browser/index.html")) continue;
      if ((await page.evaluate(() => (globalThis as unknown as Global).browser.getState()).catch(() => null))?.isPrivate) return page;
    }
    return null;
  };
  // The page may go away before the evaluation returns.
  const closePrivate = (page: Page) => page.evaluate(() => (globalThis as unknown as Global).browser.window.close()).catch(() => {});

  // Not allowed (the default): the private window stays in memory, without the extension.
  await openPrivate();
  let priv = await expect.poll(privateChrome).not.toBeNull().then(privateChrome);
  await visit(priv!, server.url("/private-page"), "Page private-page");
  // (Chromium lists the default session's extensions in an in-memory one, but never runs them there.)
  await expect.poll(async () => (await privateSession())?.path).toBeNull();
  await expect(priv!.locator(`[data-extension-action="${id}"]`)).toHaveCount(0);
  await closePrivate(priv!);
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);

  // Allowed: a new private window gets a throwaway profile with the extension (and its button).
  await chrome.evaluate((extensionId) => (globalThis as unknown as Global).browser.extensions.setPrivateAllowed(extensionId, true), id);
  await openPrivate();
  priv = await expect.poll(privateChrome).not.toBeNull().then(privateChrome);
  await visit(priv!, server.url("/private-page"), "Page private-page");
  await expect.poll(async () => (await privateSession())?.extensions).toEqual(["API de test"]);
  const folder = (await privateSession())!.path!;
  expect(folder).toMatch(/browser-private-[0-9a-f]{8}[\\/]private-[0-9a-f-]{36}/);
  expect(existsSync(folder)).toBe(true);
  await expect(priv!.locator(`[data-extension-action="${id}"]`)).toBeVisible();
  await closePrivate(priv!);
  await expect.poll(() => existsSync(folder), { timeout: 10_000 }).toBe(false);
});
