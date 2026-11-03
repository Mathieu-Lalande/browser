import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ElectronApplication, Page } from "@playwright/test";
import { chromeOf, expect, isChrome, launch, overlayOf, test, visit } from "./fixtures";

// Crash recovery, profiles, task manager, print preview and backups (ADR-042).

type Api = { browser: { commands: { run(id: string): void }; history: { search(query: string, limit: number): Promise<{ url: string }[]> } } };
const run = (chrome: Page, id: string) => chrome.evaluate((command) => (globalThis as unknown as Api).browser.commands.run(command), id);

const readText = (path: string) => (existsSync(path) ? readFileSync(path, "utf8") : "");

/** Tab titles of every window's sidebar. */
async function allTabTitles(app: ElectronApplication): Promise<string[]> {
  const titles: string[] = [];
  for (const page of app.windows().filter(isChrome)) titles.push(...(await page.locator(".tabs [role=tab] .title").allTextContents().catch(() => [])));
  return titles;
}

test("after a crash, the start page offers to restore the session", async ({ profile, server }) => {
  const first = await launch(profile);
  const chrome = await chromeOf(first);
  await visit(chrome, server.url("/one"), "Page one");
  await chrome.getByRole("button", { name: "Nouvel onglet" }).click();
  await visit(chrome, server.url("/two"), "Page two");
  // The session is written (debounced) while the app runs, then the app is killed.
  await expect.poll(() => readText(join(profile, "session.json"))).toContain("/two");
  const exited = new Promise((resolve) => first.process().once("exit", resolve));
  first.process().kill("SIGKILL");
  await exited;

  const app = await launch(profile);
  try {
    const restarted = await chromeOf(app);
    const card = restarted.getByTestId("restore-session");
    await expect(card).toContainText("Restaurer la session ?");
    // Nothing was reopened by itself.
    await expect(restarted.locator(".tabs [role=tab]")).toHaveCount(1);
    await card.getByRole("button", { name: "Tout restaurer" }).click();
    await expect.poll(() => allTabTitles(app)).toEqual(expect.arrayContaining(["Page one", "Page two"]));
  } finally {
    await app.close();
  }
});

