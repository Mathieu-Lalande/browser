import type { Page } from "@playwright/test";
import type { BrowserApi } from "../../src/shared/ipc";
import { chromeOf, expect, launch, openPrivateWindow, test } from "./fixtures";

type Api = { browser: BrowserApi };

const widgetKinds = (chrome: Page) =>
  chrome.evaluate(async () => (await (globalThis as unknown as Api).browser.settings.get()).startPage.widgets.map((widget) => widget.kind));

const widgetsList = (chrome: Page) => chrome.getByRole("list", { name: "Widgets de la page d'accueil" });

test("edit mode: add a notes widget, type, and the notes survive a restart", async ({ profile }) => {
  let app = await launch(profile);
  let chrome = await chromeOf(app);
  await chrome.getByRole("button", { name: "Personnaliser" }).click();
  await chrome.getByRole("button", { name: "Ajouter un widget" }).click();
  const gallery = chrome.getByRole("dialog", { name: "Ajouter un widget" });
  await gallery.getByRole("button", { name: /Notes rapides/ }).click();
  await expect(gallery).toHaveCount(0);
  // The new card has the focus, ready to be moved.
  await expect(chrome.locator("[data-widget-id=notes]")).toBeFocused();
  await chrome.keyboard.press("Escape");
  await expect(chrome.getByRole("button", { name: "Personnaliser" })).toBeVisible();

  await chrome.getByLabel("Notes rapides").fill("Acheter du pain");
  await expect.poll(() => widgetKinds(chrome)).toEqual(["clock", "search", "top-sites", "notes"]);
  await expect
    .poll(() => chrome.evaluate(async () => JSON.stringify((await (globalThis as unknown as Api).browser.settings.get()).startPage.widgets)))
    .toContain("Acheter du pain");
  await app.close();

  app = await launch(profile);
  try {
    chrome = await chromeOf(app);
    await expect(chrome.getByLabel("Notes rapides")).toHaveValue("Acheter du pain");
  } finally {
    await app.close();
  }
});

test("edit mode: widgets are reordered with the arrow keys", async ({ chrome }) => {
  await chrome.getByRole("button", { name: "Personnaliser" }).click();
  const search = chrome.locator("[data-widget-id=search]");
  await search.focus();
  await chrome.keyboard.press("ArrowLeft");
  await expect.poll(() => widgetKinds(chrome)).toEqual(["search", "clock", "top-sites"]);
  await expect(search).toBeFocused();
  await expect(chrome.locator(".start > [aria-live=polite]")).toHaveText("Recherche : position 1 sur 3.");
  await chrome.keyboard.press("ArrowDown");
  await chrome.keyboard.press("ArrowDown");
  await expect.poll(() => widgetKinds(chrome)).toEqual(["clock", "top-sites", "search"]);
  // The content is inert while editing: the order shows in the DOM.
  await expect(widgetsList(chrome).locator("[data-widget-id]")).toHaveCount(3);
  await expect(widgetsList(chrome).locator("[data-widget-id]").last()).toHaveAttribute("data-widget-id", "search");
  await chrome.getByRole("button", { name: "Terminé" }).click();
  await expect(chrome.locator(".start input")).toBeVisible();
});

test("the Minimal preset keeps search and clock; a private window edits without saving", async ({ app, chrome }) => {
  await chrome.getByRole("button", { name: "Personnaliser" }).click();
  await chrome.getByRole("button", { name: "Minimal" }).click();
  await expect.poll(() => widgetKinds(chrome)).toEqual(["clock", "search"]);
  await expect(chrome.getByRole("navigation", { name: "Sites les plus visités" })).toHaveCount(0);
  await chrome.getByRole("button", { name: "Terminé" }).click();
  await expect(chrome.locator(".start h1")).toBeVisible();

  const priv = await openPrivateWindow(app, chrome);
  await priv.getByRole("button", { name: "Personnaliser" }).click();
  await priv.getByRole("button", { name: "Productif" }).click();
  await expect(widgetsList(priv).locator("[data-widget-id]")).toHaveCount(5); // without the habits (sites, "Reprendre")
  await expect.poll(() => widgetKinds(chrome)).toEqual(["clock", "search"]);
});
