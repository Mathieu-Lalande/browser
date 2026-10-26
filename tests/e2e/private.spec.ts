import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ElectronApplication, Page } from "@playwright/test";
import type { BrowserApi } from "@shared/ipc";
import type { BrowserState } from "@shared/types";
import { chromeOf, evalInTab, expect, launch, tabUrls, test } from "./fixtures";

async function visit(chrome: Page, url: string, title: string): Promise<void> {
  const address = chrome.getByLabel("Barre d'adresse");
  await address.fill(url);
  await address.press("Enter");
  await expect(chrome.locator(".tab.active .title")).toHaveText(title);
}

const stateOf = (chrome: Page) => chrome.evaluate(() => (globalThis as unknown as { browser: BrowserApi }).browser.getState()) as Promise<BrowserState>;

const chromePages = (app: ElectronApplication) => app.windows().filter((page) => page.url().endsWith("/renderer/index.html"));

/**
 * Opens a private window: with Ctrl+Shift+N through the main process (menu accelerators do not fire
 * on Playwright key presses), or by running the registry command from the chrome UI.
 */
async function openPrivateWindow(app: ElectronApplication, chrome?: Page): Promise<Page> {
  if (chrome) {
    await chrome.evaluate(() => (globalThis as unknown as { browser: BrowserApi }).browser.commands.run("new-private-window"));
  } else {
    await app.evaluate(({ BrowserWindow }) => {
      const contents = BrowserWindow.getAllWindows()[0].webContents;
      contents.sendInputEvent({ type: "keyDown", keyCode: "N", modifiers: ["control", "shift"] });
      contents.sendInputEvent({ type: "keyUp", keyCode: "N", modifiers: ["control", "shift"] });
    });
  }
  await expect.poll(() => chromePages(app).length).toBe(2);
  let found: Page | undefined;
  await expect
    .poll(async () => {
      for (const page of chromePages(app)) {
        if ((await stateOf(page).catch(() => null))?.isPrivate) found = page;
      }
      return !!found;
    })
    .toBe(true);
  await found!.waitForSelector(".sidebar");
  return found!;
}

test("a private window has its own cookies, writes no history and is not restored", async ({ profile, server }) => {
  let app = await launch(profile);
  try {
    const chrome = await chromeOf(app);
    await visit(chrome, server.url("/normal"), "Page normal");
    await evalInTab(app, server.url("/normal"), "document.cookie = 'who=normal; path=/'");

    const priv = await openPrivateWindow(app);
    await expect(priv.locator(".private-badge")).toHaveText("Navigation privée");
    await expect(priv.getByRole("heading", { name: "Navigation privée" })).toBeVisible();
    // One ephemeral space, no space switcher.
    await expect(priv.getByRole("tablist", { name: "Espaces" })).toHaveCount(0);
    expect((await stateOf(priv)).spaces.map((space) => space.id)).toEqual(["private"]);

    await visit(priv, server.url("/secret"), "Page secret");
    // The normal window's cookie is not there, and the private one does not leak back.
    expect(await evalInTab(app, server.url("/secret"), "document.cookie")).toBe("");
    await evalInTab(app, server.url("/secret"), "document.cookie = 'who=private; path=/'");
    expect(await evalInTab(app, server.url("/normal"), "document.cookie")).toBe("who=normal");
    expect(
      await app.evaluate(({ webContents }, url) => {
        const page = webContents.getAllWebContents().find((contents) => contents.getURL() === url)!;
        return page.session.isPersistent();
      }, server.url("/secret")),
    ).toBe(false);

    // Shields toggled in a private window are not written to the profile.
    await visit(priv, server.url("/shields"), "Shields");
    await priv.locator(".address .shield").click();
    await expect(priv.locator(".address .shield")).toHaveAttribute("aria-pressed", "false");

    // No history: neither the visit nor the page title is recorded.
    const search = (text: string) =>
      chrome.evaluate((text) => (globalThis as unknown as { browser: BrowserApi }).browser.history.search(text, 10), text);
    await expect.poll(async () => (await search("normal")).length).toBe(1);
    expect(await search("secret")).toEqual([]);
    expect(await search("Shields")).toEqual([]);
  } finally {
    await app.close();
  }

  // Nothing on disk mentions the private pages.
  for (const file of ["history.json", "session.json"]) {
    const content = readFileSync(join(profile, file), "utf8");
    expect(content).toContain("/normal");
    expect(content).not.toContain("/secret");
    expect(content).not.toContain("/shields");
  }
  expect(existsSync(join(profile, "shields.json"))).toBe(false);

  // After a restart, only the normal window comes back.
  app = await launch(profile);
  try {
    const chrome = await chromeOf(app);
    await expect(chrome.locator(".tab.active .title")).toHaveText("Page normal");
    await expect.poll(() => tabUrls(app)).toEqual([server.url("/normal")]);
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
    expect((await stateOf(chrome)).isPrivate).toBeFalsy();
  } finally {
    await app.close();
  }
});

test("closing a private window wipes its partition", async ({ app, chrome, server }) => {
  const priv = await openPrivateWindow(app, chrome);
  await visit(priv, server.url("/wiped"), "Page wiped");
  await evalInTab(app, server.url("/wiped"), "localStorage.setItem('k', 'v'); document.cookie = 'c=1; path=/'; true");
  // Keep a handle on the session to look at it once the window is gone.
  await app.evaluate(({ webContents }, url) => {
    const page = webContents.getAllWebContents().find((contents) => contents.getURL() === url)!;
    (globalThis as unknown as { privateSession: Electron.Session }).privateSession = page.session;
  }, server.url("/wiped"));
  const cookieCount = () =>
    app.evaluate(async () => {
      const ses = (globalThis as unknown as { privateSession: Electron.Session }).privateSession;
      return (await ses.cookies.get({})).length;
    });
  expect(await cookieCount()).toBe(1);
  // The page may go away before the evaluation returns.
  await priv.evaluate(() => (globalThis as unknown as { browser: BrowserApi }).browser.window.close()).catch(() => {});
  await expect.poll(() => chromePages(app).length).toBe(1);
  await expect.poll(cookieCount).toBe(0);
  // The normal window is unaffected.
  await expect(chrome.locator(".sidebar")).toBeVisible();
});
