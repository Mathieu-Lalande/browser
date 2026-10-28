import type { ElectronApplication, Page } from "@playwright/test";
import type { BrowserApi } from "@shared/ipc";
import type { BrowserState, TabId } from "@shared/types";
import { chromeOf, expect, launch, tabUrls, test, visit } from "./fixtures";

/** Organisation (ADR-022): folders, favorites grid, swipe between spaces, auto-archiving. */

type Global = { browser: BrowserApi };
const state = (chrome: Page) => chrome.evaluate(() => (globalThis as unknown as Global).browser.getState()) as Promise<BrowserState>;
const SHOTS = process.env.ORGANIZE_SHOTS;

/** Clicks an item (by id, `parent/child` for a submenu) of the next native context menu. */
async function nextMenuClick(app: ElectronApplication, path: string): Promise<void> {
  await app.evaluate(({ Menu }, path) => {
    Menu.prototype.popup = function (this: Electron.Menu) {
      const [first, second] = path.split("/");
      setTimeout(() => {
        const item = this.getMenuItemById(first)!;
        (second ? item.submenu!.getMenuItemById(second)! : item).click();
      }, 0);
    };
  }, path);
}

async function tabMenu(app: ElectronApplication, chrome: Page, tabId: TabId, path: string): Promise<void> {
  await nextMenuClick(app, path);
  await chrome.evaluate((id) => (globalThis as unknown as Global).browser.tabs.contextMenu(id), tabId);
}

async function newTab(chrome: Page, url: string, title: string): Promise<void> {
  await chrome.getByRole("button", { name: "Nouvel onglet" }).click();
  await visit(chrome, url, title);
}

const tabId = async (chrome: Page, title: string) => (await state(chrome)).tabs.find((tab) => tab.title === title)!.id;

/** Drags with the real (Playwright) mouse: pointer events, as with a user. */
async function dragTo(chrome: Page, from: string, to: { selector: string; yRatio: number }): Promise<void> {
  const source = (await chrome.locator(from).boundingBox())!;
  const target = (await chrome.locator(to.selector).boundingBox())!;
  await chrome.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
  await chrome.mouse.down();
  await chrome.mouse.move(source.x + source.width / 2, source.y + source.height / 2 + 12, { steps: 3 });
  await chrome.mouse.move(target.x + target.width / 2, target.y + target.height * to.yRatio, { steps: 8 });
  await chrome.mouse.up();
}

test("folders: created from the tab menu, renamed, collapsed, filled by drag and drop, kept across restarts", async ({ app, chrome, profile, server }) => {
  await visit(chrome, server.url("/one"), "Page one");
  await newTab(chrome, server.url("/two"), "Page two");
  await newTab(chrome, server.url("/three"), "Page three");

  // Keyboard alternative: "Nouvel dossier avec cet onglet" from the tab context menu.
  await tabMenu(app, chrome, await tabId(chrome, "Page one"), "new-folder");
  const folderRow = chrome.locator(".folder-row");
  await expect(folderRow).toHaveCount(1);
  await expect(folderRow.locator(".folder-name")).toHaveText("Nouveau dossier");
  await expect(folderRow.locator(".count")).toHaveText("1");

  // Rename and pick an icon in the folder popover.
  await folderRow.hover();
  await folderRow.getByRole("button", { name: /Modifier le dossier/ }).click();
  const editor = chrome.getByRole("dialog", { name: "Modifier le dossier" });
  await editor.getByLabel("Nom du dossier").fill("Lecture");
  await editor.getByRole("radio", { name: "Lecture" }).click();
  await editor.getByRole("button", { name: "Terminé" }).click();
  await expect(folderRow.locator(".folder-name")).toHaveText("Lecture");
  await expect(folderRow.locator(".folder-icon svg")).toHaveClass(/lucide-book-open/);

  // "Déplacer vers le dossier…": Page two goes into it.
  const folderId = (await state(chrome)).folders![0].id;
  await tabMenu(app, chrome, await tabId(chrome, "Page two"), `move-folder/folder-${folderId}`);
  await expect(folderRow.locator(".count")).toHaveText("2");

  // Drag and drop with the pointer: Page three onto the folder.
  await dragTo(chrome, '.row:has(.title:text("Page three"))', { selector: ".folder-row", yRatio: 0.5 });
  await expect(folderRow.locator(".count")).toHaveText("3");
  let current = await state(chrome);
  expect(current.tabs.every((tab) => tab.folderId === folderId)).toBe(true);
  if (SHOTS) await chrome.locator(".sidebar").screenshot({ path: `${SHOTS}/folders.png` });

  // Out again, before Page one (an insertion line, then a reorder inside the folder).
  await dragTo(chrome, '.row:has(.title:text("Page three"))', { selector: '.row:has(.title:text("Page one"))', yRatio: 0.2 });
  await expect.poll(async () => (await state(chrome)).tabs.map((tab) => tab.title)).toEqual(["Page three", "Page one", "Page two"]);

  // Collapsing hides the folder's tabs (the active one stays visible).
  await chrome.getByRole("button", { name: "Replier le dossier Lecture" }).click();
  await expect(chrome.locator(".row .tab")).toHaveCount(1);
  await chrome.getByRole("button", { name: "Déplier le dossier Lecture" }).click();
  await expect(chrome.locator(".row .tab")).toHaveCount(3);

  // The folder is in the session (v3) and comes back after a restart.
  current = await state(chrome);
  await app.close();
  const again = await launch(profile);
  try {
    const chrome2 = await chromeOf(again);
    await expect(chrome2.locator(".folder-row .folder-name")).toHaveText("Lecture");
    await expect(chrome2.locator(".folder-row .count")).toHaveText("3");
    expect((await state(chrome2)).folders).toEqual(current.folders);

    // Deleting asks about the tabs; "garder" puts them back at the root.
    const row = chrome2.locator(".folder-row");
    await row.hover();
    await row.getByRole("button", { name: /Modifier le dossier/ }).click();
    const dialog = chrome2.getByRole("dialog", { name: "Modifier le dossier" });
    await dialog.getByRole("button", { name: "Supprimer" }).click();
    await expect(dialog).toContainText("Il contient 3 onglets");
    await dialog.getByRole("button", { name: "Supprimer, garder les onglets" }).click();
    await expect(chrome2.locator(".folder-row")).toHaveCount(0);
    await expect(chrome2.locator(".row .tab")).toHaveCount(3);
  } finally {
    await again.close();
  }
});

