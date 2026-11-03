import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ElectronApplication, Page } from "@playwright/test";
import type { BrowserApi } from "@shared/ipc";
import { chromeOf, clickInTab, evalInTab, expect, launch, overlayOf, test, visit } from "./fixtures";

// ADR-041: addresses (capture, encrypted file, fill), web notifications (permission bar, native
// notification through the test hook, click, do not disturb), spell checker languages.

type Global = { browser: BrowserApi };
type Shown = { site: string; title: string; body: string; hasIcon: boolean; click(): void };

/** Gives keyboard focus to the tab page at `prefix` (input events alone do not focus the view). */
const focusTab = (app: ElectronApplication, prefix: string) =>
  app.evaluate(({ webContents }, url) => webContents.getAllWebContents().find((contents) => contents.getURL().startsWith(url))?.focus(), prefix);

test("an address sent in a form is saved encrypted, then suggested and filled", async ({ server, profile }) => {
  const app = await launch(profile, { BROWSER_TEST_PLAIN_KEYCHAIN: "1" });
  try {
    const chrome = await chromeOf(app);
    const form = server.url("/address-form");
    await visit(chrome, form, "Adresse");
    await evalInTab(
      app,
      form,
      `Object.entries({ prenom: "Jeanne", nom: "Martin", adresse: "12 rue de la Paix", cp: "75002", ville: "Paris", pays: "FR" })
        .forEach(([id, value]) => (document.getElementById(id).value = value)); true`,
    );
    await clickInTab(app, form, "#submit");

    const overlay = await overlayOf(app);
    const prompt = overlay.getByRole("dialog", { name: "Enregistrer pour les formulaires" });
    await expect(prompt.getByRole("heading")).toHaveText("Enregistrer cette adresse ?");
    await expect(prompt).toContainText("Jeanne Martin, 12 rue de la Paix, 75002 Paris");
    await prompt.getByRole("button", { name: "Enregistrer", exact: true }).click();
    await expect(prompt).toBeHidden();

    // Encrypted at rest.
    await expect.poll(() => readFileSync(join(profile, "autofill.json"), "utf8").length).toBeGreaterThan(0);
    expect(readFileSync(join(profile, "autofill.json"), "utf8")).not.toContain("rue de la Paix");

    // Back on the form: focusing a field offers the address; picking it fills the form.
    await visit(chrome, form, "Adresse");
    await focusTab(app, form);
    await clickInTab(app, form, "#ville");
    const chooser = overlay.getByRole("dialog", { name: "Remplir le formulaire" });
    await expect(chooser).toBeVisible();
    await chooser.getByRole("button", { name: /12 rue de la Paix/ }).click();
    await expect(chooser).toBeHidden();
    await expect
      .poll(() => evalInTab(app, form, `["prenom", "nom", "adresse", "cp", "ville", "pays"].map((id) => document.getElementById(id).value)`))
      .toEqual(["Jeanne", "Martin", "12 rue de la Paix", "75002", "Paris", "FR"]);

    // The settings section lists it.
    await chrome.evaluate(() => (globalThis as unknown as Global).browser.settings.open());
    await expect(chrome.getByTestId("autofill-addresses")).toContainText("12 rue de la Paix, 75002 Paris");
  } finally {
    await app.close();
  }
});

test("a site allowed to notify shows native notifications that bring its tab back", async ({ server, profile }) => {
  const app = await launch(profile, { BROWSER_TEST_NOTIFICATIONS: "1" });
  try {
    const chrome = await chromeOf(app);
    const page = server.url("/permission");
    await visit(chrome, page, "Permission");
    await evalInTab(app, page, "Notification.requestPermission().then((result) => (document.title = 'result: ' + result)); true");
    const bar = chrome.getByRole("alertdialog", { name: "Demande d'autorisation" });
    await expect(bar).toContainText("vous envoyer des notifications");
    await bar.getByRole("button", { name: "Autoriser" }).click();
    await expect(chrome.locator(".tab.active .title")).toHaveText("result: granted");

    await evalInTab(app, page, `const n = new Notification("Bonjour", { body: "Un message" }); n.onclick = () => (document.title = "clicked"); true`);
    const shown = () => app.evaluate(() => ((globalThis as { __browserTestNotifications?: Shown[] }).__browserTestNotifications ?? []).map(({ site, title, body }) => ({ site, title, body })));
    await expect.poll(shown).toEqual([{ site: "127.0.0.1", title: "Bonjour", body: "Un message" }]);

    // Another tab in front: clicking the notification brings the page's tab back, and the page hears it.
    await chrome.getByRole("button", { name: "Nouvel onglet" }).click();
    await expect(chrome.locator(".start")).toBeVisible();
    await app.evaluate(() => (globalThis as { __browserTestNotifications?: Shown[] }).__browserTestNotifications?.[0].click());
    await expect(chrome.locator(".tab.active .title")).toHaveText("clicked");

    // "Ne pas déranger": nothing more is shown.
    await chrome.evaluate(() => (globalThis as unknown as Global).browser.settings.update({ notifications: { doNotDisturb: true } }));
    await evalInTab(app, page, `new Notification("Encore"); true`);
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(await shown()).toHaveLength(1);
  } finally {
    await app.close();
  }
});

test("the spell checker languages setting reaches the tab sessions", async ({ app, chrome }) => {
  const languages = () => app.evaluate(({ session }) => session.defaultSession.getSpellCheckerLanguages());
  const available = await app.evaluate(({ session }) => session.defaultSession.availableSpellCheckerLanguages);
  test.skip(!available.includes("fr") || !available.includes("en-US"), "no Chromium dictionaries on this platform");
  await chrome.evaluate(() => (globalThis as unknown as Global).browser.settings.update({ spellcheck: { languages: ["fr", "en-US"] } }));
  await expect.poll(languages).toEqual(["fr", "en-US"]);

  // The settings section shows them checked.
  await chrome.evaluate(() => (globalThis as unknown as Global).browser.settings.open());
  const list = chrome.getByTestId("spellcheck-languages");
  await expect(list.getByRole("checkbox", { name: "Français", exact: true })).toBeChecked();
  await chrome.evaluate(() => (globalThis as unknown as Global).browser.settings.update({ spellcheck: { languages: ["en-US"] } }));
  await expect.poll(languages).toEqual(["en-US"]);
});

export type { Page };
