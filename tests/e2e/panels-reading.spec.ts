import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import type { BrowserApi } from "@shared/ipc";
import { attachedViews, chromeOf, evalInTab, expect, launch, test, visit } from "./fixtures";

// ADR-047: web panels beside the page, the reading list with its offline text, and automatic
// picture-in-picture on tab switches.

type Global = { browser: BrowserApi };
const run = (chrome: Page, id: string) => chrome.evaluate((command) => (globalThis as unknown as Global).browser.commands.run(command as never), id);

test("a web panel opens beside the page, narrows it, shows its unread count and toggles", async ({ app, chrome, server }) => {
  const page = server.url("/home");
  const panelUrl = server.url("/panel-app");
  await visit(chrome, page, "Page home");
  const tabWidth = async () => (await attachedViews(app)).find((view) => view.url === page)?.width ?? 0;
  await expect.poll(tabWidth).toBeGreaterThan(0);
  const fullWidth = await tabWidth();

  await chrome.getByTestId("panel-strip").getByRole("button", { name: "Ajouter un panneau web" }).click();
  const form = chrome.getByTestId("panel-add");
  await form.getByLabel("Adresse du panneau").fill(panelUrl);
  await form.getByRole("button", { name: "Ajouter", exact: true }).click();

  await expect(chrome.getByTestId("web-panel")).toBeVisible();
  const panelView = async () => (await attachedViews(app)).find((view) => view.url === panelUrl) ?? null;
  await expect.poll(async () => (await panelView())?.width ?? 0).toBeGreaterThan(200);
  // The page view gave the panel its room.
  await expect.poll(tabWidth).toBeLessThan(fullWidth - 200);
  // The unread count read from the panel's title.
  await expect(chrome.getByTestId("panel-strip").getByRole("button", { name: /\(3 non lus\)/ })).toBeVisible();

  // The shortcut's command hides the last panel (its page keeps running), and shows it again.
  await run(chrome, "toggle-web-panel");
  await expect(chrome.getByTestId("web-panel")).toHaveCount(0);
  await expect.poll(panelView).toBeNull();
  await expect.poll(tabWidth).toBe(fullWidth);
  await run(chrome, "toggle-web-panel");
  await expect(chrome.getByTestId("web-panel")).toBeVisible();
  await expect.poll(async () => (await panelView())?.width ?? 0).toBeGreaterThan(200);
  // Its page lives in its own partition, with no preload: plain web page.
  expect(await evalInTab(app, panelUrl, "typeof window.browser")).toBe("undefined");
});

test("a page added to the reading list keeps its offline text", async ({ chrome, server, profile }) => {
  const url = server.url("/article");
  await visit(chrome, url, "Un article de test");
  await run(chrome, "toggle-reading-list");

  const api = (chromePage: Page) => chromePage.evaluate(() => (globalThis as unknown as Global).browser.reading.list());
  await expect.poll(async () => (await api(chrome)).map((entry) => [entry.url, entry.offline])).toEqual([[url, true]]);
  // The address bar says so.
  await expect(chrome.getByRole("button", { name: "Retirer de la liste de lecture" })).toHaveAttribute("aria-pressed", "true");
  // Written to the profile (with the text, never HTML).
  const file = join(profile, "reading-list.json");
  await expect.poll(() => existsSync(file) && readFileSync(file, "utf8").includes("Paragraphe 1")).toBe(true);
  expect(readFileSync(file, "utf8")).not.toContain("<p");

  await run(chrome, "open-reading-list");
  const list = chrome.getByTestId("reading-list-page");
  await expect(list.locator("[data-reading-id]")).toHaveCount(1);
  await list.getByRole("button", { name: "Lire", exact: true }).click();
  const article = chrome.getByTestId("reading-article");
  await expect(article).toContainText("Paragraphe 1");
  await expect(article).toContainText("Copie hors ligne");
  // Opening it marked it read.
  await expect.poll(async () => (await api(chrome))[0].readAt).not.toBeNull();
});

