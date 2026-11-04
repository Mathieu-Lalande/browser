import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ElectronApplication, Page } from "@playwright/test";
import { clickInTab, evalInTab, expect, overlayOf, test } from "./fixtures";

// Page options, captures and recording (ADR-031).

type Api = { browser: { commands: { run(id: string): void } } };
const run = (chrome: Page, id: string) => chrome.evaluate((command) => (globalThis as unknown as Api).browser.commands.run(command), id);

async function visit(chrome: Page, url: string, title: string): Promise<void> {
  const address = chrome.getByLabel("Barre d'adresse");
  await address.fill(url);
  await address.press("Enter");
  await expect(chrome.locator(".tab.active .title")).toHaveText(title);
}

/** Native save dialogs answer `path` (they cannot be driven from a test). */
async function saveTo(app: ElectronApplication, path: string): Promise<void> {
  await app.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: path })) as unknown as typeof dialog.showSaveDialog;
  }, path);
}

/** Width and height from a PNG's IHDR chunk. */
function pngSize(path: string): { width: number; height: number } {
  const data = readFileSync(path);
  expect(data.subarray(1, 4).toString()).toBe("PNG");
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
}

const zoomOf = (app: ElectronApplication, prefix: string) =>
  app.evaluate(({ webContents }, prefix) => webContents.getAllWebContents().find((c) => c.getURL().startsWith(prefix))?.getZoomFactor() ?? null, prefix);

let dir: string;
test.beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "browser-capture-"));
});
test.afterEach(() => rmSync(dir, { recursive: true, force: true }));

test("the address bar's buttons appear on hover or keyboard focus", async ({ chrome, server }) => {
  await visit(chrome, server.url("/one"), "Page one");
  // Away from the bar: hidden, but laid out (the URL does not move when they appear).
  await chrome.mouse.move(600, 600);
  const copy = chrome.getByRole("button", { name: "Copier le lien" });
  const options = chrome.getByRole("button", { name: "Options de la page" });
  await expect(copy).toHaveCSS("opacity", "0");
  await expect(options).toHaveCSS("opacity", "0");
  const before = await chrome.getByLabel("Barre d'adresse").boundingBox();

  await chrome.locator(".address").hover();
  await expect(copy).toHaveCSS("opacity", "1");
  await expect(options).toHaveCSS("opacity", "1");
  expect(await chrome.getByLabel("Barre d'adresse").boundingBox()).toEqual(before);

  await chrome.mouse.move(600, 600);
  await expect(copy).toHaveCSS("opacity", "0");
  await copy.focus();
  await expect(options).toHaveCSS("opacity", "1");
});

test("the page options popover zooms the tab live", async ({ app, chrome, server }) => {
  const url = server.url("/one");
  await visit(chrome, url, "Page one");
  await chrome.locator(".address").hover();
  await chrome.getByRole("button", { name: "Options de la page" }).click();
  const overlay = await overlayOf(app);
  const panel = overlay.getByRole("dialog", { name: "Options de la page" });
  await expect(panel).toBeVisible();
  for (const label of ["Copier le lien", "Capture d'écran", "Enregistrer une vidéo", "Version mobile", "Infos sur le site", "Partager (code QR)"]) {
    await expect(panel.getByRole("button", { name: label })).toBeVisible();
  }

  await panel.getByRole("button", { name: "Zoom avant" }).click();
  await expect.poll(() => zoomOf(app, url)).toBeCloseTo(1.1);
  await expect(panel.getByTestId("page-zoom")).toHaveText(/110/);
  await panel.getByRole("button", { name: "Zoom arrière" }).click();
  await panel.getByRole("button", { name: "Zoom arrière" }).click();
  await expect.poll(() => zoomOf(app, url)).toBeCloseTo(0.9);
  await panel.getByTestId("page-zoom").click();
  await expect.poll(() => zoomOf(app, url)).toBeCloseTo(1);

  // The capture submenu.
  await panel.getByRole("button", { name: "Capture d'écran" }).click();
  await expect(panel.getByRole("button", { name: "Page entière" })).toBeVisible();
  await overlay.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
});

