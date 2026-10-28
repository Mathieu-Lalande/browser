import type { ElectronApplication, Page } from "@playwright/test";
import type { BrowserApi } from "@shared/ipc";
import type { BrowserState } from "@shared/types";
import { attachedViews, expect, overlayOf, test, visit } from "./fixtures";

// Link peek (ADR-027): a link previewed in a card above the page (context menu or Shift+click),
// closed with Escape, promoted to a tab without reloading.

type Global = { browser: BrowserApi };
const state = (chrome: Page) => chrome.evaluate(() => (globalThis as unknown as Global).browser.getState()) as Promise<BrowserState>;

/** Clicks `selector` in the tab page at `prefix` with trusted input (`button`, `modifiers`), the native menu intercepted. */
async function clickLink(app: ElectronApplication, prefix: string, selector: string, button: "left" | "right", modifiers: string[] = []): Promise<void> {
  await app.evaluate(
    async ({ webContents }, [prefix, selector, button, modifiers]) => {
      const page = webContents.getAllWebContents().find((contents) => contents.getURL().startsWith(prefix as string));
      if (!page) throw new Error(`no tab at ${prefix}`);
      const point: { x: number; y: number } = await page.executeJavaScript(
        `(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`,
      );
      const x = Math.round(point.x);
      const y = Math.round(point.y);
      const mods = modifiers as Electron.MouseInputEvent["modifiers"];
      page.sendInputEvent({ type: "mouseMove", x, y });
      page.sendInputEvent({ type: "mouseDown", x, y, button: button as "left", clickCount: 1, modifiers: mods });
      page.sendInputEvent({ type: "mouseUp", x, y, button: button as "left", clickCount: 1, modifiers: mods });
    },
    [prefix, selector, button, modifiers] as const,
  );
}

/** The peeked page (a webContents at `url` that is not a tab of the window state). */
const peekedUrls = (app: ElectronApplication) => attachedViews(app).then((views) => views.map((view) => view.url));

test("a link peek opens from the context menu and Shift+click, closes with Escape and becomes a tab", async ({ app, chrome, server }) => {
  const page = server.url("/context");
  const target = server.url("/second");
  await visit(chrome, page, "Context");

  // Context menu: "Aperçu du lien".
  await app.evaluate(({ Menu }) => {
    Menu.prototype.popup = function (this: Electron.Menu) {
      setTimeout(() => this.getMenuItemById("link-peek")!.click(), 0);
    };
  });
  await clickLink(app, page, "#link", "right");
  const overlay = await overlayOf(app);
  const card = overlay.getByRole("dialog", { name: "Aperçu du lien" });
  await expect(card).toBeVisible();
  await expect(card).toContainText("Page second");
  // The peeked page is a view of its own, above the page, inside the card.
  await expect.poll(() => peekedUrls(app)).toEqual([page, target]);
  const views = await attachedViews(app);
  const box = await card.boundingBox();
  expect(views[1].width).toBeLessThan(views[0].width);
  expect(views[1].x).toBeGreaterThan(box!.x);
  expect(views[1].y).toBeGreaterThan(box!.y);
  // Not a tab.
  expect((await state(chrome)).tabs.map((tab) => tab.url)).toEqual([page]);

  // Escape in the peeked page closes it and destroys its page.
  await app.evaluate(({ webContents }, url) => {
    const peeked = webContents.getAllWebContents().find((contents) => contents.getURL() === url)!;
    peeked.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
  }, target);
  await expect.poll(() => peekedUrls(app)).toEqual([page]);
  await expect
    .poll(() => app.evaluate(({ webContents }, url) => webContents.getAllWebContents().some((contents) => contents.getURL() === url), target))
    .toBe(false);

  // Shift+click (trusted input) peeks too, instead of opening a window.
  await clickLink(app, page, "#link", "left", ["shift"]);
  await expect(card).toBeVisible();
  await expect.poll(() => peekedUrls(app)).toEqual([page, target]);
  expect((await state(chrome)).tabs).toHaveLength(1);

  // "Ouvrir dans un onglet": the same page becomes the active tab, next to its source.
  const peekedId = await app.evaluate(({ webContents }, url) => webContents.getAllWebContents().find((contents) => contents.getURL() === url)!.id, target);
  await card.getByRole("button", { name: "Ouvrir dans un onglet" }).click();
  await expect.poll(async () => (await state(chrome)).tabs.map((tab) => tab.url)).toEqual([page, target]);
  const after = await state(chrome);
  expect(after.activeTabId).toBe(after.tabs[1].id);
  await expect(chrome.locator(".tab.active .title")).toHaveText("Page second");
  await expect.poll(() => peekedUrls(app)).toEqual([target]);
  // Not reloaded: the very same page.
  expect(await app.evaluate(({ webContents }, url) => webContents.getAllWebContents().find((contents) => contents.getURL() === url)!.id, target)).toBe(peekedId);
});
