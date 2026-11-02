import type { ElectronApplication, Page } from "@playwright/test";
import type { BrowserApi } from "@shared/ipc";
import type { BrowserState } from "@shared/types";
import { expect, overlayOf, tabUrls, test, visit } from "./fixtures";

// App menu, sidebar and space menus, page menu additions, page gestures (ADR-033).

type Global = { browser: BrowserApi };
type MenuGlobal = { menuIds?: string[] };

const state = (chrome: Page) => chrome.evaluate(() => (globalThis as unknown as Global).browser.getState()) as Promise<BrowserState>;
const activeTab = async (chrome: Page) => {
  const current = await state(chrome);
  return current.tabs.find((tab) => tab.id === current.activeTabId);
};

/** Intercepts the next native menu: resolves its entry ids once shown, clicking `itemId` if given. */
async function interceptMenu(app: ElectronApplication, itemId?: string): Promise<void> {
  await app.evaluate(({ Menu }, itemId) => {
    const target = globalThis as unknown as MenuGlobal;
    target.menuIds = undefined;
    Menu.prototype.popup = function (this: Electron.Menu) {
      const collect = (menu: Electron.Menu): string[] => menu.items.flatMap((entry) => [entry.id, ...(entry.submenu ? collect(entry.submenu) : [])]);
      target.menuIds = collect(this).filter(Boolean);
      if (itemId) setTimeout(() => this.getMenuItemById(itemId)!.click(), 0);
    };
  }, itemId);
}

async function shownMenu(app: ElectronApplication): Promise<string[]> {
  await expect.poll(() => app.evaluate(() => (globalThis as unknown as MenuGlobal).menuIds ?? null)).not.toBeNull();
  return app.evaluate(() => (globalThis as unknown as MenuGlobal).menuIds!);
}

/** Trusted input on the tab page at `urlPrefix`. */
function sendToPage(app: ElectronApplication, urlPrefix: string, events: Electron.MouseWheelInputEvent[] | Electron.MouseInputEvent[], gapMs = 0) {
  return app.evaluate(
    async ({ webContents }, [prefix, list, gap]) => {
      const page = webContents.getAllWebContents().find((contents) => contents.getURL().startsWith(prefix));
      if (!page) throw new Error(`no tab at ${prefix}`);
      for (const event of list) {
        page.sendInputEvent(event);
        if (gap) await new Promise((resolve) => setTimeout(resolve, gap));
      }
    },
    [urlPrefix, events, gapMs] as const,
  );
}

test("the app menu opens from the sidebar, runs Nouvel onglet and zooms", async ({ app, chrome, server }) => {
  await visit(chrome, server.url("/context"), "Context");
  await chrome.getByTestId("app-menu-button").click();
  const overlay = await overlayOf(app);
  const menu = overlay.getByRole("menu", { name: "Menu de l'application" });
  await expect(menu).toBeVisible();
  await expect(overlay.getByText("Synchronisation", { exact: true })).toBeVisible();
  await expect(overlay.getByRole("button", { name: "Se connecter" })).toBeVisible();

  // Zoom row: the menu stays open.
  await overlay.getByRole("button", { name: "Zoom avant" }).click();
  await expect.poll(async () => (await activeTab(chrome))?.zoom).toBe(110);
  await expect(overlay.getByTestId("app-menu-zoom")).toHaveText(/110/);

  // A submenu opens with the keyboard (→) and goes back with ←.
  const help = menu.getByRole("menuitem", { name: "Aide" });
  await help.focus();
  await overlay.keyboard.press("ArrowRight");
  const helpMenu = overlay.getByRole("menu", { name: "Aide" });
  await expect(helpMenu.getByRole("menuitem", { name: /^Raccourcis clavier/ })).toBeFocused();
  await overlay.keyboard.press("ArrowLeft");
  await expect(helpMenu).toBeHidden();
  await expect(help).toBeFocused();
  // And on hover.
  await menu.getByRole("menuitem", { name: "Plus d'outils" }).hover();
  await expect(overlay.getByRole("menu", { name: "Plus d'outils" }).getByRole("menuitem", { name: /^Afficher le code source/ })).toBeVisible();

  await menu.getByRole("menuitem", { name: /^Nouvel onglet/ }).click();
  await expect(menu).toBeHidden();
  await expect.poll(async () => (await state(chrome)).tabs.length).toBe(2);
});

