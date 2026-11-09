import type { ElectronApplication, Page } from "@playwright/test";
import { evalInTab, expect, isChrome, tabUrls, test, visit } from "./fixtures";

/** ADR-048: mini window for links from other apps, launch switches (Jump List), energy saver. */

const MINI_URL = "app://browser/mini.html";

type Api = {
  browser: {
    getState(): Promise<{ tabs: { url: string }[]; activeSpaceId: string; isPrivate?: boolean; energy?: { active: boolean; reason: string | null } }>;
    settings: { update(patch: unknown): Promise<unknown> };
    spaces: { create(input: { name: string }): Promise<{ id: string } | null>; switchTo(id: string): void };
  };
};
/** What another app does: a second launch of the browser, with `args` on its command line. */
function launchAgain(app: ElectronApplication, args: string[]): Promise<void> {
  return app.evaluate(({ app: electronApp }, argv) => void electronApp.emit("second-instance", {}, ["browser", ...argv], process.cwd(), {}), args);
}

const miniBars = (app: ElectronApplication) =>
  app.evaluate(({ webContents }, url) => webContents.getAllWebContents().filter((contents) => contents.getURL() === url).length, MINI_URL);

const state = (chrome: Page) => chrome.evaluate(() => (globalThis as unknown as Api).browser.getState());

test("a link from another app opens in a mini window, then moves into a tab without reloading (ADR-048)", async ({ app, chrome, server }) => {
  const link = server.url("/mini-one");
  await launchAgain(app, [link]);
  await expect.poll(() => miniBars(app)).toBe(1);
  await expect.poll(() => tabUrls(app)).toContain(link);
  // Not a tab of the browser window.
  expect((await state(chrome)).tabs.map((tab) => tab.url)).not.toContain(link);
  const bar = app.windows().find((page) => page.url() === MINI_URL)!;
  await expect(bar.getByTestId("mini-bar")).toContainText("Page mini-one");
  await expect(bar.getByRole("button", { name: "Ouvrir dans le navigateur" })).toBeVisible();

  // The page keeps its state across the move (no reload).
  await evalInTab(app, link, "globalThis.__mark = 42");
  await app.evaluate(({ webContents }, url) => {
    const page = webContents.getAllWebContents().find((contents) => contents.getURL() === url)!;
    page.sendInputEvent({ type: "keyDown", keyCode: "O", modifiers: ["control"] });
    page.sendInputEvent({ type: "keyUp", keyCode: "O", modifiers: ["control"] });
  }, link);
  await expect.poll(() => miniBars(app)).toBe(0);
  await expect.poll(async () => (await state(chrome)).tabs.map((tab) => tab.url)).toContain(link);
  expect(await evalInTab(app, link, "globalThis.__mark")).toBe(42);
  await expect(chrome.locator(".tab.active .title")).toHaveText("Page mini-one");

  // Closing a mini window discards its page.
  const other = server.url("/mini-two");
  await launchAgain(app, [other]);
  await expect.poll(() => miniBars(app)).toBe(1);
  await expect.poll(() => app.windows().some((page) => page.url() === MINI_URL)).toBe(true);
  const second = app.windows().find((page) => page.url() === MINI_URL && !page.isClosed())!;
  await second.getByRole("button", { name: "Fermer", exact: true }).click();
  await expect.poll(() => miniBars(app)).toBe(0);
  await expect.poll(() => tabUrls(app)).not.toContain(other);

  // Setting off: links go to a tab as before.
  await chrome.evaluate(() => (globalThis as unknown as Api).browser.settings.update({ behavior: { externalLinksInMiniWindow: false } }));
  await launchAgain(app, [other]);
  await expect.poll(async () => (await state(chrome)).tabs.map((tab) => tab.url)).toContain(other);
  expect(await miniBars(app)).toBe(0);
});

test("Jump List switches reach the running browser: --new-tab, --space=<id>, --private (ADR-048)", async ({ app, chrome, server }) => {
  await visit(chrome, server.url("/first"), "Page first");
  const tabs = (await state(chrome)).tabs.length;
  await launchAgain(app, ["--new-tab"]);
  await expect.poll(async () => (await state(chrome)).tabs.length).toBe(tabs + 1);

  const first = (await state(chrome)).activeSpaceId;
  const space = await chrome.evaluate(() => (globalThis as unknown as Api).browser.spaces.create({ name: "Travail" }));
  expect(space).not.toBeNull();
  await chrome.evaluate((id) => (globalThis as unknown as Api).browser.spaces.switchTo(id), first);
  await expect.poll(async () => (await state(chrome)).activeSpaceId).toBe(first);
  await launchAgain(app, [`--space=${space!.id}`]);
  await expect.poll(async () => (await state(chrome)).activeSpaceId).toBe(space!.id);

  const chromes = () => app.windows().filter(isChrome);
  const before = chromes().length;
  await launchAgain(app, ["--private"]);
  await expect.poll(() => chromes().length).toBe(before + 1);
  await expect
    .poll(async () => {
      const privates = await Promise.all(chromes().map((page) => state(page).then((s) => s.isPrivate === true).catch(() => false)));
      return privates.filter(Boolean).length;
    })
    .toBe(1);
});

test("the energy saver shows in the window bar and stops animations (ADR-048)", async ({ chrome }) => {
  expect((await state(chrome)).energy).toEqual({ active: false, reason: null });
  await chrome.evaluate(() => (globalThis as unknown as Api).browser.settings.update({ behavior: { energySaver: "always" } }));
  await expect.poll(async () => (await state(chrome)).energy?.active).toBe(true);
  await expect(chrome.locator("html")).toHaveAttribute("data-reduce-motion", "");

  const bar = chrome.getByTestId("window-bar");
  const strip = (await bar.boundingBox())!;
  await chrome.mouse.move(strip.x + strip.width / 2, strip.y + 2);
  await expect(chrome.getByTestId("energy-indicator")).toHaveAttribute("title", "Économiseur d'énergie toujours actif");

  await chrome.evaluate(() => (globalThis as unknown as Api).browser.settings.update({ behavior: { energySaver: "off" } }));
  await expect(chrome.getByTestId("energy-indicator")).toHaveCount(0);
  await expect(chrome.locator("html")).not.toHaveAttribute("data-reduce-motion", "");
});
