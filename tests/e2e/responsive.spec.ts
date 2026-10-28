import type { BrowserApi } from "@shared/ipc";
import { LIMITS } from "@shared/settings";
import type { Page } from "@playwright/test";
import { expect, openPrivateWindow, overlayOf, test, visit, type ElectronApplication } from "./fixtures";

/**
 * Nothing in the sidebar (or in the overlay's popovers) may spill out of its container, at the
 * smallest sidebar and window sizes. `SHOTS_DIR=…` also saves screenshots of the checked states.
 */

type Window = { browser: BrowserApi };
type Rect = { left: number; right: number; top: number; bottom: number; width: number; height: number };
// The e2e tsconfig has no DOM lib: reach the DOM through a typed globalThis.
type El = {
  tagName: string;
  className: unknown;
  parentElement: El | null;
  textContent: string | null;
  getAttribute(name: string): string | null;
  getBoundingClientRect(): Rect;
  checkVisibility(options: object): boolean;
  querySelectorAll(selector: string): ArrayLike<El>;
  closest(selector: string): El | null;
};
type Dom = {
  document: { querySelector(selector: string): El | null };
  getComputedStyle(element: El): { overflowX: string; overflowY: string };
  innerWidth: number;
  innerHeight: number;
};

const MIN_WINDOW = { width: 640, height: 420 };
const shots = process.env.SHOTS_DIR;

/**
 * The visible elements under `root` whose box leaves the root's box: horizontally always,
 * vertically unless a scrolling ancestor (the tab list, a long popover) holds them. Also fails
 * when the root itself leaves the window. Returns readable descriptions (empty: all good).
 */
async function overflowing(page: Page, root: string): Promise<string[]> {
  return page.evaluate((selector) => {
    const dom = globalThis as unknown as Dom;
    const container = dom.document.querySelector(selector);
    if (!container) return [`${selector}: missing`];
    const box = container.getBoundingClientRect();
    const describe = (element: El) =>
      `${element.tagName.toLowerCase()}.${String(element.className).split(" ")[0]}[${element.getAttribute("aria-label") ?? (element.textContent ?? "").trim().slice(0, 30)}]`;
    const problems: string[] = [];
    const slack = 0.5;
    if (box.left < -slack || box.top < -slack || box.right > dom.innerWidth + slack || box.bottom > dom.innerHeight + slack) {
      problems.push(`${selector} leaves the window: ${JSON.stringify(box)}`);
    }
    const scrolled = (element: El) => {
      for (let parent = element.parentElement; parent && parent !== container.parentElement; parent = parent.parentElement) {
        if (/auto|scroll/.test(dom.getComputedStyle(parent).overflowY)) return true;
      }
      return false;
    };
    for (const element of Array.from(container.querySelectorAll("*"))) {
      // Inner shapes of an icon follow the icon's box.
      if (element.tagName.toLowerCase() !== "svg" && element.closest("svg")) continue;
      if (!element.checkVisibility({ visibilityProperty: true })) continue;
      const rect = element.getBoundingClientRect();
      // Visually hidden labels (1px, clipped).
      if (rect.width <= 1 && rect.height <= 1) continue;
      const out = rect.left < box.left - slack || rect.right > box.right + slack || (!scrolled(element) && (rect.top < box.top - slack || rect.bottom > box.bottom + slack));
      if (out) problems.push(`${describe(element)} ${Math.round(rect.left)}→${Math.round(rect.right)} × ${Math.round(rect.top)}→${Math.round(rect.bottom)} outside ${Math.round(box.left)}→${Math.round(box.right)} × ${Math.round(box.top)}→${Math.round(box.bottom)}`);
    }
    return problems;
  }, root);
}

/** Title bar: its parts sit side by side inside it, never overlapping; its buttons keep ≥ 24px. */
async function checkTitlebar(page: Page): Promise<void> {
  const titlebar = (await page.locator(".titlebar").boundingBox())!;
  const parts = await page.locator(".titlebar button, .titlebar .private-badge").all();
  const boxes = [];
  for (const part of parts) {
    const box = (await part.boundingBox())!;
    boxes.push(box);
    expect(box.x).toBeGreaterThanOrEqual(titlebar.x - 0.5);
    expect(box.x + box.width).toBeLessThanOrEqual(titlebar.x + titlebar.width + 0.5);
  }
  boxes.sort((a, b) => a.x - b.x);
  for (let index = 1; index < boxes.length; index++) expect(boxes[index].x).toBeGreaterThanOrEqual(boxes[index - 1].x + boxes[index - 1].width - 0.5);
  for (const button of await page.locator(".titlebar button, .nav button, .footer button").all()) {
    const box = (await button.boundingBox())!;
    expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(24);
  }
  // The badge is never cut: whole, or folded to its icon.
  const badge = page.locator(".private-badge");
  if (await badge.count()) {
    const slot = (await page.locator(".title-slot").boundingBox())!;
    const box = (await badge.boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(slot.x + slot.width + 0.5);
  }
}

async function setWindowSize(app: ElectronApplication, width: number, height: number): Promise<void> {
  await app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows().forEach((window) => window.setContentSize(w, h)), [width, height] as const);
}