test("the sidebar's empty space has its menu: compact mode, selection…", async ({ app, chrome, server }) => {
  await visit(chrome, server.url("/context"), "Context");
  const area = chrome.getByTestId("space-area");
  const box = (await area.boundingBox())!;
  const emptySpot = { position: { x: box.width / 2, y: box.height - 20 }, button: "right" as const };

  await interceptMenu(app, "select-all-tabs");
  await area.click(emptySpot);
  expect(await shownMenu(app)).toEqual([
    "toggle-compact-mode",
    "new-tab",
    "new-folder",
    "reload",
    "toggle-bookmark",
    "select-all-tabs",
    "reopen-closed-tab",
    "toggle-sidebar-position",
    "edit-space",
  ]);
  const selection = chrome.getByTestId("tab-selection");
  await expect(selection).toContainText("1 sélectionné");
  await selection.getByRole("button", { name: "Annuler la sélection" }).click();
  await expect(selection).toBeHidden();

  // Compact mode: a rail of tab icons, unfolded while hovered.
  await interceptMenu(app, "toggle-compact-mode");
  await area.click(emptySpot);
  await shownMenu(app);
  await chrome.mouse.move(box.x + box.width + 400, box.y + 10);
  await expect(chrome.getByTestId("compact-rail")).toBeVisible();
  await expect.poll(async () => (await chrome.evaluate(() => (globalThis as unknown as Global).browser.settings.get())).layout.compactMode).toBe(true);
  await chrome.getByTestId("compact-rail").hover();
  await expect(chrome.getByTestId("space-area")).toBeVisible();
});

test("a space chip's menu renames, moves and deletes", async ({ app, chrome }) => {
  const created = await chrome.evaluate(() => (globalThis as unknown as Global).browser.spaces.create({ name: "Travail" }));
  const chip = chrome.locator(`[data-space-id="${created!.id}"]`);
  await interceptMenu(app, "space-rename");
  await chip.click({ button: "right" });
  expect(await shownMenu(app)).toEqual(["space-rename", "space-edit", "space-move-left", "space-move-right", "space-delete", "new-space"]);
  const name = chrome.getByLabel("Nom de l'espace");
  await expect(name).toBeFocused();
  await name.fill("Projets");
  await name.press("Enter");
  await expect.poll(async () => (await state(chrome)).spaces.map((space) => space.name)).toContain("Projets");

  await interceptMenu(app, "space-move-left");
  await chip.click({ button: "right" });
  await shownMenu(app);
  await expect.poll(async () => (await state(chrome)).spaces[0].id).toBe(created!.id);
});

test("the page menu has the navigation row, page tools and view source", async ({ app, chrome, server }) => {
  const page = server.url("/context");
  await visit(chrome, page, "Context");
  const rightClick = async (itemId?: string) => {
    await interceptMenu(app, itemId);
    const point = { x: 300, y: 400 };
    await sendToPage(app, page, [
      { type: "mouseMove", ...point },
      { type: "mouseDown", ...point, button: "right", clickCount: 1 },
      { type: "mouseUp", ...point, button: "right", clickCount: 1 },
    ]);
    return shownMenu(app);
  };
  const ids = await rightClick("page-view-source");
  expect(ids.slice(0, 4)).toEqual(["page-back", "page-forward", "page-reload", "page-bookmark"]);
  expect(ids).toEqual(
    expect.arrayContaining(["page-save", "page-select-all", "page-capture-visible", "page-capture-full", "page-capture-element", "page-view-source", "inspect"]),
  );
  // No sync account: nothing to send to.
  expect(ids).not.toContain("page-send");
  await expect.poll(() => tabUrls(app)).toContain(`view-source:${page}`);
});

test("Ctrl+wheel zooms the page, a two-finger swipe goes back", async ({ app, chrome, server }) => {
  const first = server.url("/first");
  const second = server.url("/second");
  await visit(chrome, first, "Page first");
  await visit(chrome, second, "Page second");

  await sendToPage(app, second, [{ type: "mouseWheel", x: 200, y: 200, deltaY: 120, wheelTicksY: 1, modifiers: ["control"] }]);
  await expect.poll(async () => (await activeTab(chrome))?.zoom).not.toBe(100);
  await chrome.evaluate(() => (globalThis as unknown as Global).browser.commands.run("zoom-reset"));
  // A new wheel burst starts after a pause (the Ctrl+wheel one would swallow it).
  await chrome.waitForTimeout(300);

  // Touchpad: precise horizontal deltas, fingers to the right (Blink: positive deltaX scrolls left).
  const swipe = Array.from({ length: 24 }, () => ({ type: "mouseWheel" as const, x: 200, y: 200, deltaX: 14, deltaY: 0, hasPreciseScrollingDeltas: true }));
  await sendToPage(app, second, swipe, 16);
  await expect.poll(async () => (await activeTab(chrome))?.url, { timeout: 5000 }).toBe(first);
});