test("visible area, whole page and element screenshots are saved as PNGs", async ({ app, chrome, server }) => {
  const url = server.url("/long");
  await visit(chrome, url, "Long");
  const [width, height, scrollHeight, devicePixelRatio] = await evalInTab<number[]>(app, url, "[innerWidth, innerHeight, document.documentElement.scrollHeight, devicePixelRatio]");
  const overlay = await overlayOf(app);
  const result = overlay.getByRole("dialog", { name: "Capture d'écran" });

  async function captureAndSave(name: string): Promise<{ width: number; height: number }> {
    await expect(result).toBeVisible();
    const path = join(dir, name);
    await saveTo(app, path);
    await result.getByRole("button", { name: "Enregistrer" }).click();
    await expect(result).toHaveCount(0);
    await expect.poll(() => existsSync(path)).toBe(true);
    return pngSize(path);
  }

  await run(chrome, "screenshot-visible");
  expect(await captureAndSave("visible.png")).toEqual({ width: Math.round(width * devicePixelRatio), height: Math.round(height * devicePixelRatio) });

  await run(chrome, "screenshot-full");
  await expect(result.getByTestId("capture-size")).toHaveText(new RegExp(`× ${Math.round(scrollHeight * devicePixelRatio)}$`));
  const full = await captureAndSave("full.png");
  expect(full.height).toBe(Math.round(scrollHeight * devicePixelRatio));
  expect(full.height).toBeGreaterThan(devicePixelRatio * height * 2);
  expect(full.width).toBeGreaterThan(devicePixelRatio * (width - 20));
  expect(full.width).toBeLessThanOrEqual(Math.round(width * devicePixelRatio));
  // The page is left as it was.
  expect(await evalInTab<number>(app, url, "scrollY")).toBe(0);

  // Element: the picker waits for a click on the page, then captures that element only.
  await run(chrome, "screenshot-element");
  await expect.poll(() => evalInTab<boolean>(app, url, `document.documentElement.textContent.includes("Cliquez sur un élément")`)).toBe(true);
  await clickInTab(app, url, "#box");
  expect(await captureAndSave("element.png")).toEqual({ width: Math.round(240 * devicePixelRatio), height: Math.round(120 * devicePixelRatio) });
  // The picker is gone.
  expect(await evalInTab<boolean>(app, url, `document.documentElement.textContent.includes("Cliquez sur un élément")`)).toBe(false);
});

test("recording a tab shows a timer and saves a WebM video", async ({ app, chrome, server }) => {
  test.skip(process.platform === "win32", "Electron 44 does not complete MediaRecorder.stop() on Windows.");
  const url = server.url("/video");
  await visit(chrome, url, "Video");
  const path = join(dir, "video.webm");
  await saveTo(app, path);

  await run(chrome, "record-video");
  const status = chrome.getByRole("status", { name: /Enregistrement en cours/ });
  await expect(status).toBeVisible();
  // Visible without hovering the bar.
  await chrome.mouse.move(600, 600);
  await expect(chrome.getByRole("button", { name: "Arrêter l'enregistrement" })).toHaveCSS("opacity", "1");
  await expect(status).toHaveAttribute("aria-label", /0:0[1-9]/, { timeout: 5000 });

  await chrome.getByRole("button", { name: "Arrêter l'enregistrement" }).click();
  await expect(status).toHaveCount(0, { timeout: 15_000 });
  await expect.poll(() => existsSync(path), { timeout: 10_000 }).toBe(true);
  const data = readFileSync(path);
  expect(data.length).toBeGreaterThan(1000);
  // WebM (EBML) signature.
  expect(data.subarray(0, 4).toString("hex")).toBe("1a45dfa3");
});
