import type { ElectronApplication, Page } from "@playwright/test";
import type { BrowserApi } from "@shared/ipc";
import { expect, tabUrls, test } from "./fixtures";

async function visit(chrome: Page, url: string, title: string): Promise<void> {
  const address = chrome.getByLabel("Barre d'adresse");
  await address.fill(url);
  await address.press("Enter");
  await expect(chrome.locator(".tab.active .title")).toHaveText(title);
}

/** Native key press through the main process, so menu accelerators fire (see library.spec.ts). */
async function press(app: ElectronApplication, keyCode: string, modifiers: ("control" | "shift")[] = []): Promise<void> {
  await app.evaluate(
    ({ BrowserWindow }, { keyCode, modifiers }) => {
      const contents = BrowserWindow.getAllWindows()[0].webContents;
      contents.sendInputEvent({ type: "keyDown", keyCode, modifiers });
      contents.sendInputEvent({ type: "keyUp", keyCode, modifiers });
    },
    { keyCode, modifiers },
  );
}

const isOverlay = (page: Page) => page.url().startsWith("app://browser/overlay.html");

/** The overlay layer's page (pre-warmed once the window is shown). */
async function overlayOf(app: ElectronApplication): Promise<Page> {
  await expect.poll(() => app.windows().some(isOverlay)).toBe(true);
  return app.windows().find(isOverlay)!;
}

/** Whether the overlay view is currently attached to the window (above the page). */
function overlayAttached(app: ElectronApplication): Promise<boolean> {
  return app.evaluate(({ BrowserWindow, WebContentsView }) => {
    const children = BrowserWindow.getAllWindows()[0].contentView.children;
    const top = children.at(-1);
    return top instanceof WebContentsView && top.webContents.getURL().startsWith("app://browser/overlay.html");
  });
}

/** Opens the palette with Ctrl+K and returns its input, focused. */
async function openPalette(app: ElectronApplication): Promise<Page> {
  const overlay = await overlayOf(app);
  await press(app, "K", ["control"]);
  await expect.poll(() => overlayAttached(app)).toBe(true);
  await expect(overlay.getByRole("combobox", { name: "Palette de commandes" })).toBeFocused();
  return overlay;
}

const options = (overlay: Page) => overlay.getByRole("listbox", { name: "Résultats" }).getByRole("option");

test("Ctrl+K opens the palette above the page, Escape closes and detaches it", async ({ app, chrome, server }) => {
  await visit(chrome, server.url("/one"), "Page one");
  await chrome.getByRole("button", { name: "Nouvel onglet" }).click();
  await visit(chrome, server.url("/two"), "Page two");

  const overlay = await openPalette(app);
  // Recent tabs are listed before typing, the current one excluded.
  await expect(overlay.getByRole("group", { name: "Onglets récents" }).getByRole("option")).toHaveText([/Page one/]);
  await expect(options(overlay).first()).toHaveAttribute("aria-selected", "true");

  await overlay.keyboard.press("Escape");
  await expect.poll(() => overlayAttached(app)).toBe(false);
  expect(await tabUrls(app)).toContain(server.url("/two"));

  // Cancelling gives focus back to what had it: here the page.
  const pageFocused = () =>
    app.evaluate(({ webContents }, url) => webContents.getAllWebContents().find((c) => c.getURL() === url)?.isFocused(), server.url("/two"));
  await app.evaluate(({ webContents }, url) => webContents.getAllWebContents().find((c) => c.getURL() === url)?.focus(), server.url("/two"));
  await openPalette(app);
  expect(await pageFocused()).toBe(false);
  await overlay.keyboard.press("Escape");
  await expect.poll(pageFocused).toBe(true);

  // Ctrl+K toggles, and clicking the scrim closes too.
  await openPalette(app);
  await press(app, "K", ["control"]);
  await expect.poll(() => overlayAttached(app)).toBe(false);
  await openPalette(app);
  await overlay.mouse.click(10, 10);
  await expect.poll(() => overlayAttached(app)).toBe(false);
});

