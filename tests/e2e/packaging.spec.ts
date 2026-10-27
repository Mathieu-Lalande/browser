import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { listPackage } from "@electron/asar";
import { FuseV1Options, FuseVersion, getCurrentFuseWire } from "@electron/fuses";
import { FiltersEngine } from "@ghostery/adblocker";
import { chromium } from "@playwright/test";
import { ENGINE_CONFIG } from "../../src/main/privacy/blocker-config";
import { CHROME_URL, OVERLAY_URL, expect, test } from "./fixtures";

/**
 * Smoke test of a packaged build (asar, fuses), only when `BROWSER_PACKAGED` names its executable, e.g.
 * `npm run dist:dir && BROWSER_PACKAGED=release/linux-unpacked/browser xvfb-run -a npx playwright test packaging`
 * (the CI packaging job runs it on Linux).
 *
 * The fuses turn the Node inspector off (ADR-018), so Playwright's Electron driver (which evaluates
 * code in the main process through it) cannot attach: the app is driven through Chromium's DevTools
 * protocol instead, like any Chromium browser — its pages only, never its main process.
 */
const executable = process.env.BROWSER_PACKAGED;
test.skip(!executable, "set BROWSER_PACKAGED to a packaged executable (npm run dist:dir)");

test("the packaged build has its Electron fuses set (ADR-018)", async () => {
  const wire = await getCurrentFuseWire(resolve(executable!));
  expect(wire.version).toBe(FuseVersion.V1);
  const on = (fuse: FuseV1Options) => wire[fuse] === "1".charCodeAt(0);
  expect(on(FuseV1Options.RunAsNode)).toBe(false);
  expect(on(FuseV1Options.EnableCookieEncryption)).toBe(true);
  expect(on(FuseV1Options.EnableNodeOptionsEnvironmentVariable)).toBe(false);
  expect(on(FuseV1Options.EnableNodeCliInspectArguments)).toBe(false);
  expect(on(FuseV1Options.EnableEmbeddedAsarIntegrityValidation)).toBe(true);
  expect(on(FuseV1Options.OnlyLoadAppFromAsar)).toBe(true);
  expect(on(FuseV1Options.GrantFileProtocolExtraPrivileges)).toBe(false);
});

test("the packaged app keeps its code, renderer and filter worker inside app.asar", () => {
  const asar = join(dirname(resolve(executable!)), "resources", "app.asar");
  const files = listPackage(asar, { isPack: false }).map((file) => file.replaceAll("\\", "/"));
  expect(files).toContain("/out/renderer/index.html");
  expect(files).toContain("/out/renderer/overlay.html");
  expect(files.some((file) => /^\/out\/main\/chunks\/blocker-worker.*\.js$/.test(file))).toBe(true);
  // onlyLoadAppFromAsar: there is no unpacked app folder to fall back to.
  expect(existsSync(join(dirname(asar), "app"))).toBe(false);
});

test("the packaged app starts, browses, blocks, and ignores the dev and test hooks", async ({ server }) => {
  const profile = mkdtempSync(join(tmpdir(), "browser-packaged-"));
  const ignored = mkdtempSync(join(tmpdir(), "browser-packaged-ignored-"));
  // Test hooks are ignored by a packaged app (ADR-018): the filter engine is seeded in the profile
  // instead (a fresh cache is used as is), and the profile is chosen with Chromium's own switch.
  const filters = readFileSync(fileURLToPath(new URL("./filters.txt", import.meta.url)), "utf8");
  mkdirSync(join(profile, "adblock"), { recursive: true });
  writeFileSync(join(profile, "adblock", "engine.bin"), FiltersEngine.parse(filters, ENGINE_CONFIG).serialize());
  const child = spawn(resolve(executable!), ["--no-sandbox", `--user-data-dir=${profile}`, "--remote-debugging-port=0"], {
    env: { ...process.env, BROWSER_PROFILE_DIR: ignored, BROWSER_TEST_FILTERS: "/nonexistent", ELECTRON_RENDERER_URL: "http://127.0.0.1:9/" },
    stdio: "ignore",
  });
  try {
    // Chromium writes its DevTools port into the profile it uses: the one --user-data-dir names.
    const portFile = join(profile, "DevToolsActivePort");
    await expect.poll(() => existsSync(portFile), { timeout: 15_000 }).toBe(true);
    const port = readFileSync(portFile, "utf8").split("\n")[0];
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    const pages = () => browser.contexts().flatMap((context) => context.pages());

    // Served from app:// out of the archive, never from the dev server named in the environment.
    await expect.poll(() => pages().some((page) => page.url() === CHROME_URL)).toBe(true);
    const chrome = pages().find((page) => page.url() === CHROME_URL)!;
    await chrome.waitForSelector(".sidebar");
    // The overlay page (second renderer entry) is packaged too: it is pre-warmed after the window shows.
    await expect.poll(() => pages().some((page) => page.url() === OVERLAY_URL)).toBe(true);

    const address = chrome.getByLabel("Barre d'adresse");
    await address.fill(server.url("/shields"));
    await address.press("Enter");
    await expect(chrome.locator(".tab.active .title")).toHaveText("Shields");
    // The seeded engine blocks the decoys (BROWSER_TEST_FILTERS pointed nowhere and was ignored).
    await expect(chrome.locator(".address .shield .count")).toHaveText("2");
    await expect.poll(() => pages().some((page) => page.url() === server.url("/shields"))).toBe(true);
    const tab = pages().find((page) => page.url() === server.url("/shields"))!;
    expect(await tab.evaluate("window.adLoaded === true")).toBe(false);
    // BROWSER_PROFILE_DIR was ignored too.
    expect(readdirSync(ignored)).toEqual([]);
    await browser.close();
  } finally {
    child.kill();
    await new Promise((done) => (child.exitCode !== null ? done(null) : child.once("exit", done)));
    rmSync(profile, { recursive: true, force: true });
    rmSync(ignored, { recursive: true, force: true });
  }
});