test("favorites grid: added from the menu or by drag, opens or focuses its site, read-only in private windows", async ({ app, chrome, server }) => {
  const mail = server.url("/mail").replace("127.0.0.1", "localhost");
  await visit(chrome, mail, "Page mail");
  await tabMenu(app, chrome, await tabId(chrome, "Page mail"), "favorite");
  const tiles = chrome.locator(".favorites .tile");
  await expect(tiles).toHaveCount(1);
  // The site has a tab open here: the tile shows the dot.
  await expect(tiles.first().locator(".dot")).toHaveCount(1);

  // Clicking the tile from another tab focuses the existing tab instead of opening a new one.
  await newTab(chrome, server.url("/other"), "Page other");
  await tiles.first().click();
  await expect(chrome.locator(".tab.active .title")).toHaveText("Page mail");
  expect((await state(chrome)).tabs).toHaveLength(2);

  // Dragging a tab onto the grid adds it.
  await dragTo(chrome, '.row:has(.title:text("Page other"))', { selector: ".favorites", yRatio: 0.5 });
  await expect(tiles).toHaveCount(2);
  if (SHOTS) await chrome.locator(".sidebar").screenshot({ path: `${SHOTS}/favorites.png` });

  // Closed: the dot goes, and the tile opens the site again in a new tab.
  await chrome.locator('.tab:has(.title:text("Page mail")) .close').click();
  await expect(tiles.first().locator(".dot")).toHaveCount(0);
  await tiles.first().click();
  await expect(chrome.locator(".tab.active .title")).toHaveText("Page mail");

  // The palette command toggles the active tab's site.
  await chrome.evaluate(() => (globalThis as unknown as Global).browser.commands.run("toggle-favorite"));
  await expect(tiles).toHaveCount(1);

  // A private window shows the grid but cannot edit it.
  const privateChrome = await (async () => {
    await chrome.evaluate(() => (globalThis as unknown as Global).browser.commands.run("new-private-window"));
    await expect.poll(() => app.windows().filter((page) => page.url() === "app://browser/index.html").length).toBe(2);
    const page = app.windows().filter((candidate) => candidate.url() === "app://browser/index.html").at(-1)!;
    await page.waitForSelector(".sidebar");
    return page;
  })();
  await expect(privateChrome.locator(".favorites .tile")).toHaveCount(1);
  await privateChrome.evaluate((url) => (globalThis as unknown as Global).browser.favorites.remove(url), server.url("/other"));
  await privateChrome.waitForTimeout(300);
  await expect(chrome.locator(".favorites .tile")).toHaveCount(1);
});

