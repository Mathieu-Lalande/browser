import type { BrowserApi } from "@shared/ipc";
import { attachedViews, expect, overlayOf, test, visit, type ElectronApplication } from "./fixtures";
import type { Page } from "@playwright/test";

type Window = { browser: BrowserApi };
// The e2e tsconfig has no DOM lib: reach the DOM through a typed globalThis.
type Dom = {
  getComputedStyle(element: unknown): { getPropertyValue(name: string): string };
  document: { documentElement: { dataset: Record<string, string> } };
};
const api = (chrome: Page) => ({
  update: (patch: object) => chrome.evaluate((p) => (globalThis as unknown as Window).browser.settings.update(p as never), patch),
  create: (url: string) => chrome.evaluate((u) => (globalThis as unknown as Window).browser.tabs.create(u), url),
});

async function setWindowSize(app: ElectronApplication, width: number, height: number): Promise<void> {
  await app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows().forEach((window) => window.setContentSize(w, h)), [width, height] as const);
}

test("tab rows keep their height and the list scrolls, in every density", async ({ chrome, server }) => {
  for (let index = 0; index < 30; index++) await api(chrome).create(server.url(`/t${index}`));
  const tabs = chrome.locator(".tabs [role=tab]");
  await expect(tabs).toHaveCount(31);
  for (const density of ["compact", "comfortable", "spacious"] as const) {
    await api(chrome).update({ appearance: { density } });
    const expected = await chrome.evaluate(() =>
      parseFloat((globalThis as unknown as Dom).getComputedStyle((globalThis as unknown as Dom).document.documentElement).getPropertyValue("--tab-height")),
    );
    await expect.poll(async () => (await tabs.first().boundingBox())!.height).toBeCloseTo(expected, 1);
    const heights = await tabs.evaluateAll((items) => items.map((item) => Math.round((item as unknown as { offsetHeight: number }).offsetHeight)));
    expect(new Set(heights)).toEqual(new Set([expected]));
    // The list scrolls instead.
    const list = chrome.locator(".tabs");
    expect(await list.evaluate((element) => (element as unknown as { scrollHeight: number; clientHeight: number }).scrollHeight > (element as unknown as { clientHeight: number }).clientHeight)).toBe(true);
  }
});

