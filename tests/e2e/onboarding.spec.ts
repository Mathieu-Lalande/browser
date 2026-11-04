import { mkdtempSync, rmSync } from "node:fs";
import { platform, tmpdir } from "node:os";
import { join } from "node:path";
import type { BrowserApi } from "@shared/ipc";
import { makeChromiumUserData } from "../fixtures/import/profiles";
import { chromeOf, expect, launch, test } from "./fixtures";

/** ADR-043: the first-run onboarding, crash report opt-in and the bug report link. */

type Api = { browser: BrowserApi };
/** The fixtures skip the welcome page; these tests want it back. */
const WELCOME = { BROWSER_TEST_SKIP_WELCOME: "" };

test("a fresh profile opens on the welcome page: theme, import, default browser, essentials, then never again", async ({ profile }) => {
  const source = mkdtempSync(join(tmpdir(), "browser-chromium-"));
  makeChromiumUserData(source);
  let app = await launch(profile, { ...WELCOME, BROWSER_TEST_IMPORT_DIR: source });
  try {
    let chrome = await chromeOf(app);
    const page = chrome.getByTestId("welcome-page");
    await expect(page).toHaveAttribute("data-step", "hello");
    await expect(chrome.locator(".tab.active .title")).toHaveText("Bienvenue");
    await expect(page.getByRole("heading", { name: "Bienvenue dans Browser" })).toBeVisible();

    // Theme: a gallery card applies at once.
    await chrome.getByTestId("welcome-next").click();
    await expect(page).toHaveAttribute("data-step", "theme");
    await page.getByRole("button", { name: "Graphite" }).click();
    await expect(page.getByRole("button", { name: "Graphite" })).toHaveAttribute("aria-pressed", "true");
    await expect.poll(async () => (await chrome.evaluate(() => (globalThis as unknown as Api).browser.settings.get())).appearance.accent).toBe("#a1a1aa");

    // Keyboard: the arrow keys move between steps.
    await page.focus();
    await chrome.keyboard.press("ArrowRight");
    await expect(page).toHaveAttribute("data-step", "import");
    await page.getByRole("radio", { name: /Chrome \(test\)/ }).click();
    await page.getByRole("button", { name: /Importer depuis/ }).click();
    await expect(chrome.getByTestId("welcome-import-summary")).toContainText("3 favoris");
    expect(await chrome.evaluate(() => (globalThis as unknown as Api).browser.bookmarks.list())).toHaveLength(3);

    await chrome.getByTestId("welcome-next").click();
    await expect(page).toHaveAttribute("data-step", "default");
    await expect(chrome.getByTestId("welcome-default")).toBeVisible();
    await chrome.keyboard.press("ArrowLeft");
    await expect(page).toHaveAttribute("data-step", "import");
    await page.getByRole("button", { name: "5. L'essentiel" }).click();
    await expect(page).toHaveAttribute("data-step", "essentials");
    await expect(page.locator("[data-tip]")).toHaveCount(4);
    await expect(page.locator("[data-tip=omnibox] kbd").last()).toHaveText("K");

    await page.getByRole("button", { name: "Commencer à naviguer" }).click();
    await expect(page).toHaveCount(0);
    await expect(chrome.locator(".start")).toBeVisible();
    await expect.poll(async () => (await chrome.evaluate(() => (globalThis as unknown as Api).browser.settings.get())).onboarding.completed).toBe(true);
    await app.close();

    // Remembered: the next start opens on the start page; Aide, Visite guidée shows it again.
    app = await launch(profile, WELCOME);
    chrome = await chromeOf(app);
    await expect(chrome.locator(".start")).toBeVisible();
    await expect(chrome.getByTestId("welcome-page")).toHaveCount(0);
    await chrome.evaluate(() => (globalThis as unknown as Api).browser.commands.run("open-welcome"));
    await expect(chrome.getByTestId("welcome-page")).toHaveAttribute("data-step", "hello");
  } finally {
    await app.close();
    rmSync(source, { recursive: true, force: true });
  }
});

