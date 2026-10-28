import type { BrowserApi } from "@shared/ipc";
import { attachedViews, expect, test, visit, type ElectronApplication } from "./fixtures";
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
  await app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0].setContentSize(w, h), [width, height] as const);
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
    await expect.poll(async () => (await tabs.first().boundingBox())!.height).toBe(expected);
    const heights = await tabs.evaluateAll((items) => items.map((item) => (item as unknown as { offsetHeight: number }).offsetHeight));
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
  await expect(tabs.first()).toHaveAttribute("title", "Page d'accueil");
  await chrome.getByRole("button", { name: "Nouvel onglet" }).click();
  await chrome.getByRole("button", { name: "Nouvel onglet" }).click();
  await expect(tabs).toHaveCount(1);
  await chrome.getByRole("button", { name: "Paramètres" }).click();
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
  await chrome.getByRole("button", { name: "Paramètres" }).click();
  for (const [width, height] of [
    [1024, 700],
    [640, 420],
  ] as const) {
    await setWindowSize(app, width, height);
    await expect.poll(() => chrome.evaluate(() => (globalThis as unknown as { innerWidth: number }).innerWidth)).toBe(width);
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

test("window controls sit in the sidebar, and unfold at the top of the window when it is hidden", async ({ chrome }) => {
  const contentWidth = () => chrome.evaluate(() => (globalThis as unknown as { innerWidth: number }).innerWidth);
  const close = chrome.getByRole("button", { name: "Fermer la fenêtre" });
  const checkButtons = async () => {
    await expect(close).toBeVisible();
    expect((await close.boundingBox())!.y).toBeLessThan(16);
    for (const name of ["Réduire", "Agrandir", "Fermer la fenêtre"])
      expect((await chrome.getByRole("button", { name }).boundingBox())!.width).toBeGreaterThanOrEqual(28);
  };
  // Sidebar on the left: buttons at the start of its title bar, the page takes the full height.
  await checkButtons();
  const sidebar = (await chrome.locator(".sidebar").boundingBox())!;
  expect((await close.boundingBox())!.x + 36).toBeLessThan(sidebar.x + sidebar.width);
  expect((await chrome.locator(".viewport").boundingBox())!.y).toBeLessThanOrEqual(10);

  // Sidebar hidden: no bar above the page until the pointer reaches the top edge.
  await chrome.getByRole("button", { name: "Masquer la barre latérale" }).click();
  await expect(chrome.locator(".sidebar")).toHaveCount(0);
  await expect(close).toHaveCount(0);
  expect((await chrome.locator(".viewport").boundingBox())!.y).toBeLessThanOrEqual(10);
  // Move the pointer there (the strip is replaced by the bar as soon as it is hovered).
  const edge = (await chrome.getByTestId("top-edge").boundingBox())!;
  await chrome.mouse.move(edge.x + edge.width / 2, edge.y + 2);
  await checkButtons();
  expect((await close.boundingBox())!.x + 36).toBeGreaterThan((await contentWidth()) - 12);
  // Back down on the page: the bar folds away and the page gets its height back.
  await chrome.mouse.move(edge.x + edge.width / 2, 400);
  await expect(close).toHaveCount(0);
  await chrome.mouse.move(edge.x + edge.width / 2, edge.y + 2);
  await expect(chrome.getByRole("button", { name: "Afficher la barre latérale" })).toBeVisible();
  await chrome.getByRole("button", { name: "Afficher la barre latérale" }).click();
  await chrome.mouse.move(600, 500);

  // Sidebar on the right: buttons at the window's right edge, in its title bar.
  await api(chrome).update({ layout: { sidebarPosition: "right" } });
  await checkButtons();
  expect((await close.boundingBox())!.x + 36).toBeGreaterThan((await contentWidth()) - 12);
  await api(chrome).update({ layout: { sidebarPosition: "left" } });

  // macOS layout (simulated): no drawn controls, and the traffic lights' corner stays empty.
  await chrome.evaluate(() => ((globalThis as unknown as Dom).document.documentElement.dataset.platform = "darwin"));
  await expect(chrome.getByRole("button", { name: "Fermer la fenêtre" })).toHaveCount(0);
  const titlebarButtons = await chrome.locator(".titlebar button").evaluateAll((items) =>
    items.map((item) => (item as unknown as { getBoundingClientRect(): { x: number } }).getBoundingClientRect().x),
  );
  expect(Math.min(...titlebarButtons)).toBeGreaterThanOrEqual(72);
  await chrome.getByRole("button", { name: "Masquer la barre latérale" }).click();
  const reveal = (await chrome.getByRole("button", { name: "Afficher la barre latérale" }).boundingBox())!;
  expect(reveal.x).toBeGreaterThanOrEqual(72);
  const viewport = (await chrome.locator(".viewport").boundingBox())!;
  expect(viewport.y).toBeGreaterThanOrEqual(36);
  await chrome.getByRole("button", { name: "Afficher la barre latérale" }).click();
  await api(chrome).update({ layout: { sidebarPosition: "right" } });
  await expect(chrome.getByTestId("traffic-lights-band")).toBeVisible();
  await expect.poll(async () => (await chrome.locator(".sidebar").boundingBox())!.y).toBeGreaterThanOrEqual(36);
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
