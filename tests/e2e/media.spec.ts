import type { Page } from "@playwright/test";
import type { BrowserApi } from "@shared/ipc";
import { evalInTab, expect, test, visit } from "./fixtures";

// Media hub (ADR-035): a tab playing in the background shows in the sidebar's mini-player, whose
// controls act on the page; "Tout mettre en pause" pauses every source.

type Global = { browser: BrowserApi };
/** Whether the page at `url` has its track paused (null while the tab is not loaded yet). */
const pausedAt = (app: Parameters<typeof evalInTab>[0], url: string) => evalInTab<boolean>(app, url, "document.getElementById('a').paused").catch(() => null);
const run = (chrome: Page, id: "pause-all-media") => chrome.evaluate((command) => (globalThis as unknown as Global).browser.commands.run(command), id);

test("the mini-player follows a background tab and controls its media", async ({ app, chrome, server }) => {
  const url = server.url("/media?title=Chanson%20test");
  await visit(chrome, url, "Media");
  const paused = () => evalInTab<boolean>(app, url, "document.getElementById('a').paused");
  await expect.poll(paused).toBe(false);

  // On screen, the playing tab is not in the mini-player.
  const player = chrome.getByTestId("mini-player");
  await expect(player).toHaveCount(0);

  await chrome.evaluate(() => (globalThis as unknown as Global).browser.tabs.create("about:blank"));
  await expect(chrome.getByTestId("mini-player-title")).toHaveText("Chanson test");
  await expect(player).toContainText("Testeur");
  // The artwork is a data: URL fetched by main (the UI loads no remote image).
  await expect(player.locator("img")).toHaveAttribute("src", /^data:image\/png;base64,/);

  await player.getByRole("button", { name: "Mettre en pause" }).click();
  await expect.poll(paused).toBe(true);
  // Paused recently: still listed, offering to play again.
  await player.getByRole("button", { name: "Lire" }).click();
  await expect.poll(paused).toBe(false);

  await run(chrome, "pause-all-media");
  await expect.poll(paused).toBe(true);
  await expect(player.getByRole("button", { name: "Lire" })).toBeVisible();

  // "Aller à l'onglet" shows it again; the mini-player hides (the source is on screen).
  await player.getByRole("button", { name: "Chanson test" }).click();
  await expect(chrome.locator(".tab.active .title")).toHaveText("Media");
  await expect(player).toHaveCount(0);
});

test("several sources stack with a count; closing pauses and hides one", async ({ app, chrome, server }) => {
  const first = server.url("/media?title=Premier");
  const second = server.url("/media?title=Second");
  await visit(chrome, first, "Media");
  await chrome.evaluate((url) => (globalThis as unknown as Global).browser.tabs.create(url), second);
  await expect.poll(() => pausedAt(app, second)).toBe(false);
  await chrome.evaluate(() => (globalThis as unknown as Global).browser.tabs.create("about:blank"));

  const player = chrome.getByTestId("mini-player");
  const count = player.getByRole("button", { name: "2 sources de lecture" });
  await expect(count).toBeVisible();
  await count.click();
  const list = chrome.getByTestId("media-list");
  await expect(list.getByRole("listitem")).toHaveCount(2);

  await list.getByRole("listitem").filter({ hasText: "Premier" }).getByRole("button", { name: "Fermer" }).click();
  await expect.poll(() => pausedAt(app, first)).toBe(true);
  await expect(count).toHaveCount(0);
  await expect(chrome.getByTestId("mini-player-title")).toHaveText("Second");
});
