import type { Page } from "@playwright/test";
import type { BrowserApi } from "@shared/ipc";
import type { BrowserState } from "@shared/types";
import { attachedViews, evalInTab, expect, test, visit } from "./fixtures";

// Reader mode (ADR-026): readerable pages get a button, the chrome UI draws the validated article
// in place of the page view, and nothing of the page's markup (scripts, handlers) comes along.

type Global = { browser: BrowserApi; __pwned?: unknown };
const state = (chrome: Page) => chrome.evaluate(() => (globalThis as unknown as Global).browser.getState()) as Promise<BrowserState>;

test("reader mode shows the article drawn by the chrome UI, without the page's scripts", async ({ app, chrome, server }) => {
  const url = server.url("/article");
  await visit(chrome, url, "Un article de test");

  const button = chrome.getByRole("button", { name: "Mode lecture", exact: true });
  await expect(button).toBeVisible();
  await button.click();

  const reader = chrome.getByTestId("reader-view");
  await expect(reader.getByRole("heading", { level: 1 })).toHaveText("Un article de test");
  await expect(reader).toContainText("Phrase finale du test.");
  await expect(reader).toContainText("Par Ada Lovelace");
  await expect(reader).toContainText("min de lecture");
  // Menus and footers are left out.
  await expect(reader).not.toContainText("Pied de page");

  // The page view is detached while the reader is shown.
  await expect.poll(async () => (await attachedViews(app)).length).toBe(0);

  // Only the safe link stays a link; no script, no handler, images only as data: (fetched by main).
  await expect(reader.getByRole("link", { name: "lien sûr" })).toHaveAttribute("href", server.url("/second"));
  await expect(reader.getByRole("link", { name: "lien piégé" })).toHaveCount(0);
  expect(await reader.locator("script, iframe, [onerror], [onclick], [style]").count()).toBe(0);
  const sources = await reader.locator("img").evaluateAll((images) => images.map((image) => image.getAttribute("src") ?? ""));
  expect(sources.length).toBe(1);
  for (const src of sources) expect(src).toMatch(/^data:image\/png;base64,/);
  expect(await chrome.evaluate(() => (globalThis as unknown as Global).__pwned)).toBeUndefined();
  // The page's own script ran in the page only (it does, it is the page's world).
  expect(await evalInTab(app, url, "document.body.dataset.ran")).toBe("1");

  // Preferences apply live and are validated settings.
  await reader.getByRole("radio", { name: "Sépia" }).click();
  await expect.poll(() => chrome.evaluate(() => (globalThis as unknown as Global).browser.settings.get().then((s) => s.reader.theme))).toBe("sepia");
  await reader.getByRole("button", { name: "Agrandir le texte" }).click();
  await expect(reader.getByText("20 px")).toBeVisible();

  // Back to the page.
  await reader.getByRole("button", { name: /Quitter/ }).click();
  await expect(reader).toBeHidden();
  await expect.poll(async () => (await attachedViews(app)).length).toBe(1);
  const tab = (await state(chrome)).tabs.find((entry) => entry.url === url);
  expect(tab?.reader).toBe(false);
});

test("short pages get no reader button; the mobile site toggle changes the user agent", async ({ app, chrome, server }) => {
  const url = server.url("/second");
  await visit(chrome, url, "Page second");
  await expect.poll(async () => (await state(chrome)).tabs.find((tab) => tab.url === url)?.isLoading).toBe(false);
  await expect(chrome.getByRole("button", { name: "Mode lecture", exact: true })).toHaveCount(0);

  const run = () => chrome.evaluate(() => (globalThis as unknown as Global).browser.commands.run("toggle-mobile-site"));
  await run();
  await expect.poll(() => evalInTab<string>(app, url, "navigator.userAgent")).toContain("Mobile Safari/");
  await run();
  await expect.poll(() => evalInTab<string>(app, url, "navigator.userAgent")).not.toContain("Mobile");
});
