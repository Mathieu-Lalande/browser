import type { ElectronApplication, Page } from "@playwright/test";
import type { BrowserApi } from "@shared/ipc";
import type { BrowserState } from "@shared/types";
import { expect, overlayOf, tabUrls, test, visit } from "./fixtures";

// "Essentiels" (ADR-021): page context menu, site info popover, site data, copy link.

type Global = { browser: BrowserApi };
type MenuGlobal = { menuIds?: string[] };

const api = <T>(chrome: Page, fn: (browser: BrowserApi) => Promise<T> | T) =>
  chrome.evaluate(`(${fn.toString()})(globalThis.browser)`) as Promise<T>;

const state = (chrome: Page) => chrome.evaluate(() => (globalThis as unknown as Global).browser.getState()) as Promise<BrowserState>;

const clipboardText = (app: ElectronApplication) => app.evaluate(async ({ clipboard }) => await clipboard.readText());

/**
 * Right-clicks `selector` in the tab page at `urlPrefix` (trusted input, like the user) with
 * `Menu.popup` intercepted: resolves to the ids of the menu's entries, and clicks `itemId` if given.
 */
async function contextMenu(app: ElectronApplication, urlPrefix: string, selector: string, itemId?: string): Promise<string[]> {
  await app.evaluate(({ Menu }, itemId) => {
    const target = globalThis as unknown as MenuGlobal;
    target.menuIds = undefined;
    Menu.prototype.popup = function (this: Electron.Menu) {
      const collect = (menu: Electron.Menu): string[] => menu.items.flatMap((entry) => [entry.id, ...(entry.submenu ? collect(entry.submenu) : [])]);
      target.menuIds = collect(this).filter(Boolean);
      if (itemId) setTimeout(() => this.getMenuItemById(itemId)!.click(), 0);
    };
  }, itemId);
  await app.evaluate(
    async ({ webContents }, [prefix, target]) => {
      const page = webContents.getAllWebContents().find((contents) => contents.getURL().startsWith(prefix));
      if (!page) throw new Error(`no tab at ${prefix}`);
      const point: { x: number; y: number } = await page.executeJavaScript(
        `(() => { const r = document.querySelector(${JSON.stringify(target)}).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`,
      );
      const x = Math.round(point.x);
      const y = Math.round(point.y);
      page.sendInputEvent({ type: "mouseMove", x, y });
      page.sendInputEvent({ type: "mouseDown", x, y, button: "right", clickCount: 1 });
      page.sendInputEvent({ type: "mouseUp", x, y, button: "right", clickCount: 1 });
    },
    [urlPrefix, selector] as const,
  );
  await expect.poll(() => app.evaluate(() => (globalThis as unknown as MenuGlobal).menuIds ?? null)).not.toBeNull();
  return app.evaluate(() => (globalThis as unknown as MenuGlobal).menuIds!);
}

test("the page context menu opens and copies links, never file: ones", async ({ app, chrome, server }) => {
  const page = server.url("/context");
  await visit(chrome, page, "Context");

  const link = await contextMenu(app, page, "#link", "link-open-background");
  expect(link).toEqual(expect.arrayContaining(["link-open-tab", "link-open-split", "link-open-private", "link-copy", "link-copy-text", "inspect"]));
  await expect.poll(() => tabUrls(app)).toContain(server.url("/second"));
  // In the background: the page stays the active tab.
  const current = await state(chrome);
  expect(current.tabs.find((tab) => tab.id === current.activeTabId)?.url).toBe(page);

  await contextMenu(app, page, "#link", "link-copy");
  await expect.poll(() => clipboardText(app)).toBe(server.url("/second"));

  const file = await contextMenu(app, page, "#file");
  expect(file.filter((id) => id.startsWith("link-open"))).toEqual([]);

  // A plain right click: navigation and page tools; the image gets its own entries.
  expect(await contextMenu(app, page, "#text")).toEqual(expect.arrayContaining(["page-back", "page-reload", "page-save", "page-site-info"]));
  expect(await contextMenu(app, page, "#img")).toEqual(expect.arrayContaining(["image-open", "image-copy", "image-copy-url", "image-save"]));
});

