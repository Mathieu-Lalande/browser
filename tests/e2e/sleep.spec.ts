import type { Page } from "@playwright/test";
import type { BrowserApi } from "@shared/ipc";
import { chromeOf, evalInTab, expect, launch, tabUrls, test } from "./fixtures";

async function visit(chrome: Page, url: string, title: string): Promise<void> {
  const address = chrome.getByLabel("Barre d'adresse");
  await address.fill(url);
  await address.press("Enter");
  await expect(chrome.locator(".tab.active .title")).toHaveText(title);
}

async function newTab(chrome: Page, url: string, title: string): Promise<void> {
  await chrome.getByRole("button", { name: "Nouvel onglet" }).click();
  await visit(chrome, url, title);
}

const run = (chrome: Page, id: Parameters<BrowserApi["commands"]["run"]>[0]) =>
  chrome.evaluate((id) => (globalThis as unknown as { browser: BrowserApi }).browser.commands.run(id), id);

test("idle background tabs fall asleep and wake up on activation, with their URL and history", async ({ profile, server }) => {
  // Test hook: tabs sleep after 1.5 s in the background instead of 30 min.
  const app = await launch(profile, { BROWSER_TEST_SLEEP_MS: "1500" });
  try {
    const chrome = await chromeOf(app);
    await visit(chrome, server.url("/first"), "Page first");
    await visit(chrome, server.url("/sleepy"), "Page sleepy");
    // A page with unsaved input stays awake.
    await newTab(chrome, server.url("/form"), "Form");
    await evalInTab(app, server.url("/form"), "document.querySelector('#field').value = 'brouillon'; true");
    await newTab(chrome, server.url("/awake"), "Page awake");

    await expect.poll(async () => (await tabUrls(app)).sort(), { timeout: 15_000 }).toEqual([server.url("/awake"), server.url("/form")].sort());
    const sleepy = chrome.locator(".tabs [role=tab]", { hasText: "Page sleepy" });
    // Dimmed in the sidebar, and still there with its title.
    await expect(sleepy).toHaveClass(/asleep/);
    await expect(chrome.locator(".tabs [role=tab]", { hasText: "Form" })).not.toHaveClass(/asleep/);

    await sleepy.click();
    await expect(chrome.locator(".tab.active .title")).toHaveText("Page sleepy");
    await expect(sleepy).not.toHaveClass(/asleep/);
    await expect.poll(() => tabUrls(app)).toContain(server.url("/sleepy"));
    await expect(chrome.getByLabel("Barre d'adresse")).toHaveValue(/\/sleepy/);
    // Its back/forward list came back too.
    await expect(chrome.getByRole("button", { name: "Précédent" })).toBeEnabled();
    expect(await evalInTab(app, server.url("/form"), "document.querySelector('#field').value")).toBe("brouillon");
  } finally {
    await app.close();
  }
});

test("tabs can be put to sleep on demand from the command registry", async ({ app, chrome, server }) => {
  await visit(chrome, server.url("/one"), "Page one");
  await newTab(chrome, server.url("/two"), "Page two");
  await newTab(chrome, server.url("/three"), "Page three");
  await expect.poll(async () => (await tabUrls(app)).length).toBe(3);

  // "Mettre les autres onglets en veille": everything but the tab on screen.
  await run(chrome, "sleep-other-tabs");
  await expect.poll(() => tabUrls(app)).toEqual([server.url("/three")]);
  await expect(chrome.locator(".tabs .tab.asleep")).toHaveCount(2);

  // "Mettre l'onglet en veille": the active tab sleeps and gives way to the last used one.
  await chrome.locator(".tabs [role=tab]", { hasText: "Page one" }).click();
  await expect.poll(async () => (await tabUrls(app)).sort()).toEqual([server.url("/one"), server.url("/three")].sort());
  await run(chrome, "sleep-tab");
  await expect(chrome.locator(".tab.active .title")).toHaveText("Page three");
  await expect.poll(() => tabUrls(app)).toEqual([server.url("/three")]);
  await expect(chrome.locator(".tabs [role=tab]", { hasText: "Page one" })).toHaveClass(/asleep/);
});
