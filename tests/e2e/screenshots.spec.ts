import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromeOf, evalInTab, expect, launch, test } from "./fixtures";

/**
 * Documentation screenshots, only with SCREENSHOTS=1 (under xvfb-run, needs ImageMagick).
 * The X screen is captured: `BrowserWindow.capturePage()` would miss the native child views.
 */
test.skip(!process.env.SCREENSHOTS, "set SCREENSHOTS=1 to refresh docs/screenshots");

const article = `<!doctype html><title>Le guide des navigateurs rapides</title>
<style>
  body { margin: 0; font: 17px/1.6 Georgia, serif; color: #1f2328; background: #fbfaf7; }
  header { padding: 22px 48px; border-bottom: 1px solid #e7e3da; font: 600 15px system-ui, sans-serif; letter-spacing: .02em; }
  main { max-width: 680px; margin: 48px auto; padding: 0 24px; }
  h1 { font-size: 42px; line-height: 1.15; margin: 0 0 18px; }
  .lead { font-size: 20px; color: #59636e; }
  .hero { height: 220px; margin: 28px 0; border-radius: 14px; background: linear-gradient(135deg, #f6a04d, #e8536b 45%, #7b5cf0); }
</style>
<header>LE JOURNAL DU WEB</header>
<main><h1>Le guide des navigateurs rapides</h1>
<p class="lead">Onglets verticaux, palette de commandes et protection de la vie privée : ce qui change vraiment au quotidien.</p>
<div class="hero"></div>
<p>Un bon navigateur s'efface derrière les pages. Les raccourcis clavier y jouent un rôle central : tout doit être à une touche de distance, sans jamais quitter le clavier.</p></main>`;

test("command palette over a page", async ({ app, chrome, server }) => {
  const colorScheme = process.env.SCREENSHOT_THEME === "light" ? "light" : "dark";
  await chrome.emulateMedia({ colorScheme });
  const address = chrome.getByLabel("Barre d'adresse");
  for (const path of ["/docs", "/notes", "/projets"]) {
    await address.fill(server.url(path));
    await address.press("Enter");
    await chrome.getByRole("button", { name: "Nouvel onglet" }).click();
  }
  await address.fill(`data:text/html;charset=utf-8,${encodeURIComponent(article)}`);
  await address.press("Enter");
  await expect(chrome.locator(".tab.active .title")).toHaveText("Le guide des navigateurs rapides");

  await expect.poll(() => app.windows().some((page) => page.url().endsWith("/renderer/overlay.html"))).toBe(true);
  const overlay = app.windows().find((page) => page.url().endsWith("/renderer/overlay.html"))!;
  await overlay.emulateMedia({ colorScheme });
  await app.evaluate(({ BrowserWindow }) => {
    const contents = BrowserWindow.getAllWindows()[0].webContents;
    contents.sendInputEvent({ type: "keyDown", keyCode: "K", modifiers: ["control"] });
    contents.sendInputEvent({ type: "keyUp", keyCode: "K", modifiers: ["control"] });
  });
  const input = overlay.getByRole("combobox", { name: "Palette de commandes" });
  await expect(input).toBeFocused();
  await input.pressSequentially(process.env.PALETTE_QUERY ?? "pa");
  await expect(overlay.locator(".backdrop")).toBeVisible();
  // Let the open animation and the backdrop fade finish.
  await new Promise((resolve) => setTimeout(resolve, 600));

  const bounds = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getContentBounds());
  mkdirSync("docs/screenshots", { recursive: true });
  execFileSync("import", [
    "-window",
    "root",
    "-crop",
    `${bounds.width}x${bounds.height}+${bounds.x}+${bounds.y}`,
    "+repage",
    "-strip",
    "-colors",
    "256",
    "docs/screenshots/palette.png",
  ]);
});

/** A dark-themed profile whose downloads go to a scratch folder. */
function prepareProfile(profile: string): string {
  const folder = mkdtempSync(join(tmpdir(), "browser-shots-"));
  const settings = { appearance: { mode: process.env.SCREENSHOT_THEME === "light" ? "light" : "dark" }, downloads: { folder } };
  writeFileSync(join(profile, "settings.json"), JSON.stringify({ version: 1, data: settings }));
  return folder;
}

const articleUrl = `data:text/html;charset=utf-8,${encodeURIComponent(article)}`;