const update = (page: Page, patch: object) => page.evaluate((p) => (globalThis as unknown as Window).browser.settings.update(p as never), patch);

/** Waits for the sidebar's width to follow the settings (and the space slide-in to finish). */
async function settle(page: Page, width: number): Promise<void> {
  await expect.poll(async () => Math.round((await page.locator(".sidebar").boundingBox())!.width)).toBe(width);
  await page.waitForTimeout(300);
}

async function shoot(page: Page, name: string, selector = ".sidebar"): Promise<void> {
  if (!shots) return;
  await page.locator(selector).screenshot({ path: `${shots}/${name}.png` });
}

test("private window: the title bar and the sidebar never overflow, sidebar left and right", async ({ app, chrome }) => {
  test.setTimeout(120_000);
  const priv = await openPrivateWindow(app, chrome);
  await setWindowSize(app, MIN_WINDOW.width, MIN_WINDOW.height);
  await expect(priv.locator(".titlebar .controls")).toBeVisible();
  await expect(priv.locator(".private-badge")).toBeVisible();

  for (const position of ["left", "right"] as const) {
    for (const width of [LIMITS.sidebarWidth.min, 264]) {
      for (const density of ["compact", "comfortable", "spacious"] as const) {
        await update(priv, { layout: { sidebarPosition: position, sidebarWidth: width }, appearance: { density } });
        await settle(priv, width);
        expect(await overflowing(priv, ".sidebar"), `${position} ${width}px ${density}`).toEqual([]);
        await checkTitlebar(priv);
      }
      await shoot(priv, `private-titlebar-${position}-${width}`, ".titlebar");
    }
  }
  // Wide enough: the badge shows its label again.
  await setWindowSize(app, 1200, 700);
  await update(priv, { layout: { sidebarPosition: "left", sidebarWidth: 420 }, appearance: { density: "comfortable" } });
  await settle(priv, 420);
  await expect(priv.locator(".private-label")).toHaveCSS("position", "static");
  await checkTitlebar(priv);
  await update(priv, { layout: { sidebarWidth: 264 } });
});

