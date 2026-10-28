import { fileURLToPath } from "node:url";
import type { BrowserApi } from "@shared/ipc";
import { evalInTab, expect, test, visit } from "./fixtures";

/** Browser extensions (ADR-024). */

type Global = { browser: BrowserApi };
const EXTENSION = fileURLToPath(new URL("./extension", import.meta.url));

test("an unpacked MV3 extension applies its content script, and stops once disabled", async ({ app, chrome, server }) => {
  // The folder dialog answers with the test extension.
  await app.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [folder] })) as unknown as typeof dialog.showOpenDialog;
  }, EXTENSION);

  await chrome.evaluate(() => (globalThis as unknown as Global).browser.commands.run("open-extensions"));
  const page = chrome.getByTestId("extensions-page");
  await expect(page.getByText("Aucune extension installée.")).toBeVisible();
  await page.getByRole("button", { name: "Charger un dossier" }).click();
  await expect(page.getByText("« Extension de test » est installée.")).toBeVisible();
  await expect(page.locator("[data-extension-id]")).toHaveCount(1);
  // The browser UI's own session (in memory, Chromium's "incognito" side of the default one) never
  // runs extension scripts, even on a web URL (the dev server's case).
  const inUi = await app.evaluate(async ({ BrowserWindow }, url) => {
    const ui = BrowserWindow.getAllWindows()[0].webContents.session;
    const probe = new BrowserWindow({ show: false, webPreferences: { session: ui } });
    await probe.loadURL(url);
    const marked = await probe.webContents.executeJavaScript("document.documentElement.dataset.ext ?? null");
    probe.destroy();
    return { persistent: ui.isPersistent(), marked };
  }, server.url("/ui-probe"));
  expect(inUi).toEqual({ persistent: false, marked: null });

  const marker = (url: string) => () =>
    evalInTab<string | null>(app, url, "document.readyState === 'complete' ? (document.documentElement.dataset.ext ?? null) : 'loading'");
  await visit(chrome, server.url("/marked"), "Page marked");
  await expect.poll(marker(server.url("/marked"))).toBe("1");

  // Disabled: the page, reloaded, is left alone.
  await chrome.evaluate(() => (globalThis as unknown as Global).browser.commands.run("open-extensions"));
  await page.getByRole("switch", { name: "Désactiver Extension de test" }).click();
  await expect(page.getByRole("switch", { name: "Activer Extension de test" })).toHaveAttribute("aria-checked", "false");
  await visit(chrome, server.url("/marked?again"), "Page marked?again");
  await evalInTab(app, server.url("/marked?again"), "location.reload()");
  await expect.poll(marker(server.url("/marked?again"))).toBe(null);
});