test("a two-finger horizontal swipe on the sidebar changes space once; vertical scrolling does not", async ({ chrome }) => {
  const api = (chrome: Page) => chrome.evaluate(async () => {
    const browser = (globalThis as unknown as Global).browser;
    await browser.spaces.create({ name: "Deux" });
    await browser.spaces.create({ name: "Trois" });
  });
  await api(chrome);
  const spaces = (await state(chrome)).spaces;
  await chrome.evaluate((id) => (globalThis as unknown as Global).browser.spaces.switchTo(id), spaces[0].id);
  await expect.poll(async () => (await state(chrome)).activeSpaceId).toBe(spaces[0].id);
  await chrome.waitForTimeout(400);

  /** Synthetic touchpad events (pixel deltas), dispatched on the sidebar's tab area. */
  const wheel = (deltaX: number, deltaY: number, count: number) =>
    chrome.evaluate(
      async ({ deltaX, deltaY, count }) => {
        const target = document.querySelector("[data-testid=space-area]")!;
        for (let i = 0; i < count; i++) {
          target.dispatchEvent(new WheelEvent("wheel", { deltaX, deltaY, deltaMode: 0, bubbles: true, cancelable: true }));
          await new Promise((resolve) => setTimeout(resolve, 8));
        }
      },
      { deltaX, deltaY, count },
    );

  // A mouse wheel (deltaY only) scrolls, never switches.
  await wheel(0, 60, 20);
  await chrome.waitForTimeout(400);
  expect((await state(chrome)).activeSpaceId).toBe(spaces[0].id);

  // One long swipe (with its momentum): exactly one space further.
  await wheel(30, 0, 40);
  await expect.poll(async () => (await state(chrome)).activeSpaceId).toBe(spaces[1].id);
  await chrome.waitForTimeout(500);
  expect((await state(chrome)).activeSpaceId).toBe(spaces[1].id);

  // After a pause, a swipe the other way goes back.
  await wheel(-30, 0, 40);
  await expect.poll(async () => (await state(chrome)).activeSpaceId).toBe(spaces[0].id);
  // At the first space, swiping further back only rubber-bands.
  await chrome.waitForTimeout(500);
  await wheel(-30, 0, 40);
  await chrome.waitForTimeout(500);
  expect((await state(chrome)).activeSpaceId).toBe(spaces[0].id);
});

test("idle tabs are archived (never pinned ones), listed in browser://archive and the palette, and restored", async ({ profile, server }) => {
  const app = await launch(profile, { BROWSER_TEST_ARCHIVE_MS: "1500" });
  try {
    const chrome = await chromeOf(app);
    await visit(chrome, server.url("/old-article"), "Page old-article");
    await newTab(chrome, server.url("/pinned"), "Page pinned");
    await chrome.evaluate(async (id) => (globalThis as unknown as Global).browser.tabs.togglePin(id), await tabId(chrome, "Page pinned"));
    await newTab(chrome, server.url("/current"), "Page current");

    // The background tab goes to the archive; the pinned one and the one on screen stay.
    await expect.poll(async () => (await state(chrome)).tabs.map((tab) => tab.title).sort(), { timeout: 10_000 }).toEqual(["Page current", "Page pinned"]);
    expect(await tabUrls(app)).not.toContain(server.url("/old-article"));
    // No more archiving from here on (the tab left for the archive page would go too).
    await chrome.evaluate(() => (globalThis as unknown as Global).browser.settings.update({ behavior: { archiveTabsAfter: "never" } }));

    await chrome.evaluate(() => (globalThis as unknown as Global).browser.commands.run("open-archive"));
    const page = chrome.getByTestId("archive-page");
    await expect(page.locator(".row")).toHaveCount(1);
    await expect(page.locator(".row .title")).toHaveText("Page old-article");
    await page.getByLabel("Rechercher dans les onglets archivés").fill("introuvable");
    await expect(page.locator(".row")).toHaveCount(0);
    await page.getByLabel("Rechercher dans les onglets archivés").fill("old");
    await expect(page.locator(".row")).toHaveCount(1);
    if (SHOTS) await chrome.screenshot({ path: `${SHOTS}/archive.png` });

    // Also offered in the palette, as "Onglets archivés".
    const archived = await chrome.evaluate(() => (globalThis as unknown as Global).browser.archive.list());
    expect(archived.map((entry) => entry.title)).toEqual(["Page old-article"]);

    await page.getByRole("button", { name: "Restaurer" }).click();
    await expect.poll(async () => (await state(chrome)).tabs.some((tab) => tab.url === server.url("/old-article"))).toBe(true);
    await expect.poll(() => chrome.evaluate(() => (globalThis as unknown as Global).browser.archive.list())).toEqual([]);
  } finally {
    await app.close();
  }
});
