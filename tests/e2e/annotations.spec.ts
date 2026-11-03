import type { Page } from "@playwright/test";
import type { BrowserApi } from "@shared/ipc";
import type { BrowserState } from "@shared/types";
import { clickInTab, evalInTab, expect, overlayOf, test, visit } from "./fixtures";

// Notes and highlights (ADR-037): a selection becomes a highlight (command), drawn again after a
// reload, its popover adds a note, browser://notes lists it, and deleting removes it from the page.

type Global = { browser: BrowserApi };
const api = <T>(chrome: Page, run: (browser: BrowserApi) => Promise<T> | T) =>
  chrome.evaluate(`(${run.toString()})(globalThis.browser)`) as Promise<T>;

/** Selects "renard brun saute" (across the `<b>`) in the page. */
const SELECT = `(() => {
  const p = document.getElementById("text");
  const range = document.createRange();
  range.setStart(p.firstChild, 3);
  range.setEnd(p.childNodes[2], 6);
  getSelection().removeAllRanges();
  getSelection().addRange(range);
  return getSelection().toString();
})()`;

const MARKS = `[...document.querySelectorAll("mark[data-browser-hl]")].map((m) => m.textContent).join("|")`;

test("highlights a selection, keeps it across reloads, edits it and lists it in browser://notes", async ({ app, chrome, server }) => {
  const url = server.url("/annotate");
  await visit(chrome, url, "Annotate");
  expect(await evalInTab<string>(app, url, SELECT)).toBe("renard brun saute");

  await chrome.evaluate(() => (globalThis as unknown as Global).browser.commands.run("highlight-selection"));
  await expect.poll(() => evalInTab<string>(app, url, MARKS)).toBe("renard |brun| saute");
  // The page's own scripts see no global of the annotator (isolated world).
  expect(await evalInTab(app, url, `typeof globalThis.__browserAnnotate`)).toBe("undefined");

  await chrome.evaluate(() => (globalThis as unknown as Global).browser.commands.run("reload"));
  await expect.poll(() => evalInTab<string>(app, url, MARKS)).toBe("renard |brun| saute");

  // A click on the highlight opens its popover; a note is added there.
  await clickInTab(app, url, "mark[data-browser-hl]");
  const overlay = await overlayOf(app);
  const panel = overlay.getByTestId("annotation-panel");
  await expect(panel).toContainText("renard brun saute");
  await panel.getByRole("radio", { name: "Vert" }).click();
  await panel.getByLabel("Note du surlignage").fill("À relire");
  await panel.getByRole("button", { name: "Terminé" }).click();
  await expect.poll(() => evalInTab<string>(app, url, `document.querySelector("mark[data-browser-hl]").dataset.color`)).toBe("green");
  const [saved] = (await api(chrome, (browser) => browser.annotations.list())).highlights;
  expect(saved).toMatchObject({ exact: "renard brun saute", color: "green", note: "À relire", url });

  // The notes panel lists it for the page.
  await chrome.evaluate(() => (globalThis as unknown as Global).browser.commands.run("toggle-notes-panel"));
  await expect(chrome.getByTestId("notes-panel")).toContainText("renard brun saute");
  await chrome.evaluate(() => (globalThis as unknown as Global).browser.commands.run("toggle-notes-panel"));

  // browser://notes: grouped by site, searchable; deleting removes the highlight from the page.
  await chrome.evaluate(() => (globalThis as unknown as Global).browser.commands.run("open-notes"));
  const page = chrome.getByTestId("notes-page");
  await expect(page).toContainText("127.0.0.1");
  await expect(page).toContainText("À relire");
  await page.getByLabel("Rechercher dans les notes").fill("introuvable");
  await expect(page).toContainText("Aucun résultat");
  await page.getByLabel("Rechercher dans les notes").fill("relire");
  await page.locator(`[data-highlight-id="${saved.id}"]`).getByRole("button", { name: "Supprimer le surlignage" }).click();
  await expect(page).toContainText("Aucune note pour l'instant");
  await expect.poll(() => evalInTab<string>(app, url, MARKS)).toBe("");
  const state = (await chrome.evaluate(() => (globalThis as unknown as Global).browser.getState())) as BrowserState;
  expect(state.tabs.some((tab) => tab.url === url)).toBe(true);
});
