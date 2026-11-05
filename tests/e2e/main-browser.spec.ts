import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { ElectronApplication, Page } from "@playwright/test";
import { makeChromiumUserData } from "../fixtures/import/profiles";
import { TINY_PDF, chromeOf, expect, launch, openPrivateWindow, tabUrls, test, visit } from "./fixtures";

/** ADR-039: what it takes to be the main browser (PDF viewer, history page, import, OS hand-over). */

type Api = {
  browser: {
    downloads: { list(): Promise<{ url: string }[]> };
    bookmarks: { list(): Promise<{ url: string; title: string }[]> };
    settings: { get(): Promise<{ search: { engine: string } }> };
  };
};

/** The built-in PDF viewer runs as Chromium's PDF extension, in frames of its own. */
const PDF_VIEWER = "chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/";

function allUrls(app: ElectronApplication): Promise<string[]> {
  return app.evaluate(({ webContents }) => webContents.getAllWebContents().flatMap((contents) => [contents.getURL(), ...contents.mainFrame.framesInSubtree.map((frame) => frame.url)]));
}

async function pressCtrl(app: ElectronApplication, keyCode: string): Promise<void> {
  await app.evaluate(({ BrowserWindow }, key) => {
    const contents = BrowserWindow.getAllWindows()[0].webContents;
    contents.sendInputEvent({ type: "keyDown", keyCode: key, modifiers: ["control"] });
    contents.sendInputEvent({ type: "keyUp", keyCode: key, modifiers: ["control"] });
  }, keyCode);
}

test("shows a PDF inline in the built-in viewer, and still downloads an attachment", async ({ app, chrome, server }) => {
  const address = chrome.getByLabel("Barre d'adresse");
  await address.fill(server.url("/doc.pdf"));
  await address.press("Enter");
  await expect.poll(() => tabUrls(app)).toContain(server.url("/doc.pdf"));
  await expect.poll(async () => (await allUrls(app)).some((url) => url.startsWith(PDF_VIEWER))).toBe(true);
  expect(await chrome.evaluate(() => (globalThis as unknown as Api).browser.downloads.list())).toEqual([]);

  await address.fill(server.url("/attachment.pdf"));
  await address.press("Enter");
  await expect
    .poll(async () => (await chrome.evaluate(() => (globalThis as unknown as Api).browser.downloads.list())).map((entry) => entry.url))
    .toContain(server.url("/attachment.pdf"));
});

test("opens a local PDF handed over on the command line (file association) inline", async ({ profile }) => {
  const dir = mkdtempSync(join(tmpdir(), "browser-file-"));
  const file = join(dir, "local.pdf");
  writeFileSync(file, TINY_PDF);
  const app = await launch(profile, {}, [file, "javascript:alert(1)", join(dir, "missing.html")]);
  try {
    await chromeOf(app);
    await expect.poll(() => tabUrls(app)).toEqual([pathToFileURL(file).href]);
    await expect.poll(async () => (await allUrls(app)).some((url) => url.startsWith(PDF_VIEWER))).toBe(true);
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("browser://history lists visits by day, searches, deletes, and stays hidden in private windows", async ({ app, chrome, server }) => {
  await visit(chrome, server.url("/alpha"), "Page alpha");
  await visit(chrome, server.url("/beta"), "Page beta");
  await visit(chrome, server.url("/gamma"), "Page gamma");

  await pressCtrl(app, "H");
  const page = chrome.getByTestId("history-page");
  await expect(page).toBeVisible();
  await expect(chrome.locator(".tab.active .title")).toHaveText("Historique");
  const rows = page.locator(".history-row");
  await expect(rows).toHaveCount(3);
  await expect(page.locator(".day h2").first()).toHaveText("Aujourd'hui");
  await expect(rows.first()).toContainText("Page gamma");

  await page.getByRole("button", { name: "Supprimer Page beta de l'historique" }).click();
  await page.getByRole("button", { name: "Supprimer", exact: true }).click();
  await expect(rows).toHaveCount(2);

  await page.getByLabel("Rechercher dans l'historique").fill("alpha");
  await expect(rows).toHaveCount(1);
  await rows.first().getByRole("checkbox").click();
  await page.getByRole("button", { name: "Supprimer la sélection" }).click();
  await page.getByRole("button", { name: "Supprimer", exact: true }).click();
  await expect(rows).toHaveCount(0);
  await page.getByLabel("Rechercher dans l'historique").fill("");
  await expect(rows).toHaveCount(1);

  await page.getByRole("button", { name: "Effacer l'historique" }).click();
  await chrome.getByRole("menuitem", { name: "Tout l'historique" }).click();
  await chrome.getByRole("button", { name: "Effacer", exact: true }).click();
  await expect(rows).toHaveCount(0);
  await expect(page.getByText("Aucune page visitée")).toBeVisible();

  const privateChrome: Page = await openPrivateWindow(app, chrome);
  await privateChrome.getByLabel("Barre d'adresse").fill("browser://history");
  await privateChrome.getByLabel("Barre d'adresse").press("Enter");
  await expect(privateChrome.getByText("Historique indisponible en navigation privée")).toBeVisible();
  await expect(privateChrome.locator(".history-row")).toHaveCount(0);
});

test("imports bookmarks, history and the search engine from a Chromium profile", async ({ profile, server }) => {
  void server;
  const source = mkdtempSync(join(tmpdir(), "browser-chromium-"));
  makeChromiumUserData(source);
  const app = await launch(profile, { BROWSER_TEST_IMPORT_DIR: source });
  try {
    const chrome = await chromeOf(app);
    await chrome.getByLabel("Barre d'adresse").fill("browser://import");
    await chrome.getByLabel("Barre d'adresse").press("Enter");
    const page = chrome.getByTestId("import-page");
    await page.getByRole("radio", { name: /Chrome \(test\)/ }).click();
    await expect(page.getByRole("checkbox", { name: "Historique" })).toHaveAttribute("aria-checked", "true");
    await page.getByRole("button", { name: "Importer", exact: true }).click();
    const summary = page.getByTestId("import-summary");
    await expect(summary).toContainText("3 favoris importés");
    await expect(summary).toContainText("2 pages ajoutées à l'historique");
    await expect(summary).toContainText("Moteur de recherche : Brave Search");

    const bookmarks = await chrome.evaluate(() => (globalThis as unknown as Api).browser.bookmarks.list());
    expect(bookmarks.map((bookmark) => bookmark.url).sort()).toEqual(["https://developer.mozilla.org/", "https://example.com/", "https://fr.wikipedia.org/"]);
    expect((await chrome.evaluate(() => (globalThis as unknown as Api).browser.settings.get())).search.engine).toBe("brave");

    // Again: nothing is duplicated.
    await page.getByRole("button", { name: "Importer", exact: true }).click();
    await expect(summary).toContainText("0 favori importé, 3 déjà présents");
    expect(await chrome.evaluate(() => (globalThis as unknown as Api).browser.bookmarks.list())).toHaveLength(3);
  } finally {
    await app.close();
    rmSync(source, { recursive: true, force: true });
  }
});
