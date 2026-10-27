import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ElectronApplication, Page } from "@playwright/test";
import type { BrowserApi } from "@shared/ipc";
import { createSyncServer } from "../../server/src/server";
import { chromeOf, expect, launch, openPrivateWindow, test, visit } from "./fixtures";

/** Fast sync rounds for the test (5 s debounce and 5 min period in real use). */
const SYNC_ENV = { BROWSER_TEST_SYNC_DEBOUNCE_MS: "200", BROWSER_TEST_SYNC_INTERVAL_MS: "800" };

type Window = typeof globalThis & { browser: BrowserApi };

async function openSyncSettings(chrome: Page): Promise<void> {
  await chrome.evaluate(() => (globalThis as Window).browser.settings.open());
  await chrome.getByRole("navigation", { name: "Sections des paramètres" }).getByRole("button", { name: "Synchronisation" }).click();
}

/** Every file under `dir`, as text. */
function readAll(dir: string): string {
  let text = "";
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    text += statSync(path).isDirectory() ? readAll(path) : readFileSync(path, "latin1");
  }
  return text;
}

test("two desktops pair through the relay, sync bookmarks and tabs, and the server stores no plaintext", async ({ server }) => {
  test.setTimeout(90_000);
  const dataDir = mkdtempSync(join(tmpdir(), "browser-relay-"));
  const { server: relay } = createSyncServer({ dataDir });
  await new Promise<void>((resolve) => relay.listen(0, "127.0.0.1", resolve));
  const relayUrl = `http://127.0.0.1:${(relay.address() as AddressInfo).port}`;
  const profiles = [mkdtempSync(join(tmpdir(), "browser-e2e-a-")), mkdtempSync(join(tmpdir(), "browser-e2e-b-"))];
  const apps: ElectronApplication[] = [];
  try {
    apps.push(await launch(profiles[0], SYNC_ENV), await launch(profiles[1], SYNC_ENV));
    const [a, b] = await Promise.all(apps.map(chromeOf));

    // A creates the account on the self-hosted relay.
    await openSyncSettings(a);
    await a.getByLabel("Adresse du serveur de synchronisation").fill(relayUrl);
    await a.getByRole("button", { name: "Activer la synchronisation" }).click();
    await expect(a.locator(".phase")).toHaveAttribute("data-phase", /idle|syncing/);

    // The pairing code is only shown after an explicit warning.
    await a.getByRole("button", { name: "Afficher le code de jumelage" }).click();
    await expect(a.getByRole("alert")).toContainText("accès complet");
    await a.getByRole("button", { name: "Afficher le code", exact: true }).click();
    await expect(a.getByRole("img", { name: "QR code de jumelage" })).toBeVisible();
    const code = await a.getByRole("textbox", { name: "Code de jumelage", exact: true }).inputValue();
    expect(code).toMatch(/^browser-sync:1:/);

    // B pastes it.
    await openSyncSettings(b);
    await b.getByRole("textbox", { name: "Code de jumelage", exact: true }).fill(code);
    await b.getByRole("button", { name: "Jumeler cet appareil" }).click();
    await expect(b.locator(".phase")).toHaveAttribute("data-phase", /idle|syncing/);

    // A bookmark added on A shows up on B.
    const bookmarkUrl = server.url("/synced-bookmark-page");
    await a.evaluate((url) => (globalThis as Window).browser.bookmarks.add({ url, title: "Favori synchronisé" }), bookmarkUrl);
    await expect
      .poll(async () => (await b.evaluate(() => (globalThis as Window).browser.bookmarks.list())).map((bookmark) => bookmark.url), { timeout: 20_000 })
      .toContain(bookmarkUrl);

    // A's normal tab is listed on B; a private window's tab never is.
    await visit(a, server.url("/visible-tab"), "Page visible-tab");
    const priv = await openPrivateWindow(apps[0], a);
    await visit(priv, server.url("/private-secret-tab"), "Page private-secret-tab");

    const remoteUrls = async () => {
      const status = await b.evaluate(() => (globalThis as Window).browser.sync.status());
      return status.devices.flatMap((device) => device.tabs.map((tab) => tab.url));
    };
    await expect.poll(remoteUrls, { timeout: 20_000 }).toContain(server.url("/visible-tab"));
    // A few more sync rounds: the private tab must still be absent.
    await a.evaluate(() => (globalThis as Window).browser.sync.syncNow());
    await b.waitForTimeout(2500);
    expect(await remoteUrls()).not.toContain(server.url("/private-secret-tab"));
    await expect(b.getByText("Onglets de mes autres appareils")).toBeVisible();

    // Zero knowledge: nothing readable on the server's disk.
    const stored = readAll(dataDir);
    expect(stored.length).toBeGreaterThan(500);
    for (const secret of ["synced-bookmark-page", "Favori synchronis", "visible-tab", "private-secret-tab", "127.0.0.1", "http://"]) {
      expect(stored).not.toContain(secret);
    }
  } finally {
    await Promise.all(apps.map((app) => app.close().catch(() => {})));
    await new Promise((resolve) => relay.close(resolve));
    for (const dir of [dataDir, ...profiles]) rmSync(dir, { recursive: true, force: true });
  }
});