test("automatic picture-in-picture follows tab switches and respects sites that refuse it", async ({ profile, server }) => {
  const app = await launch(profile, { BROWSER_TEST_AUTO_PIP: "1" });
  try {
    const chrome = await chromeOf(app);
    await chrome.evaluate(() => (globalThis as unknown as Global).browser.settings.update({ media: { autoPictureInPicture: true } }));
    const url = server.url("/video");
    await visit(chrome, url, "Video");
    await expect.poll(() => evalInTab<number>(app, url, `document.getElementById("v").readyState`)).toBeGreaterThan(1);
    const pipId = () => evalInTab<string | null>(app, url, `document.pictureInPictureElement?.id ?? null`);
    const log = () => app.evaluate(() => (globalThis as { __browserTestAutoPip?: { kind: string; url: string; result: string }[] }).__browserTestAutoPip ?? []);

    // Leaving the tab pops its video out…
    await chrome.evaluate(() => (globalThis as unknown as Global).browser.tabs.create("about:blank"));
    await expect.poll(pipId).toBe("v");
    expect((await log()).at(-1)).toMatchObject({ kind: "enter", url, result: "entered" });

    // …coming back puts it back.
    await chrome.locator(".tab", { hasText: "Video" }).click();
    await expect.poll(pipId).toBeNull();
    await expect.poll(async () => (await log()).some((entry) => entry.kind === "exit" && entry.result === "exited")).toBe(true);

    // A site that disables picture-in-picture is left alone.
    const refused = server.url("/nopip-video");
    await visit(chrome, refused, "No PiP");
    await expect.poll(() => evalInTab<number>(app, refused, `document.getElementById("v").readyState`)).toBeGreaterThan(1);
    await chrome.evaluate(() => (globalThis as unknown as Global).browser.tabs.create("about:blank"));
    await expect.poll(async () => (await log()).some((entry) => entry.url === refused && entry.result === "disabled")).toBe(true);
    expect(await evalInTab(app, refused, "document.pictureInPictureElement")).toBeNull();
  } finally {
    await app.close();
  }
});

test("picture-in-picture reaches the largest video in a cross-origin frame (ADR-056)", async ({ profile, server }) => {
  const app = await launch(profile, { BROWSER_TEST_AUTO_PIP: "1" });
  try {
    const chrome = await chromeOf(app);
    const port = new URL(server.url("/")).port;
    const url = server.url(`/embedded-video?frame=${encodeURIComponent(`http://localhost:${port}/video`)}`);
    await visit(chrome, url, "Embedded video");
    // What is popped out: "small" in the page, "v" in the frame of the other origin.
    const pip = () =>
      app.evaluate(async ({ webContents }, prefix) => {
        const page = webContents.getAllWebContents().find((contents) => contents.getURL().startsWith(prefix));
        const frame = page?.mainFrame.frames.find((child) => child.url.startsWith("http://localhost"));
        if (!page || !frame) return "missing";
        const top = (await page.executeJavaScript("document.pictureInPictureElement?.id ?? null")) as string | null;
        const inner = (await frame.executeJavaScript("document.pictureInPictureElement?.id ?? null")) as string | null;
        return top ?? inner ?? "none";
      }, url);
    const ready = () =>
      app.evaluate(async ({ webContents }, prefix) => {
        const page = webContents.getAllWebContents().find((contents) => contents.getURL().startsWith(prefix));
        const frame = page?.mainFrame.frames.find((child) => child.url.startsWith("http://localhost"));
        return frame ? ((await frame.executeJavaScript(`document.getElementById("v")?.readyState ?? 0`)) as number) : 0;
      }, url);
    await expect.poll(ready).toBeGreaterThan(1);
    await expect.poll(pip).toBe("none");

    // The command: the frame's larger player wins over the page's own small preview, and back.
    await run(chrome, "picture-in-picture");
    await expect.poll(pip).toBe("v");
    await run(chrome, "picture-in-picture");
    await expect.poll(pip).toBe("none");

    // Automatic picture-in-picture on leaving the tab, and back on returning.
    await chrome.evaluate(() => (globalThis as unknown as Global).browser.settings.update({ media: { autoPictureInPicture: true } }));
    await chrome.evaluate(() => (globalThis as unknown as Global).browser.tabs.create("about:blank"));
    await expect.poll(pip).toBe("v");
    await chrome.locator(".tab", { hasText: "Embedded video" }).click();
    await expect.poll(pip).toBe("none");
  } finally {
    await app.close();
  }
});