test("downloads popover", async ({ profile, server }) => {
  const folder = prepareProfile(profile);
  const app = await launch(profile);
  try {
    const chrome = await chromeOf(app);
    const address = chrome.getByLabel("Barre d'adresse");
    await address.fill(server.url("/downloads"));
    await address.press("Enter");
    await expect(chrome.locator(".tab.active .title")).toHaveText("Downloads");
    for (const id of ["pdf", "exe", "slow"]) {
      await evalInTab(app, server.url("/downloads"), `document.getElementById("${id}").click()`);
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    await address.fill(articleUrl);
    await address.press("Enter");
    await expect(chrome.locator(".tab.active .title")).toHaveText("Le guide des navigateurs rapides");
    await new Promise((resolve) => setTimeout(resolve, 2500));

    await chrome.getByRole("button", { name: /^Téléchargements/ }).click();
    const overlay = app.windows().find((page) => page.url().endsWith("/renderer/overlay.html"))!;
    await expect(overlay.getByRole("dialog", { name: "Téléchargements" })).toBeVisible();
    await new Promise((resolve) => setTimeout(resolve, 400));
    await captureWindow(app, "downloads");
  } finally {
    await app.close();
    rmSync(folder, { recursive: true, force: true });
  }
});

test("find bar", async ({ profile }) => {
  const folder = prepareProfile(profile);
  const app = await launch(profile);
  try {
    const chrome = await chromeOf(app);
    const address = chrome.getByLabel("Barre d'adresse");
    await address.fill(articleUrl);
    await address.press("Enter");
    await expect(chrome.locator(".tab.active .title")).toHaveText("Le guide des navigateurs rapides");
    await app.evaluate(({ BrowserWindow }) => {
      const contents = BrowserWindow.getAllWindows()[0].webContents;
      contents.sendInputEvent({ type: "keyDown", keyCode: "F", modifiers: ["control"] });
      contents.sendInputEvent({ type: "keyUp", keyCode: "F", modifiers: ["control"] });
    });
    const input = chrome.getByRole("search", { name: "Rechercher dans la page" }).getByRole("textbox");
    await expect(input).toBeFocused();
    await input.pressSequentially("navigateur");
    await input.press("Enter");
    await expect(chrome.getByTestId("find-count")).toHaveText(/^2\//);
    await new Promise((resolve) => setTimeout(resolve, 400));
    await captureWindow(app, "find");
  } finally {
    await app.close();
    rmSync(folder, { recursive: true, force: true });
  }
});

/** A small article page with its own colors, as a `data:` URL. */
const page = (title: string, accent: string, body: string) =>
  `data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html><title>${title}</title>
<style>
  body { margin: 0; font: 16px/1.6 system-ui, sans-serif; color: #1f2328; background: #fbfaf7; }
  header { padding: 18px 32px; border-bottom: 1px solid #e7e3da; font-weight: 600; color: ${accent}; letter-spacing: .04em; }
  main { max-width: 560px; margin: 36px auto; padding: 0 24px; }
  h1 { font-size: 32px; line-height: 1.2; margin: 0 0 14px; }
  .card { height: 140px; margin: 22px 0; border-radius: 12px; background: linear-gradient(135deg, ${accent}, #7b5cf0); }
  p { color: #59636e; }
</style>
<header>${title.toUpperCase()}</header><main><h1>${title}</h1><div class="card"></div><p>${body}</p></main>`)}`;

/** Captures the window's area of the X screen (pages included) into docs/screenshots/<name>.png. */
async function captureWindow(app: import("./fixtures").ElectronApplication, name: string): Promise<void> {
  const bounds = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getContentBounds());
  mkdirSync("docs/screenshots", { recursive: true });
  execFileSync("import", [
    "-window",
    "root",
    "-crop",
    `${bounds.width}x${bounds.height}+${bounds.x}+${bounds.y}`,
    "+repage",
    "-strip",
    "-colors",
    "256",
    `docs/screenshots/${name}.png`,
  ]);
}

async function open(chrome: import("@playwright/test").Page, url: string, title: string, newTab = true): Promise<void> {
  if (newTab) await chrome.getByRole("button", { name: "Nouvel onglet" }).click();
  const address = chrome.getByLabel("Barre d'adresse");
  await address.fill(url);
  await address.press("Enter");
  await expect(chrome.locator(".tab.active .title")).toHaveText(title);
}

type Api = import("@shared/ipc").BrowserApi;

test("sidebar with spaces", async ({ app, chrome }) => {
  await chrome.emulateMedia({ colorScheme: "dark" });
  await open(chrome, page("Notes de voyage", "#e8536b", "Lisbonne, Porto et la côte."), "Notes de voyage", false);
  await open(chrome, page("Recettes d'automne", "#f6a04d", "Courge rôtie et châtaignes."), "Recettes d'automne");
  for (const input of [
    { name: "Travail", icon: "💼", color: "#4fc3a1", isolated: true },
    { name: "Études", icon: "📚", color: "#5aa9ff" },
  ]) {
    await chrome.evaluate((input) => (globalThis as unknown as { browser: Api }).browser.spaces.create(input), input);
  }
  const spaces = chrome.getByRole("tablist", { name: "Espaces" }).getByRole("tab");
  await spaces.nth(1).click();
  await expect(chrome.locator(".space-name")).toHaveText("Travail");
  await open(chrome, page("Feuille de route Q4", "#4fc3a1", "Objectifs, jalons et équipe."), "Feuille de route Q4", false);
  await open(chrome, page("Revue de code", "#2f9e7f", "Trois commentaires à traiter."), "Revue de code");
  await open(chrome, page("Tableau de bord", "#4fc3a1", "Indicateurs de la semaine."), "Tableau de bord");
  await chrome.locator(".tabs [role=tab]").first().dblclick();
  await chrome.locator(".tabs [role=tab]", { hasText: "Tableau de bord" }).click();
  // The edit popover, as opened from the space's "⋯" button.
  await chrome.getByRole("button", { name: "Modifier l'espace" }).click();
  await expect(chrome.getByRole("dialog", { name: "Modifier l'espace" })).toBeVisible();
  await chrome.getByLabel("Nom de l'espace").blur();
  await new Promise((resolve) => setTimeout(resolve, 500));
  await captureWindow(app, "spaces");
});

test("private window", async ({ app, chrome }) => {
  await app.evaluate(({ BrowserWindow }) => {
    const contents = BrowserWindow.getAllWindows()[0].webContents;
    contents.sendInputEvent({ type: "keyDown", keyCode: "N", modifiers: ["control", "shift"] });
    contents.sendInputEvent({ type: "keyUp", keyCode: "N", modifiers: ["control", "shift"] });
  });
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(2);
  // Only the private window stays on screen (captureWindow shoots the first window).
  await chrome.evaluate(() => (globalThis as unknown as { browser: Api }).browser.window.close());
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
  const priv = app.windows().find((candidate) => candidate.url().endsWith("/renderer/index.html") && !candidate.isClosed())!;
  await priv.waitForSelector(".private-badge");
  await open(priv, page("Idées cadeaux", "#e8536b", "Une surprise pour dimanche."), "Idées cadeaux", false);
  await open(priv, page("Billets de train", "#5aa9ff", "Paris → Lyon, samedi matin."), "Billets de train");
  await priv.getByRole("button", { name: "Nouvel onglet" }).click();
  await expect(priv.getByRole("heading", { name: "Navigation privée" })).toBeVisible();
  await priv.locator(".start input").blur();
  await new Promise((resolve) => setTimeout(resolve, 600));
  await captureWindow(app, "private");
});

test("split view", async ({ app, chrome }) => {
  await chrome.emulateMedia({ colorScheme: "dark" });
  await open(chrome, `data:text/html;charset=utf-8,${encodeURIComponent(article)}`, "Le guide des navigateurs rapides", false);
  await open(chrome, page("Notes de lecture", "#5aa9ff", "Raccourcis, espaces et vue scindée : à essayer cette semaine."), "Notes de lecture");
  await open(chrome, page("Brouillon", "#e8536b", "Plan de l'article."), "Brouillon");
  const { tabs } = await chrome.evaluate(() => (globalThis as unknown as { browser: Api }).browser.getState());
  await chrome.locator(".tabs [role=tab]", { hasText: "Notes de lecture" }).click();
  await chrome.evaluate((id) => (globalThis as unknown as { browser: Api }).browser.split.open(id), tabs[0].id);
  await chrome.evaluate(() => (globalThis as unknown as { browser: Api }).browser.split.setRatios(0.42, 0.5));
  await expect(chrome.locator(".split .pane")).toHaveCount(2);
  await new Promise((resolve) => setTimeout(resolve, 600));
  await captureWindow(app, "split");
});
