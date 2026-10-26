import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "@playwright/test";
import { evalInTab, expect, tabUrls, test } from "./fixtures";

/**
 * Smoke test of a packaged build (asar), only when `BROWSER_PACKAGED` names its executable, e.g.
 * `npm run dist:dir && BROWSER_PACKAGED=release/linux-unpacked/browser xvfb-run -a npx playwright test packaging`
 * (the CI packaging job runs it on Linux).
 */
const executable = process.env.BROWSER_PACKAGED;
test.skip(!executable, "set BROWSER_PACKAGED to a packaged executable (npm run dist:dir)");

test("the packaged app starts, browses, and runs its filter worker from the asar archive", async ({ server }) => {
  const profile = mkdtempSync(join(tmpdir(), "browser-packaged-"));
  const app = await electron.launch({
    executablePath: resolve(executable!),
    args: ["--no-sandbox"],
    env: {
      ...process.env,
      BROWSER_PROFILE_DIR: profile,
      BROWSER_TEST_FILTERS: fileURLToPath(new URL("./filters.txt", import.meta.url)),
    },
  });
  try {
    expect(await app.evaluate(({ app }) => app.isPackaged)).toBe(true);
    await expect.poll(() => app.windows().some((page) => /app\.asar\/out\/renderer\/index\.html$/.test(page.url()))).toBe(true);
    const chrome = app.windows().find((page) => page.url().endsWith("/renderer/index.html"))!;
    await chrome.waitForSelector(".sidebar");
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible())).toBe(true);
    // The overlay page (second renderer entry) is packaged too: it is pre-warmed after the window shows.
    await expect.poll(() => app.windows().some((page) => page.url().endsWith("/renderer/overlay.html"))).toBe(true);

    const address = chrome.getByLabel("Barre d'adresse");
    await address.fill(server.url("/shields"));
    await address.press("Enter");
    await expect(chrome.locator(".tab.active .title")).toHaveText("Shields");
    await expect(chrome.locator(".address .shield .count")).toHaveText("2");
    expect(await tabUrls(app)).toEqual([server.url("/shields")]);
    expect(await evalInTab(app, server.url("/shields"), "window.adLoaded === true")).toBe(false);

    // The filter lists are parsed in a worker thread whose script lives inside app.asar.
    const worker = await app.evaluate(async ({ app }) => {
      const { Worker } = process.getBuiltinModule("node:worker_threads");
      const fs = process.getBuiltinModule("node:fs");
      const path = process.getBuiltinModule("node:path");
      const dir = path.join(app.getAppPath(), "out/main/chunks");
      const file = path.join(dir, fs.readdirSync(dir).find((name: string) => name.startsWith("blocker-worker"))!);
      return new Promise<{ file: string; bytes?: number; error?: string }>((done) => {
        const thread = new Worker(file, { workerData: { lists: ["||ads.example^"], resources: null } });
        thread.once("message", (bytes: Uint8Array) => done({ file, bytes: bytes.length }));
        thread.once("error", (error: Error) => done({ file, error: String(error) }));
      });
    });
    expect(worker.file).toContain("app.asar");
    expect(worker.error).toBeUndefined();
    expect(worker.bytes).toBeGreaterThan(0);
  } finally {
    await app.close();
    rmSync(profile, { recursive: true, force: true });
  }
});
