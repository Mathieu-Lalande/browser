import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ElectronApplication, Page } from "@playwright/test";
import type { BrowserApi } from "@shared/ipc";
import type { BrowserState } from "@shared/types";
import { chromeOf, clickInTab, evalInTab, expect, launch, overlayOf, test, visit } from "./fixtures";

// Password manager (ADR-025): capture on submit, save prompt, encrypted file, fill, browser://passwords.

type Global = { browser: BrowserApi };
const state = (chrome: Page) => chrome.evaluate(() => (globalThis as unknown as Global).browser.getState()) as Promise<BrowserState>;
const activeTab = async (chrome: Page) => {
  const current = await state(chrome);
  return current.tabs.find((tab) => tab.id === current.activeTabId);
};

const PASSWORD = "s3cret-pw-42";

test("without keychain encryption, nothing is saved and the page says why", async ({ chrome }) => {
  // xvfb has no keyring: Electron reports encryption unavailable (the hook below is not set).
  await chrome.evaluate(() => (globalThis as unknown as Global).browser.commands.run("open-passwords"));
  await expect(chrome.getByTestId("passwords-page").getByRole("alert")).toContainText("ne peuvent pas être enregistrés");
});

test("a submitted login is saved encrypted, then filled on request", async ({ server, profile }) => {
  const app = await launch(profile, { BROWSER_TEST_PLAIN_KEYCHAIN: "1" });
  try {
    await savesAndFills(app, await chromeOf(app), server.url("/login"), profile);
  } finally {
    await app.close();
  }
});

async function savesAndFills(app: ElectronApplication, chrome: Page, login: string, profile: string): Promise<void> {
  await visit(chrome, login, "Login");
  await evalInTab(app, login, `document.getElementById("user").value = "alice"; document.getElementById("pass").value = ${JSON.stringify(PASSWORD)};`);
  // A real click (trusted input): scripted submissions are ignored.
  await clickInTab(app, login, "#submit");

  const overlay = await overlayOf(app);
  const prompt = overlay.getByRole("dialog", { name: "Enregistrer le mot de passe" });
  await expect(prompt).toBeVisible();
  await expect(prompt.getByRole("heading")).toHaveText(/^Enregistrer le mot de passe pour 127\.0\.0\.1:\d+ \(http\) \?$/);
  await expect(prompt.getByText("alice")).toBeVisible();
  await prompt.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(prompt).toBeHidden();

  // Encrypted at rest: neither the password nor the username is readable in the profile.
  await expect.poll(() => readFileSync(join(profile, "passwords.json"), "utf8").length).toBeGreaterThan(0);
  const stored = readFileSync(join(profile, "passwords.json"), "utf8");
  expect(stored).not.toContain(PASSWORD);
  expect(stored).not.toContain("alice");

  // Back on the login page: the key appears, and filling puts the account in the form.
  await visit(chrome, login, "Login");
  await expect.poll(async () => (await activeTab(chrome))?.hasPasswords).toBe(true);
  await chrome.getByRole("button", { name: "Remplir un mot de passe enregistré" }).click();
  const chooser = overlay.getByRole("dialog", { name: "Mots de passe enregistrés" });
  await expect(chooser).toBeVisible();
  await chooser.getByRole("button", { name: /alice/ }).click();
  await expect(chooser).toBeHidden();
  await expect.poll(() => evalInTab(app, login, `[document.getElementById("user").value, document.getElementById("pass").value]`)).toEqual(["alice", PASSWORD]);

  // The same login again is not asked about.
  await clickInTab(app, login, "#submit");
  await expect(chrome.locator(".tab.active .title")).toHaveText("Page welcome");
  await expect(prompt).toBeHidden();

  // browser://passwords lists it without the password, until "Afficher" is confirmed.
  await chrome.evaluate(() => (globalThis as unknown as Global).browser.commands.run("open-passwords"));
  const page = chrome.getByTestId("passwords-page");
  const row = page.getByRole("list", { name: "Mots de passe enregistrés" }).getByRole("listitem");
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("alice");
  await expect(row.getByTestId("password-value")).not.toHaveText(PASSWORD);
  await row.getByRole("button", { name: /^Afficher le mot de passe de/ }).click();
  await row.getByRole("button", { name: "Afficher", exact: true }).click();
  await expect(row.getByTestId("password-value")).toHaveText(PASSWORD);
}
