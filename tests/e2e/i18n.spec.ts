import type { ElectronApplication, Page } from "@playwright/test";
import { chromeOf, expect, launch, overlayOf, test } from "./fixtures";

/**
 * UI language (ADR-052): the suite runs in French; here the language switches to English live from
 * the settings, and the key surfaces (sidebar, settings, app menu, universal bar, an internal page,
 * the native menu) follow without French leftovers. "Automatique" follows the system language.
 */

/** Native key press through main, so menu accelerators fire. */
async function press(app: ElectronApplication, keyCode: string, modifiers: ("control" | "shift")[] = ["control"]): Promise<void> {
  await app.evaluate(
    ({ BrowserWindow }, { keyCode, modifiers }) => {
      const contents = BrowserWindow.getAllWindows()[0].webContents;
      contents.sendInputEvent({ type: "keyDown", keyCode, modifiers });
      contents.sendInputEvent({ type: "keyUp", keyCode, modifiers });
    },
    { keyCode, modifiers },
  );
}

/** Words that only French UI text has (a leftover check, not a dictionary). */
const FRENCH = /[àâçéèêëîïôûùœ]|\b(onglets?|fenêtre|paramètres|réglages|nouvel|nouvelle|fermer|rechercher|ajouter|afficher|favoris)\b/i;
const visibleText = (page: Page) => page.evaluate<string>("document.body.innerText");

test("switching the language to English re-renders every surface, live", async ({ app, chrome }) => {
  await press(app, ","); // Ctrl+,: the settings.
  await expect(chrome.getByRole("heading", { name: "Paramètres", level: 1 })).toBeVisible();
  await chrome.getByRole("radio", { name: "English" }).click();

  // The settings page, the sidebar and the internal page title switch at once.
  await expect(chrome.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
  await expect(chrome.locator("[data-section=appearance] h2")).toHaveText("Appearance");
  await expect(chrome.getByRole("radio", { name: "Automatic" })).toBeVisible();
  await expect(chrome.getByLabel("Address bar")).toBeVisible();
  await expect(chrome.getByRole("button", { name: "Settings", exact: true })).toBeVisible();
  await expect(chrome.locator(".tab.active .title")).toHaveText("Settings");
  expect(await chrome.evaluate<string>("document.documentElement.lang")).toBe("en");
  const sidebar = await chrome.locator(".sidebar").innerText();
  expect(sidebar).not.toMatch(FRENCH);

  // The app menu (overlay layer).
  await chrome.getByTestId("app-menu-button").click();
  const overlay = await overlayOf(app);
  await expect(overlay.getByRole("menu", { name: "App menu" })).toBeVisible();
  await expect(overlay.getByText("Sync", { exact: true })).toBeVisible();
  expect(await visibleText(overlay)).not.toMatch(FRENCH);
  await overlay.keyboard.press("Escape");

  // The universal bar: placeholder and commands in English, French keywords still match.
  await press(app, "K");
  const input = overlay.getByRole("combobox", { name: "Universal bar" });
  await expect(input).toBeFocused();
  await input.fill("nouvel onglet");
  await expect(overlay.getByRole("option", { name: /New tab/ }).first()).toBeVisible();
  await input.fill("history");
  await expect(overlay.getByRole("option", { name: /All history/ }).first()).toBeVisible();
  await overlay.keyboard.press("Escape");

  // The native application menu is rebuilt in English.
  const labels = await app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.items.map((item) => item.label) ?? []);
  expect(labels).toEqual(expect.arrayContaining(["File", "Edit", "View"]));

  // An internal page drawn by the UI: browser://history.
  await press(app, "H");
  await expect(chrome.getByRole("heading", { name: "History", level: 1 })).toBeVisible();
  expect(await chrome.locator("main").first().innerText()).not.toMatch(FRENCH);
});

test("Automatique follows the system language, and the choice survives a restart", async ({ profile }) => {
  // A system in English: "auto" shows English.
  let app = await launch(profile, { BROWSER_TEST_LOCALE: "en-GB" });
  let chrome = await chromeOf(app);
  await expect(chrome.getByLabel("Address bar")).toBeVisible();
  await press(app, ",");
  await chrome.getByRole("radio", { name: "Français" }).click();
  await expect(chrome.getByRole("heading", { name: "Paramètres", level: 1 })).toBeVisible();
  await app.close();

  // The explicit choice wins over the system language.
  app = await launch(profile, { BROWSER_TEST_LOCALE: "en-US" });
  chrome = await chromeOf(app);
  await expect(chrome.getByLabel("Barre d'adresse")).toBeVisible();
  await app.close();
});