test("typing a tab's title switches to it; history results navigate", async ({ app, chrome, server }) => {
  await visit(chrome, server.url("/alpha"), "Page alpha");
  await visit(chrome, server.url("/gamma"), "Page gamma");
  await chrome.getByRole("button", { name: "Nouvel onglet" }).click();
  await visit(chrome, server.url("/beta"), "Page beta");

  let overlay = await openPalette(app);
  const input = overlay.getByRole("combobox", { name: "Palette de commandes" });
  await input.pressSequentially("gamma");
  await expect(options(overlay).first()).toContainText("Page gamma");
  await expect(options(overlay).first().locator("mark").first()).toHaveText("gamma");
  await input.press("Enter");
  await expect(chrome.locator(".tab.active .title")).toHaveText("Page gamma");
  await expect.poll(() => overlayAttached(app)).toBe(false);
  await expect(chrome.locator(".tabs [role=tab]")).toHaveCount(2);

  // "alpha" is only in the history now: Enter loads it in the current tab.
  overlay = await openPalette(app);
  await input.pressSequentially("alpha");
  const history = overlay.getByRole("group", { name: "Favoris et historique" }).getByRole("option");
  await expect(history).toHaveText([/Page alpha/]);
  await expect(options(overlay).first()).toContainText("Page alpha");
  await input.press("Enter");
  await expect(chrome.locator(".tab.active .title")).toHaveText("Page alpha");
  await expect(chrome.locator(".tabs [role=tab]")).toHaveCount(2);

  // Ctrl+Enter opens in a new tab; the address-like input goes first.
  overlay = await openPalette(app);
  await input.pressSequentially(server.url("/delta").replace("http://", ""));
  await expect(options(overlay).first()).toContainText("Aller à 127.0.0.1");
  await input.press("Control+Enter");
  await expect(chrome.locator(".tab.active .title")).toHaveText("Page delta");
  await expect(chrome.locator(".tabs [role=tab]")).toHaveCount(3);
});

test("actions run like their menu item: pin, duplicate, new tab, copy URL", async ({ app, chrome, server }) => {
  await visit(chrome, server.url("/before"), "Page before");
  await visit(chrome, server.url("/act"), "Page act");

  let overlay = await openPalette(app);
  const input = overlay.getByRole("combobox", { name: "Palette de commandes" });
  await input.pressSequentially("épingl");
  await expect(options(overlay).first()).toHaveText(/Épingler l'onglet/);
  await input.press("Enter");
  await expect(chrome.locator(".pinned-tab")).toHaveCount(1);

  overlay = await openPalette(app);
  await input.pressSequentially("dupli");
  await expect(options(overlay).first()).toContainText("Dupliquer l'onglet");
  // Shortcut hints come from the same registry as the menu.
  await expect(options(overlay).first().locator("kbd")).toHaveText(["Ctrl", "Maj", "K"]);
  await input.press("Enter");
  await expect(chrome.locator(".tabs [role=tab]")).toHaveCount(1);
  await expect(chrome.locator(".tab.active .title")).toHaveText("Page act");
  // The copy keeps the back/forward history.
  await expect(chrome.getByLabel("Précédent")).toBeEnabled();
  await expect.poll(() => tabUrls(app)).toEqual([server.url("/act"), server.url("/act")]);

  await press(app, "C", ["control", "shift"]);
  await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe(server.url("/act"));

  overlay = await openPalette(app);
  await input.pressSequentially("nouvel ong");
  await options(overlay).filter({ hasText: "Nouvel onglet" }).click();
  await expect(chrome.locator(".tabs [role=tab]")).toHaveCount(2);
  await expect(chrome.getByLabel("Barre d'adresse")).toBeFocused();
  await expect.poll(() => overlayAttached(app)).toBe(false);
});

test("clearing the history asks for confirmation inside the palette", async ({ app, chrome, server }) => {
  await visit(chrome, server.url("/secret"), "Page secret");
  const searchHistory = () =>
    chrome.evaluate(() => (globalThis as unknown as { browser: BrowserApi }).browser.history.search("secret"));
  expect(await searchHistory()).toHaveLength(1);

  const overlay = await openPalette(app);
  const input = overlay.getByRole("combobox", { name: "Palette de commandes" });
  await input.pressSequentially("effacer hist");
  await input.press("Enter");
  const dialog = overlay.getByRole("alertdialog", { name: "Effacer tout l'historique ?" });
  await expect(dialog).toBeVisible();
  // Escape goes back to the results, not out of the palette.
  await overlay.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(input).toBeFocused();
  expect(await overlayAttached(app)).toBe(true);

  await input.press("Enter");
  await expect(dialog.getByRole("button", { name: "Effacer l'historique" })).toBeFocused();
  await overlay.keyboard.press("Enter");
  await expect.poll(() => overlayAttached(app)).toBe(false);
  expect(await searchHistory()).toHaveLength(0);
});

test("IPC accepts the overlay as its window's UI, never a tab page", async ({ app, chrome, server }) => {
  await visit(chrome, server.url("/page"), "Page page");
  await overlayOf(app);
  const tabCount = chrome.locator(".tabs [role=tab]");
  await expect(tabCount).toHaveCount(1);

  // Emit "tab:create" as if sent by a given webContents (pages have no preload, so this is the
  // only way to impersonate one): the sender check must refuse the page and accept the overlay.
  const emitFrom = (suffix: string) =>
    app.evaluate(({ ipcMain, webContents }, suffix) => {
      const sender = webContents.getAllWebContents().find((contents) => contents.getURL().endsWith(suffix));
      if (!sender) throw new Error(`no webContents for ${suffix}`);
      ipcMain.emit("tab:create", { sender }, "http://127.0.0.1:1/");
    }, suffix);

  await emitFrom("/page");
  await expect(tabCount).toHaveCount(1);
  await emitFrom("app://browser/overlay.html");
  await expect(tabCount).toHaveCount(2);
});