// Port 1 is one Chromium never connects to (ERR_UNSAFE_PORT): a load failure without any network.
test("an unreachable site shows the error page, which goes away on the next navigation", async ({ app, chrome, server }) => {
  const address = chrome.getByLabel("Barre d'adresse");
  await address.fill("http://127.0.0.1:1/");
  await address.press("Enter");
  const page = chrome.locator(".load-error");
  await expect(page.getByRole("heading", { name: "Adresse bloquée" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Actualiser" })).toBeVisible();
  // The blank Chromium error page is not shown over it.
  expect(await attachedViews(app)).toHaveLength(0);

  // Actualiser tries again (and fails again).
  await page.getByRole("button", { name: "Actualiser" }).click();
  await expect(page.getByRole("heading", { name: "Adresse bloquée" })).toBeVisible();

  await visit(chrome, server.url("/back"), "Page back");
  await expect(page).toHaveCount(0);
  await expect.poll(async () => (await attachedViews(app)).length).toBe(1);
});

test("the tab list is one Tab stop, driven with the arrows, Enter and Delete", async ({ chrome, server }) => {
  await visit(chrome, server.url("/a"), "Page a");
  await api(chrome).create(server.url("/b"));
  await api(chrome).create(server.url("/c"));
  await expect(chrome.locator(".tab.active .title")).toHaveText("Page c");
  const tabs = chrome.locator(".tabs [role=tab]");
  await expect(tabs).toHaveCount(3);
  await expect(chrome.locator(".tabs [role=tab][tabindex='0']")).toHaveCount(1);

  await chrome.locator(".tab.active").focus();
  await chrome.keyboard.press("Home");
  await expect(tabs.nth(0)).toBeFocused();
  await chrome.keyboard.press("ArrowDown");
  await expect(tabs.nth(1)).toBeFocused();
  await chrome.keyboard.press("Enter");
  await expect(chrome.locator(".tab.active .title")).toHaveText("Page b");
  await chrome.keyboard.press("End");
  await expect(tabs.nth(2)).toBeFocused();
  await chrome.keyboard.press("ArrowUp");
  await chrome.keyboard.press("ArrowUp");
  await expect(tabs.nth(0)).toBeFocused();
  await chrome.keyboard.press(" ");
  await expect(chrome.locator(".tab.active .title")).toHaveText("Page a");
  await chrome.keyboard.press("Delete");
  await expect(tabs).toHaveCount(2);
  await expect(chrome.locator(".tabs [role=tab]", { hasText: "Page a" })).toHaveCount(0);
  await expect(tabs.nth(0)).toBeFocused();
});

test("new tab, settings and downloads reuse the empty start-page tab", async ({ chrome }) => {
  const tabs = chrome.locator(".tabs [role=tab]");
  await expect(tabs).toHaveCount(1);
  await expect(tabs.first().locator(".title")).toHaveText("Page d'accueil");
  await chrome.getByRole("button", { name: "Nouvel onglet" }).click();
  await chrome.getByRole("button", { name: "Nouvel onglet" }).click();
  await expect(tabs).toHaveCount(1);
  await chrome.getByRole("button", { name: "Paramètres", exact: true }).click();
  await expect(chrome.locator(".settings")).toBeVisible();
  await expect(tabs).toHaveCount(1);
  // The settings tab is not empty any more: a new tab is a new one.
  await chrome.getByRole("button", { name: "Nouvel onglet" }).click();
  await expect(tabs).toHaveCount(2);
  await chrome.evaluate(() => (globalThis as unknown as Window).browser.downloads.openPage());
  await expect(chrome.locator(".tab.active .title")).toHaveText("Téléchargements");
  await expect(tabs).toHaveCount(2);
});

test("settings rows keep readable labels at medium and small sizes", async ({ app, chrome }) => {
  await chrome.getByRole("button", { name: "Paramètres", exact: true }).click();
  for (const [width, height] of [
    [1024, 700],
    [640, 420],
  ] as const) {
    await setWindowSize(app, width, height);
    await expect
      .poll(() => chrome.evaluate(() => (globalThis as unknown as { innerWidth: number }).innerWidth))
      .toBeGreaterThanOrEqual(width);
    const actualWidth = await chrome.evaluate(() => (globalThis as unknown as { innerWidth: number }).innerWidth);
    expect(actualWidth).toBeLessThanOrEqual(width + 4);
    const widths = await chrome.locator(".settings .row .label").evaluateAll((labels) =>
      labels
        .map((label) => (label as unknown as { getBoundingClientRect(): { width: number; height: number } }).getBoundingClientRect())
        .filter((rect) => rect.height > 0)
        .map((rect) => rect.width),
    );
    expect(widths.length).toBeGreaterThan(10);
    // A label may be short ("Ombres"), but its column never is: measure the text column.
    const columns = await chrome.locator(".settings .row .text").evaluateAll((items) =>
      items.map((item) => (item as unknown as { getBoundingClientRect(): { width: number } }).getBoundingClientRect().width),
    );
    expect(Math.min(...columns)).toBeGreaterThanOrEqual(155);
  }
});

test("the window bar unfolds from the top edge only: the sidebar's modes at its start, window buttons at its end (ADR-045)", async ({ chrome }) => {
  const contentWidth = () => chrome.evaluate(() => (globalThis as unknown as { innerWidth: number }).innerWidth);
  const close = chrome.getByRole("button", { name: "Fermer la fenêtre" });
  const bar = chrome.getByTestId("window-bar");
  const viewportTop = async () => (await chrome.locator(".viewport").boundingBox())!.y;

  // At rest: folded to the top gutter, no button drawn; the sidebar starts with its navigation row.
  await chrome.mouse.move(600, 500);
  await expect(close).toHaveCount(0);
  await expect(chrome.getByRole("button", { name: /^Mode zen/ })).toHaveCount(0);
  expect(await viewportTop()).toBeLessThanOrEqual(10);
  expect((await chrome.getByRole("button", { name: "Précédent" }).boundingBox())!.y).toBeLessThan(16);

  const unfold = async () => {
    const strip = (await bar.boundingBox())!;
    await chrome.mouse.move(strip.x + strip.width / 2, strip.y + 2);
    await expect(close).toBeVisible();
  };
  const checkButtons = async () => {
    expect((await close.boundingBox())!.y).toBeLessThan(16);
    for (const name of ["Réduire", "Agrandir", "Fermer la fenêtre"])
      expect((await chrome.getByRole("button", { name }).boundingBox())!.width).toBeGreaterThanOrEqual(28);
    // The window buttons at the window's right edge, the toggles at its left.
    expect((await close.boundingBox())!.x + 36).toBeGreaterThan((await contentWidth()) - 12);
    const modes = chrome.getByRole("radiogroup", { name: "Barre latérale" }).getByRole("radio");
    await expect(modes).toHaveCount(3);
    expect((await modes.first().boundingBox())!.x).toBeLessThan(60);
    expect((await modes.last().boundingBox())!.x).toBeLessThan(140);
  };

  await unfold();
  await checkButtons();
  // The page makes room below it, and gets its height back once the pointer leaves.
  await expect.poll(viewportTop).toBeGreaterThanOrEqual(40);
  await chrome.mouse.move(600, 400);
  await expect(close).toHaveCount(0);
  await expect.poll(viewportTop).toBeLessThanOrEqual(10);

  // One labeled choice among Complète, Compacte and Zen: the current one is checked.
  await unfold();
  const full = chrome.getByRole("radio", { name: "Complète" });
  const compact = chrome.getByRole("radio", { name: "Compacte" });
  await expect(full).toHaveAttribute("aria-checked", "true");
  await compact.click();
  await expect(chrome.getByTestId("compact-rail")).toBeVisible();
  await expect(compact).toHaveAttribute("aria-checked", "true");
  await expect(full).toHaveAttribute("aria-checked", "false");
  // Clicking the current Compacte again goes back to Complète, never a no-op.
  await compact.click();
  await expect(chrome.locator(".sidebar")).toBeVisible();
  await expect(full).toHaveAttribute("aria-checked", "true");
  await compact.click();
  await full.click();
  await expect(chrome.locator(".sidebar")).toBeVisible();
  await expect(chrome.getByTestId("compact-rail")).toHaveCount(0);
  await chrome.mouse.move(600, 500);
  await expect(close).toHaveCount(0);

  // Sidebar on the right: same bar.
  await api(chrome).update({ layout: { sidebarPosition: "right" } });
  await unfold();
  await checkButtons();
  await chrome.mouse.move(600, 500);
  await expect(close).toHaveCount(0);
  await api(chrome).update({ layout: { sidebarPosition: "left" } });

  // macOS layout (simulated): no drawn window buttons, and the traffic lights' corner stays empty.
  await chrome.evaluate(() => ((globalThis as unknown as Dom).document.documentElement.dataset.platform = "darwin"));
  const strip = (await bar.boundingBox())!;
  await chrome.mouse.move(strip.x + strip.width / 2, strip.y + 2);
  const toggle = chrome.getByRole("radiogroup", { name: "Barre latérale" });
  await expect(toggle).toBeVisible();
  await expect(close).toHaveCount(0);
  expect((await toggle.boundingBox())!.x).toBeGreaterThanOrEqual(72);
  await chrome.mouse.move(600, 500);
  await expect(toggle).toHaveCount(0);
});

test("the start page zooms on its own, never the sidebar (ADR-045)", async ({ app, chrome }) => {
  const sidebar = (await chrome.locator(".sidebar").boundingBox())!;
  const page = chrome.locator(".drawn-page");
  await expect(page).toBeVisible();
  await chrome.getByTestId("app-menu-button").click();
  const overlay = await overlayOf(app);
  const zoomOut = overlay.getByRole("button", { name: "Zoom arrière" });
  await expect(zoomOut).toBeEnabled();
  await zoomOut.click();
  await expect(overlay.getByTestId("app-menu-zoom")).toHaveText(/90/);
  await overlay.keyboard.press("Escape");
  await expect(page).toHaveCSS("zoom", "0.9");
  // Still filling the page's card; the sidebar keeps its size.
  const card = (await chrome.locator(".viewport").boundingBox())!;
  const box = (await page.boundingBox())!;
  expect(Math.abs(box.width - card.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(box.height - card.height)).toBeLessThanOrEqual(1);
  expect((await chrome.locator(".sidebar").boundingBox())!.width).toBe(sidebar.width);
  // Remembered for the pages the UI draws: browser://settings is zoomed too, and its chip resets it.
  await visit(chrome, "browser://settings", "Paramètres");
  await expect(page).toHaveCSS("zoom", "0.9");
  await chrome.getByRole("button", { name: /^Zoom 90 %/ }).click();
  await expect(page).toHaveCSS("zoom", "1");
});

test("a space color goes through the contrast engine", async ({ chrome }) => {
  const read = () =>
    chrome.locator(".shell").evaluate((shell) => {
      const style = (globalThis as unknown as Dom).getComputedStyle(shell);
      return { accent: style.getPropertyValue("--accent").trim(), text: style.getPropertyValue("--accent-text").trim() };
    });
  const space = await chrome.evaluate(() => (globalThis as unknown as Window).browser.spaces.create({ name: "Jaune", color: "#fff200" }));
  expect(space).not.toBeNull();
  await api(chrome).update({ appearance: { mode: "light" } });
  await expect.poll(async () => (await read()).accent).not.toBe("");
  const light = await read();
  // Clamped fill, and a darker accent text than the raw yellow.
  expect(light.accent).not.toBe("#fff200");
  expect(light.text).not.toBe(light.accent);
});

test("the app menu opens upwards from the sidebar footer and reaches the internal pages (ADR-045)", async ({ app, chrome }) => {
  // One "…" menu in the sidebar: no separate Outils menu any more.
  await expect(chrome.getByRole("button", { name: "Outils" })).toHaveCount(0);
  const button = chrome.getByTestId("app-menu-button");
  const footer = (await chrome.locator(".footer").boundingBox())!;
  const anchor = (await button.boundingBox())!;
  expect(anchor.y).toBeGreaterThanOrEqual(footer.y);
  await button.click();
  const overlay = await overlayOf(app);
  const menu = overlay.getByRole("menu", { name: "Menu de l'application" });
  await expect(menu).toBeVisible();
  // Above its button, inside the window.
  const box = (await overlay.getByTestId("app-menu").boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(anchor.y);
  for (const name of ["Mots de passe", "Adresses et paiements", "Extensions et thèmes", "Bibliothèque"])
    await expect(menu.getByRole("menuitem", { name, exact: true })).toBeVisible();
  // A submenu near the bottom opens upwards, inside the window too.
  await menu.getByRole("menuitem", { name: "Aide", exact: true }).hover();
  const help = overlay.getByRole("menu", { name: "Aide" });
  await expect(help).toBeVisible();
  const height = await overlay.evaluate(() => (globalThis as unknown as { innerHeight: number }).innerHeight);
  const helpBox = (await help.boundingBox())!;
  expect(helpBox.y).toBeGreaterThanOrEqual(0);
  expect(helpBox.y + helpBox.height).toBeLessThanOrEqual(height);
  await overlay.keyboard.press("Escape");
  await overlay.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
});

type Box = { scrollWidth: number; clientWidth: number };

test("at rest, the URL uses the whole address bar and its host is never clipped", async ({ chrome, server }) => {
  await visit(chrome, server.url("/projets/2026/roadmap"), "Page projets/2026/roadmap");
  await chrome.mouse.move(900, 600);
  const display = chrome.getByTestId("address-display");
  await expect(display).toBeVisible();
  await expect(chrome.getByRole("button", { name: "Options de la page" })).toHaveCSS("opacity", "0");
  const host = await display.locator(".host").evaluate((element) => {
    const box = element as unknown as Box;
    return { scroll: box.scrollWidth, client: box.clientWidth };
  });
  expect(host.scroll).toBeLessThanOrEqual(host.client);
  await expect(display.locator(".host")).toHaveText("127.0.0.1");
  // The hidden buttons take no room: the URL spans the bar but for the lock and the padding.
  const bar = (await chrome.locator(".address").boundingBox())!;
  const url = (await display.boundingBox())!;
  expect(url.width).toBeGreaterThanOrEqual(bar.width - 48);
  // Hovering does not move the URL.
  await chrome.locator(".address").hover();
  await expect(chrome.getByRole("button", { name: "Options de la page" })).toHaveCSS("opacity", "1");
  expect((await display.boundingBox())!.x).toBe(url.x);
});

test("the theme gallery is a full-width grid, several cards per line", async ({ app, chrome }) => {
  await setWindowSize(app, 1280, 800);
  await chrome.getByRole("button", { name: "Paramètres", exact: true }).click();
  const gallery = chrome.getByRole("group", { name: "Galerie de thèmes" });
  await expect(gallery).toBeVisible();
  const tops = await gallery
    .getByRole("button")
    .evaluateAll((cards) => cards.map((card) => Math.round((card as unknown as { getBoundingClientRect(): { top: number } }).getBoundingClientRect().top)));
  expect(tops.filter((top) => top === tops[0]).length).toBeGreaterThanOrEqual(3);
  // It spans the settings card, not just the right-hand control slot.
  const row = (await chrome.locator(".settings .row", { has: gallery }).boundingBox())!;
  expect((await gallery.boundingBox())!.width).toBeGreaterThanOrEqual(row.width - 40);
});

test("the settings search keeps only the matching rows", async ({ chrome }) => {
  await chrome.getByRole("button", { name: "Paramètres", exact: true }).click();
  const search = chrome.getByRole("searchbox", { name: "Rechercher un réglage" });
  await search.fill("zen");
  await expect(chrome.locator(".settings .row:visible .label")).toHaveText(["Mode zen"]);
  await search.fill("introuvablexyz");
  await expect(chrome.getByText("Aucun réglage trouvé")).toBeVisible();
  await search.press("Escape");
  await expect(search).toHaveValue("");
  expect(await chrome.locator(".settings .row:visible").count()).toBeGreaterThan(10);
});
