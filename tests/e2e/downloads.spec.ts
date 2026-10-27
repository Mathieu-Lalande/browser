import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ElectronApplication, Page } from "@playwright/test";
import { DOWNLOAD_CONTENT, chromeOf, evalInTab, expect, launch, overlayOf, test } from "./fixtures";

/** Native key press through the main process, so Electron menu accelerators fire (see library.spec.ts). */
async function press(app: ElectronApplication, keyCode: string, modifiers: ("control" | "shift")[] = ["control"]): Promise<void> {
  await app.evaluate(
    ({ BrowserWindow }, { keyCode, modifiers }) => {
      const contents = BrowserWindow.getAllWindows()[0].webContents;
      contents.sendInputEvent({ type: "keyDown", keyCode, modifiers });
      contents.sendInputEvent({ type: "keyUp", keyCode, modifiers });
    },
    { keyCode, modifiers },
  );
}

async function visit(chrome: Page, url: string, title: string): Promise<void> {
  const address = chrome.getByLabel("Barre d'adresse");
  await address.fill(url);
  await address.press("Enter");
  await expect(chrome.locator(".tab.active .title")).toHaveText(title);
}

/** Launches on a profile whose downloads go to `folder` (the setting, as the user would choose it). */
async function launchWithFolder(profile: string, folder: string): Promise<ElectronApplication> {
  mkdirSync(profile, { recursive: true });
  writeFileSync(join(profile, "settings.json"), JSON.stringify({ version: 1, data: { downloads: { folder } } }));
  return launch(profile);
}

let folder: string;
test.beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), "browser-downloads-"));
});
test.afterEach(() => rmSync(folder, { recursive: true, force: true }));

test("a download goes straight to the downloads folder under a unique name, and shows in browser://downloads", async ({
  profile,
  server,
}) => {
  const app = await launchWithFolder(profile, folder);
  try {
    const chrome = await chromeOf(app);
    await visit(chrome, server.url("/downloads"), "Downloads");
    // A file of the same name is already there: the download must not overwrite it.
    writeFileSync(join(folder, "report.pdf"), "older file");
    await evalInTab(app, server.url("/downloads"), `document.getElementById("pdf").click()`);

    // No save dialog: the file simply lands in the folder.
    const saved = join(folder, "report (1).pdf");
    await expect.poll(() => existsSync(saved) && readFileSync(saved, "utf8")).toBe(DOWNLOAD_CONTENT);
    expect(readFileSync(join(folder, "report.pdf"), "utf8")).toBe("older file");

    // The sidebar button opens the popover in the overlay layer.
    await chrome.getByRole("button", { name: "Téléchargements", exact: true }).click();
    const overlay = await overlayOf(app);
    const panel = overlay.getByRole("dialog", { name: "Téléchargements" });
    await expect(panel).toBeVisible();
    await expect(panel.getByText("report (1).pdf")).toBeVisible();
    await expect(panel.getByText(/^Terminé/)).toBeVisible();
    await panel.press("Escape");
    await expect(panel).toBeHidden();

    // Ctrl+Shift+J: the full list.
    await press(app, "J", ["control", "shift"]);
    await expect(chrome.locator(".tab.active .title")).toHaveText("Téléchargements");
    await expect(chrome.getByLabel("Barre d'adresse")).toHaveValue("browser://downloads");
    const row = chrome.locator(".download", { hasText: "report (1).pdf" });
    await expect(row).toBeVisible();
    await expect(row.getByRole("button", { name: "Ouvrir report (1).pdf" })).toBeVisible();
    await expect(row.locator(".source")).toHaveAttribute("title", server.url("/files/report.pdf"));

    const search = chrome.getByLabel("Rechercher dans les téléchargements");
    await search.fill("nothing like this");
    await expect(chrome.getByText("Aucun téléchargement ne correspond à cette recherche.")).toBeVisible();
    await search.fill("report");
    await expect(row).toBeVisible();

    // The history is saved; clearing the list keeps the files.
    await expect.poll(() => existsSync(join(profile, "downloads.json")) && readFileSync(join(profile, "downloads.json"), "utf8")).toContain(
      "report (1).pdf",
    );
    await chrome.getByRole("button", { name: "Effacer la liste" }).click();
    await expect(chrome.getByText("Aucun téléchargement pour l'instant.")).toBeVisible();
    expect(existsSync(saved)).toBe(true);
  } finally {
    await app.close();
  }
});