test("a link opens in a private window only on request", async ({ app, chrome, server }) => {
  const page = server.url("/context");
  await visit(chrome, page, "Context");
  const chromes = () => app.windows().filter((window) => window.url() === "app://browser/index.html");
  await contextMenu(app, page, "#link", "link-open-private");
  await expect.poll(() => chromes().length).toBe(2);
  const priv = chromes().find((window) => window !== chrome)!;
  await priv.waitForSelector(".sidebar");
  await expect.poll(async () => (await state(priv)).tabs.map((tab) => tab.url)).toEqual([server.url("/second")]);
  expect((await state(priv)).isPrivate).toBe(true);
  // Nothing opened in the normal window.
  expect((await state(chrome)).tabs.map((tab) => tab.url)).toEqual([page]);
});

test("site info: connection, cookies cleared, copy link", async ({ app, chrome, server }) => {
  const page = server.url("/context");
  await visit(chrome, page, "Context");

  // Copy link button in the address bar, with its confirmation.
  await chrome.getByRole("button", { name: "Copier le lien" }).click();
  await expect(chrome.getByRole("status")).toHaveText("Lien copié");
  await expect.poll(() => clipboardText(app)).toBe(page);

  await chrome.getByRole("button", { name: /^Infos sur le site/ }).click();
  const overlay = await overlayOf(app);
  const panel = overlay.getByRole("dialog", { name: "Infos sur le site" });
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("heading", { name: "127.0.0.1" })).toBeVisible();
  await expect(panel.getByText("Connexion non sécurisée")).toBeVisible();
  await expect(panel.getByTestId("cookie-count")).toHaveText("1 cookie");
  await expect(panel.getByText("Aucune autorisation accordée ni refusée à ce site.")).toBeVisible();

  await panel.getByRole("button", { name: "Effacer les cookies et données du site" }).click();
  await panel.getByRole("button", { name: "Effacer", exact: true }).click();
  await expect(panel.getByText("Données effacées")).toBeVisible();
  // The tab reloaded: the page set its cookie again, after the clear.
  await expect.poll(() => app.evaluate(async ({ session }) => (await session.defaultSession.cookies.get({ name: "ctx" })).length)).toBe(1);
  await overlay.keyboard.press("Escape");
  await expect(panel).toBeHidden();
});

test("settings list sites with cookies and clear them", async ({ app, chrome, server }) => {
  await visit(chrome, server.url("/context"), "Context");
  await api(chrome, (browser) => browser.settings.open());
  const list = chrome.getByRole("list", { name: "Sites avec des cookies" });
  await expect(list.getByText("127.0.0.1")).toBeVisible();
  await chrome.getByRole("button", { name: "Effacer les données de 127.0.0.1" }).click();
  await expect(chrome.getByText("Aucun site n'a enregistré de cookies.")).toBeVisible();
  expect(await app.evaluate(async ({ session }) => (await session.defaultSession.cookies.get({})).length)).toBe(0);
});

test("third-party cookies are blocked when asked, except on allowed sites", async ({ app, chrome, server }) => {
  const thirdParty = server.url("/tp-cookie").replace("127.0.0.1", "localhost");
  const page = server.url(`/embeds-third-party?src=${encodeURIComponent(thirdParty)}`);
  const thirdPartyCookies = () => app.evaluate(async ({ session }) => (await session.defaultSession.cookies.get({ name: "tp" })).length);

  await api(chrome, (browser) => browser.settings.update({ privacy: { blockThirdPartyCookies: true } }));
  await visit(chrome, page, "Third party");
  await expect.poll(() => tabUrls(app)).toContain(page);
  await new Promise((resolve) => setTimeout(resolve, 500));
  expect(await thirdPartyCookies()).toBe(0);

  // An exception for the page's site lets them through again.
  await api(chrome, (browser) => browser.settings.update({ privacy: { thirdPartyCookieExceptions: ["127.0.0.1"] } }));
  await api(chrome, async (browser) => browser.tabs.reload((await browser.getState()).activeTabId!));
  await expect.poll(thirdPartyCookies).toBe(1);
});