test("every sidebar surface fits the narrowest sidebar in the smallest window", async ({ app, chrome, server }) => {
  test.setTimeout(120_000);
  await setWindowSize(app, MIN_WINDOW.width, MIN_WINDOW.height);
  await update(chrome, { layout: { sidebarWidth: LIMITS.sidebarWidth.min } });
  await settle(chrome, LIMITS.sidebarWidth.min);

  // Empty favorites: a drop zone tells the grid exists.
  await expect(chrome.getByTestId("favorites-hint")).toContainText("Glissez un onglet ici pour l'épingler dans tous les espaces");
  expect(await overflowing(chrome, ".sidebar")).toEqual([]);
  await shoot(chrome, "favorites-hint-232");

  // Long titles, a zoomed page (zoom indicator) with every address bar button, a split, folders 4 levels deep.
  const long = "un-titre-de-page-vraiment-tres-long-qui-ne-tient-jamais";
  await visit(chrome, server.url(`/${long}`), `Page ${long}`);
  await chrome.evaluate(() => (globalThis as unknown as Window).browser.commands.run("zoom-in"));
  await expect(chrome.locator(".address .zoom")).toBeVisible();
  for (let index = 0; index < 6; index++) {
    await chrome.evaluate((url) => (globalThis as unknown as Window).browser.tabs.create(url), server.url(`/${long}-${index}`));
  }
  const state = async () => (await chrome.evaluate(() => (globalThis as unknown as Window).browser.getState()))!;
  let parent: string | null = null;
  const tabs = (await state()).tabs.map((item) => item.id);
  for (let depth = 0; depth < 4; depth++) {
    const before = (await state()).folders?.length ?? 0;
    await chrome.evaluate(
      ([parentId, tabId, name]) => (globalThis as unknown as Window).browser.folders.create({ name }, parentId, [tabId]),
      [parent, tabs[depth + 1], `Dossier au nom bien trop long, niveau ${depth + 1}`] as const,
    );
    await expect.poll(async () => (await state()).folders?.length ?? 0).toBe(before + 1);
    parent = (await state()).folders!.at(-1)!.id;
  }
  await chrome.evaluate((id) => (globalThis as unknown as Window).browser.split.open(id), tabs[5]);
  await expect(chrome.locator(".split-group")).toBeVisible();
  await expect(chrome.locator(".folder-row")).toHaveCount(4);
  await settle(chrome, LIMITS.sidebarWidth.min);
  expect(await overflowing(chrome, ".sidebar")).toEqual([]);
  // Four levels deep, the deepest folder still shows a readable part of its name.
  const deepest = (await chrome.locator(".folder-name").last().boundingBox())!;
  expect(deepest.width).toBeGreaterThanOrEqual(60);

  // Folder editor.
  await chrome.getByRole("button", { name: /^Modifier le dossier Dossier au nom bien trop long, niveau 4/ }).click({ force: true });
  await expect(chrome.getByTestId("folder-editor")).toBeVisible();
  expect(await overflowing(chrome, ".sidebar")).toEqual([]);
  expect(await overflowing(chrome, "[data-testid=folder-editor]")).toEqual([]);
  await chrome.keyboard.press("Escape");

  // Space editor, at the minimum and the default width.
  await chrome.evaluate(() => (globalThis as unknown as Window).browser.spaces.create({ name: "Un espace au nom plutôt long" }));
  await chrome.getByRole("button", { name: "Modifier l'espace" }).click();
  const editor = chrome.getByRole("dialog", { name: "Modifier l'espace" });
  await expect(editor).toBeVisible();
  await editor.getByRole("radio").last().click();
  for (const width of [LIMITS.sidebarWidth.min, 264]) {
    await update(chrome, { layout: { sidebarWidth: width } });
    await settle(chrome, width);
    expect(await overflowing(chrome, ".sidebar"), `${width}px`).toEqual([]);
    expect(await overflowing(chrome, ".editor[aria-label=\"Modifier l'espace\"]"), `${width}px`).toEqual([]);
    for (const radio of await editor.getByRole("radio").all()) {
      const box = (await radio.boundingBox())!;
      expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(28);
    }
    await shoot(chrome, `space-editor-${width}`);
  }
  await chrome.keyboard.press("Escape");
  await update(chrome, { layout: { sidebarWidth: LIMITS.sidebarWidth.min } });
  await settle(chrome, LIMITS.sidebarWidth.min);

  // Overlay popovers stay inside the window, sidebar left and right.
  await visit(chrome, server.url("/infos"), "Page infos");
  const overlay = await overlayOf(app);
  for (const position of ["left", "right"] as const) {
    await update(chrome, { layout: { sidebarPosition: position } });
    await settle(chrome, LIMITS.sidebarWidth.min);
    await chrome.getByRole("button", { name: /^Infos sur le site/ }).click();
    await expect(overlay.getByRole("dialog", { name: "Infos sur le site" })).toBeVisible();
    await overlay.waitForTimeout(300);
    expect(await overflowing(overlay, "[role=dialog][aria-label='Infos sur le site']"), position).toEqual([]);
    await overlay.keyboard.press("Escape");
    await expect(overlay.getByRole("dialog", { name: "Infos sur le site" })).toBeHidden();

    await chrome.getByRole("button", { name: "Téléchargements", exact: true }).click();
    await expect(overlay.getByRole("dialog", { name: "Téléchargements" })).toBeVisible();
    await overlay.waitForTimeout(300);
    expect(await overflowing(overlay, "[role=dialog][aria-label='Téléchargements']"), position).toEqual([]);
    await overlay.keyboard.press("Escape");
    await expect(overlay.getByRole("dialog", { name: "Téléchargements" })).toBeHidden();
  }
});

test("the favorites hint can be dismissed for good", async ({ chrome }) => {
  const hint = chrome.getByTestId("favorites-hint");
  await expect(hint).toBeVisible();
  await hint.getByRole("button", { name: "Masquer l'astuce des favoris" }).click();
  await expect(hint).toBeHidden();
  const settings = await chrome.evaluate(() => (globalThis as unknown as Window).browser.settings.get());
  expect(settings.layout.favoritesHintDismissed).toBe(true);
});
