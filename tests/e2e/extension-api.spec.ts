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
      .toEqual({ windows: 1, tabs: expect.any(Number), urls: 0, browser: "function", commands: "say-hello" });

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