test("a quit followed by a normal start shows no card", async ({ profile, server }) => {
  const first = await launch(profile);
  await visit(await chromeOf(first), server.url("/one"), "Page one");
  await first.close();
  const app = await launch(profile);
  try {
    const chrome = await chromeOf(app);
    await expect(chrome.locator(".tabs [role=tab] .title")).toHaveText(["Page one"]);
    await expect(chrome.getByTestId("restore-session")).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test("a second profile has its own history", async ({ profile, server }) => {
  writeFileSync(join(profile, "profiles.json"), JSON.stringify({ profiles: [{ id: "default", name: "Personnel" }, { id: "work", name: "Travail" }], lastUsed: "default" }));
  const work = await launch(profile, {}, ["--profile=work"]);
  try {
    const chrome = await chromeOf(work);
    await visit(chrome, server.url("/work-page"), "Page work-page");
    await run(chrome, "open-profiles");
    await expect(chrome.getByTestId("profiles-page").locator('[data-profile="work"]')).toContainText("Profil actuel");
  } finally {
    await work.close();
  }
  expect(readText(join(profile, "Profiles", "work", "history.json"))).toContain("/work-page");

  // The work profile is now the last used one: "Personnel" is asked for by name.
  expect(JSON.parse(readText(join(profile, "profiles.json"))).lastUsed).toBe("work");
  const personal = await launch(profile, {}, ["--profile=default"]);
  try {
    const chrome = await chromeOf(personal);
    const history = await chrome.evaluate(() => (globalThis as unknown as Api).browser.history.search("page", 50));
    expect(history.map((entry) => entry.url).join(" ")).not.toContain("/work-page");
  } finally {
    await personal.close();
  }
  expect(readText(join(profile, "history.json"))).not.toContain("/work-page");
});

test("the profiles page keeps its rows inside the page column, and the app menu lists the profiles", async ({ profile }) => {
  writeFileSync(join(profile, "profiles.json"), JSON.stringify({ profiles: [{ id: "default", name: "Personnel" }, { id: "work", name: "Travail" }], lastUsed: "default" }));
  const app = await launch(profile);
  try {
    const chrome = await chromeOf(app);
    for (const [width, height] of [
      [1280, 800],
      [800, 600],
    ]) {
      await app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0].setContentSize(w, h), [width, height]);
      await run(chrome, "open-profiles");
      const page = chrome.getByTestId("profiles-page");
      await expect(page.locator('[data-profile="work"]')).toBeVisible();
      // Every row and card of the page stays inside the content box of its column (padding excluded).
      const overflow = await page.evaluate((root) => {
        const inner = root.firstElementChild!;
        const box = inner.getBoundingClientRect();
        const style = (globalThis as unknown as { getComputedStyle(element: unknown): { paddingLeft: string; paddingRight: string } }).getComputedStyle(inner);
        const left = box.left + parseFloat(style.paddingLeft) - 0.5;
        const right = box.right - parseFloat(style.paddingRight) + 0.5;
        return [...inner.querySelectorAll(".card, .list-row, [data-row], [data-testid=backup] .body")]
          .map((element) => ({ element, rect: element.getBoundingClientRect() }))
          .filter(({ rect }) => rect.width && (rect.left < left || rect.right > right))
          .map(({ element }) => element.className);
      });
      expect(overflow).toEqual([]);
    }

    await run(chrome, "app-menu");
    const overlay = await overlayOf(app);
    await overlay.locator('[data-node="profiles"]').click();
    await expect(overlay.locator('[data-node="profiles"]')).toContainText("Profil : Personnel");
    await expect(overlay.locator('[data-node="profile-open-work"]')).toHaveText(/Ouvrir Travail/);
    await overlay.locator('[data-node="new-profile"]').click();
    await expect(chrome.getByRole("form", { name: "Nouveau profil" })).toBeVisible();
  } finally {
    await app.close();
  }
});

test("the task manager lists a tab, and ending it shows the crash page", async ({ app, chrome, server }) => {
  await visit(chrome, server.url("/victim"), "Page victim");
  await run(chrome, "open-task-manager");
  const page = chrome.getByTestId("tasks-page");
  const row = page.locator("tr", { hasText: "Onglet : Page victim" });
  await expect(row).toBeVisible();
  await expect(page.locator("tr", { hasText: "Navigateur" }).first()).toBeVisible();
  await row.getByRole("button", { name: "Terminer le processus" }).click();

  await chrome.locator(".tabs [role=tab]", { hasText: "victim" }).click();
  await expect(chrome.locator(".load-error h1")).toHaveText("Cette page a planté");
  // Reloading brings the page back in a new renderer.
  await chrome.locator(".load-error").getByRole("button", { name: "Actualiser" }).click();
  await expect(chrome.locator(".load-error")).toHaveCount(0);
  await expect.poll(() => app.evaluate(({ webContents }) => webContents.getAllWebContents().some((c) => c.getURL().includes("/victim") && !c.isCrashed()))).toBe(true);
});

test("print preview saves a PDF", async ({ profile, server }) => {
  const out = join(mkdtempSync(join(tmpdir(), "browser-print-")), "page.pdf");
  const app = await launch(profile, { BROWSER_TEST_PRINT_PDF: out });
  try {
    const chrome = await chromeOf(app);
    await visit(chrome, server.url("/printable"), "Page printable");
    await run(chrome, "print");
    const overlay = await overlayOf(app);
    const dialog = overlay.getByTestId("print-preview");
    await expect(dialog).toBeVisible();
    // The preview is a native view above the overlay, showing the generated PDF.
    await expect.poll(() => app.evaluate(({ webContents }) => webContents.getAllWebContents().some((c) => /preview-.*\.pdf/.test(c.getURL())))).toBe(true);
    await dialog.getByRole("radio", { name: "Paysage" }).click();
    await dialog.getByRole("button", { name: "Enregistrer" }).click();
    await expect.poll(() => readText(out).slice(0, 5)).toBe("%PDF-");
    await expect(dialog).toBeHidden();
  } finally {
    await app.close();
    rmSync(join(out, ".."), { recursive: true, force: true });
  }
});

test("a profile backup exports and imports back into another profile", async ({ server }) => {
  const root = mkdtempSync(join(tmpdir(), "browser-backup-"));
  const file = join(root, "profile.browserbackup");
  const first = join(root, "a");
  const second = join(root, "b");
  mkdirSync(first);
  mkdirSync(second);
  try {
    const source = await launch(first, { BROWSER_TEST_BACKUP_EXPORT: file });
    try {
      const chrome = await chromeOf(source);
      await visit(chrome, server.url("/saved-page"), "Page saved-page");
      await run(chrome, "open-profiles");
      const backup = chrome.getByTestId("backup");
      await backup.getByRole("button", { name: "Exporter le profil…" }).click();
      await expect(backup.getByRole("status")).toHaveText("Sauvegarde enregistrée.");
    } finally {
      await source.close();
    }
    const exported = readText(file);
    expect(exported).toContain("/saved-page");
    expect(exported).not.toContain("tabcookie");

    const target = await launch(second, { BROWSER_TEST_BACKUP_IMPORT: file });
    try {
      const chrome = await chromeOf(target);
      await run(chrome, "open-profiles");
      const backup = chrome.getByTestId("backup");
      await backup.getByRole("button", { name: "Importer une sauvegarde…" }).click();
      await expect(backup.getByLabel("Contenu de la sauvegarde")).toContainText("Pages de l'historique : 1");
      await backup.getByRole("button", { name: "Fusionner" }).last().click();
      await expect(backup.getByRole("status")).toHaveText("Sauvegarde importée.");
      const history = await chrome.evaluate(() => (globalThis as unknown as Api).browser.history.search("page", 50));
      expect(history.map((entry) => entry.url).join(" ")).toContain("/saved-page");
      // The backup's windows are offered on the start page.
      await chrome.getByRole("button", { name: "Nouvel onglet" }).click();
      await expect(chrome.getByTestId("restore-session")).toBeVisible();
    } finally {
      await target.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