test("an executable waits for confirmation before reaching the downloads folder", async ({ profile, server }) => {
  const app = await launchWithFolder(profile, folder);
  try {
    const chrome = await chromeOf(app);
    await visit(chrome, server.url("/downloads"), "Downloads");
    await evalInTab(app, server.url("/downloads"), `document.getElementById("exe").click()`);
    await press(app, "J", ["control", "shift"]);

    const row = chrome.locator(".download", { hasText: "setup.exe" });
    await expect(row.getByText("Fichier potentiellement dangereux · à confirmer")).toBeVisible();
    // Kept aside under a neutral name: nothing in the downloads folder, and nothing to open yet.
    expect(readdirSync(folder)).toEqual([]);
    await expect(row.getByRole("button", { name: /^Ouvrir/ })).toHaveCount(0);
    // The sidebar button flags the pending decision.
    await expect(chrome.getByRole("button", { name: "Téléchargements : un fichier attend votre confirmation" })).toBeVisible();

    await row.getByRole("button", { name: "Conserver" }).click();
    await expect(row.getByText(/^Terminé/)).toBeVisible();
    await expect.poll(() => existsSync(join(folder, "setup.exe")) && readFileSync(join(folder, "setup.exe"), "utf8")).toBe(DOWNLOAD_CONTENT);

    // A second one, discarded this time: it never reaches the folder.
    await evalInTab(app, server.url("/downloads"), `document.getElementById("exe").click()`);
    const second = chrome.locator(".download", { hasText: "setup.exe" }).filter({ hasText: "à confirmer" });
    await second.getByRole("button", { name: "Supprimer" }).click();
    await expect(chrome.locator(".download", { hasText: "Annulé" })).toHaveCount(1);
    expect(readdirSync(folder)).toEqual(["setup.exe"]);
  } finally {
    await app.close();
  }
});

test("downloads work in an isolated space too (every space session gets the handler)", async ({ profile, server }) => {
  const app = await launchWithFolder(profile, folder);
  try {
    const chrome = await chromeOf(app);
    await chrome.evaluate(`window.browser.spaces.create({ name: "Travail", isolated: true })`);
    await expect(chrome.locator(".space-name")).toHaveText("Travail");
    await visit(chrome, server.url("/downloads"), "Downloads");
    // The page really lives in its own partition, not the default session.
    const partitioned = await app.evaluate(({ session, webContents }, url) => {
      const page = webContents.getAllWebContents().find((contents) => contents.getURL() === url)!;
      return page.session !== session.defaultSession;
    }, server.url("/downloads"));
    expect(partitioned).toBe(true);

    await evalInTab(app, server.url("/downloads"), `document.getElementById("pdf").click()`);
    await expect.poll(() => existsSync(join(folder, "report.pdf")) && readFileSync(join(folder, "report.pdf"), "utf8")).toBe(DOWNLOAD_CONTENT);
    await evalInTab(app, server.url("/downloads"), `document.getElementById("exe").click()`);
    await expect(chrome.getByRole("button", { name: "Téléchargements : un fichier attend votre confirmation" })).toBeVisible();
    expect(readdirSync(folder)).toEqual(["report.pdf"]);
  } finally {
    await app.close();
  }
});

test("pages cannot reach the downloads IPC, and the folder setting only takes absolute paths", async ({ app, server }) => {
  const chrome = await chromeOf(app);
  await visit(chrome, server.url("/downloads"), "Downloads");
  // Tab pages have no preload: no `browser` API at all.
  expect(await evalInTab(app, server.url("/downloads"), `typeof window.browser`)).toBe("undefined");
  const next = await chrome.evaluate<{ folder: string }>(
    `window.browser.settings.update({ downloads: { folder: "relative/../path" } }).then((s) => s.downloads)`,
  );
  expect(next.folder).toBe("");
});
