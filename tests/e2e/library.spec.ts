import type { ElectronApplication, Page } from "@playwright/test";
import { chromeOf, expect, launch, tabUrls, test } from "./fixtures";

async function visit(chrome: Page, url: string, title: string): Promise<void> {
  const address = chrome.getByLabel("Barre d'adresse");
  await address.fill(url);
  await address.press("Enter");
  await expect(chrome.locator(".tab.active .title")).toHaveText(title);
}

/**
 * Native key press sent to the chrome UI through the main process: unlike Playwright's synthetic
 * keyboard, it goes through Electron's menu accelerator handling.
 */
async function pressCtrlD(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ BrowserWindow }) => {
    const contents = BrowserWindow.getAllWindows()[0].webContents;
    contents.sendInputEvent({ type: "keyDown", keyCode: "D", modifiers: ["control"] });
    contents.sendInputEvent({ type: "keyUp", keyCode: "D", modifiers: ["control"] });
  });
}

test("restores tabs, pins and the active tab after a restart, loading them lazily", async ({ profile, server }) => {
  let app = await launch(profile);
  let chrome = await chromeOf(app);
  await visit(chrome, server.url("/one"), "Page one");
  await chrome.getByRole("button", { name: "Nouvel onglet" }).click();
  await visit(chrome, server.url("/two"), "Page two");
  await chrome.locator(".tabs [role=tab]", { hasText: "Page one" }).dblclick();
  await expect(chrome.locator(".pinned-tab")).toHaveCount(1);
  await chrome.locator(".tabs [role=tab]", { hasText: "Page two" }).click();
  await expect(chrome.locator(".tab.active .title")).toHaveText("Page two");
  await app.close();

  app = await launch(profile);
  try {
    chrome = await chromeOf(app);
    await expect(chrome.locator(".pinned-tab")).toHaveCount(1);
    await expect(chrome.locator(".pinned-tab")).toHaveAttribute("title", "Page one");
    await expect(chrome.locator(".tabs [role=tab]")).toHaveCount(1);
    await expect(chrome.locator(".tab.active .title")).toHaveText("Page two");
    // Only the active tab loads at startup; the pinned one waits until it is activated.
    await expect.poll(() => tabUrls(app)).toEqual([server.url("/two")]);
    await chrome.locator(".pinned-tab").click();
    await expect.poll(() => tabUrls(app)).toContain(server.url("/one"));
    await expect(chrome.locator(".pinned-tab")).toHaveAttribute("aria-selected", "true");
  } finally {
    await app.close();
  }
});

test("starts with a single start page when the saved session is corrupt", async ({ profile }) => {
  const { writeFileSync, readdirSync } = await import("node:fs");
  writeFileSync(`${profile}/session.json`, "{ not json");
  const app = await launch(profile);
  try {
    const chrome = await chromeOf(app);
    await expect(chrome.locator(".start h1")).toBeVisible();
    await expect(chrome.locator(".tabs [role=tab]")).toHaveCount(1);
    expect(readdirSync(profile).some((name) => name.startsWith("session.json.corrupt-"))).toBe(true);
  } finally {
    await app.close();
  }
});

test("suggests visited pages while typing in the address bar", async ({ chrome, server }) => {
  await visit(chrome, server.url("/hello-world"), "Page hello-world");
  await chrome.getByRole("button", { name: "Nouvel onglet" }).click();
  const address = chrome.getByLabel("Barre d'adresse");
  await expect(address).toBeFocused();
  await address.pressSequentially("hello");

  const options = chrome.getByRole("listbox", { name: "Suggestions" }).getByRole("option");
  await expect(options).toHaveCount(2);
  await expect(options.nth(0)).toHaveText("Rechercher « hello »");
  await expect(options.nth(1)).toContainText("Page hello-world");
  await expect(options.nth(0)).toHaveAttribute("aria-selected", "true");

  await address.press("ArrowDown");
  await expect(options.nth(1)).toHaveAttribute("aria-selected", "true");
  await address.press("Enter");
  await expect(chrome.locator(".tab.active .title")).toHaveText("Page hello-world");
  await expect(chrome.getByRole("listbox", { name: "Suggestions" })).toHaveCount(0);
});

test("clicking a suggestion opens it, and visited sites show on the start page", async ({ chrome, server }) => {
  await visit(chrome, server.url("/docs"), "Page docs");
  await chrome.getByRole("button", { name: "Nouvel onglet" }).click();
  const tile = chrome.getByRole("navigation", { name: "Sites les plus visités" }).getByRole("button");
  await expect(tile).toHaveCount(1);
  await expect(tile).toHaveText("Page docs");

  await chrome.getByLabel("Barre d'adresse").pressSequentially("docs");
  await chrome.getByRole("option", { name: /Page docs/ }).click();
  await expect(chrome.locator(".tab.active .title")).toHaveText("Page docs");

  await chrome.getByRole("button", { name: "Nouvel onglet" }).click();
  await tile.click();
  await expect(chrome.locator(".tab.active .title")).toHaveText("Page docs");
  await expect(chrome.locator(".tabs [role=tab]")).toHaveCount(3);
});

test("the star and Ctrl+D toggle the bookmark of the active page", async ({ app, chrome, server }) => {
  await visit(chrome, server.url("/fav"), "Page fav");
  await chrome.getByRole("button", { name: "Ajouter aux favoris" }).click();
  const remove = chrome.getByRole("button", { name: "Retirer des favoris" });
  await expect(remove).toHaveAttribute("aria-pressed", "true");

  // Bookmarks are suggested first, marked with a star.
  await chrome.getByRole("button", { name: "Nouvel onglet" }).click();
  await chrome.getByLabel("Barre d'adresse").pressSequentially("fav");
  await expect(chrome.getByRole("option", { name: /Page fav/ }).locator(".kind")).toBeVisible();
  await chrome.getByRole("option", { name: /Page fav/ }).click();
  await expect(remove).toBeVisible();

  await pressCtrlD(app);
  await expect(chrome.getByRole("button", { name: "Ajouter aux favoris" })).toHaveAttribute("aria-pressed", "false");
  await pressCtrlD(app);
  await expect(remove).toBeVisible();
});