test("the welcome page can be skipped at once (Passer, or Échap)", async ({ profile }) => {
  const app = await launch(profile, WELCOME);
  try {
    const chrome = await chromeOf(app);
    const page = chrome.getByTestId("welcome-page");
    await expect(page).toBeVisible();
    await page.focus();
    await chrome.keyboard.press("Escape");
    await expect(page).toHaveCount(0);
    await expect.poll(async () => (await chrome.evaluate(() => (globalThis as unknown as Api).browser.settings.get())).onboarding.completed).toBe(true);
    expect(await chrome.evaluate(() => (globalThis as unknown as Api).browser.getState().then((state) => state.tabs.length))).toBe(1);
  } finally {
    await app.close();
  }
});

/** What the crash reporter was started with, and what it does now (test hook of an unpackaged app). */
function reporter(app: Awaited<ReturnType<typeof launch>>) {
  return app.evaluate(({ crashReporter }) => {
    const service = (globalThis as unknown as { __browserCrashReports: { lastStart: { uploadToServer: boolean; submitURL: string } | null } }).__browserCrashReports;
    return { start: service.lastStart, uploading: crashReporter.getUploadToServer() };
  });
}

test("crash reports are opt-in: the setting turns Crashpad's uploads on, live and at the next start", async ({ profile }) => {
  const endpoint = { BROWSER_TEST_CRASH_ENDPOINT: "http://127.0.0.1:9/crash" };
  let app = await launch(profile, endpoint);
  try {
    let chrome = await chromeOf(app);
    // Started for local dumps only.
    expect(await reporter(app)).toMatchObject({ start: { uploadToServer: false, submitURL: "http://127.0.0.1:9/crash" }, uploading: false });

    await chrome.getByLabel("Barre d'adresse").fill("browser://settings#diagnostics");
    await chrome.getByLabel("Barre d'adresse").press("Enter");
    const toggle = chrome.getByRole("switch", { name: "Envoyer les rapports de plantage" });
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await expect(chrome.getByTestId("crash-privacy")).toContainText("rien n'est envoyé sans votre accord");
    await expect(chrome.getByTestId("crash-list-empty")).toBeVisible();
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    await expect.poll(async () => (await reporter(app)).uploading).toBe(true);
    await app.close();

    app = await launch(profile, endpoint);
    chrome = await chromeOf(app);
    expect((await reporter(app)).start?.uploadToServer).toBe(true);
    await app.close();

    // Without an endpoint in the build, the opt-in alone sends nothing.
    app = await launch(profile);
    chrome = await chromeOf(app);
    expect(await reporter(app)).toMatchObject({ start: { uploadToServer: false }, uploading: false });
  } finally {
    await app.close();
  }
});

test("Signaler un problème opens the bug form prefilled with the version and the system only", async ({ chrome }) => {
  // The tab's address (from main's state): the page itself is never loaded from the network here.
  const issueTab = () => chrome.evaluate(() => (globalThis as unknown as Api).browser.getState().then((state) => state.tabs.map((tab) => tab.url).find((url) => url.includes("github.com")) ?? ""));
  await chrome.evaluate(() => (globalThis as unknown as Api).browser.commands.run("report-issue"));
  await expect.poll(issueTab).toMatch(/issues\/new\?/);
  const params = new URL(await issueTab()).searchParams;
  expect(params.get("template")).toBe("bug.yml");
  expect(params.get("version")).toMatch(/^\d+\.\d+\.\d+ \(stable, Electron \d+/);
  expect(params.get("os")).toMatch(new RegExp(`^${platform() === "win32" ? "Windows" : platform() === "darwin" ? "macOS" : "Linux"} `));
  expect([...params.keys()].sort()).toEqual(["labels", "os", "template", "version"]);
});
