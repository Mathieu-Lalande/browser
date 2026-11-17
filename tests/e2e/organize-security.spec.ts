import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { Page } from "@playwright/test";
import type { BrowserApi } from "@shared/ipc";
import type { BrowserState } from "@shared/types";
import { chromeOf, clickInTab, evalInTab, expect, launch, overlayOf, test, visit } from "./fixtures";

async function newTab(chrome: Page, url: string, title: string): Promise<void> {
  await chrome.getByRole("button", { name: "Nouvel onglet" }).click();
  await visit(chrome, url, title);
}

// ADR-059: anchored pinned tabs, "Ranger les onglets" (site grouping without the assistant),
// password checkup (weak, reused, breached through a local fake range service).

type Global = { browser: BrowserApi };
const state = (chrome: Page) => chrome.evaluate(() => (globalThis as unknown as Global).browser.getState()) as Promise<BrowserState>;

test("a pinned tab that wandered off goes back to its pinned page", async ({ chrome, server }) => {
  await visit(chrome, server.url("/one"), "Page one");
  const [one] = (await state(chrome)).tabs;
  await chrome.evaluate((id) => (globalThis as unknown as Global).browser.tabs.togglePin(id), one.id);
  await expect.poll(async () => (await state(chrome)).tabs[0].pinnedUrl).toBe(server.url("/one"));
  const chip = chrome.getByTestId("pinned-home");
  await expect(chip).toBeHidden();

  // A pinned tab is not in the tab list (`visit` looks there): navigate it directly.
  await chrome.evaluate(([id, url]) => (globalThis as unknown as Global).browser.tabs.navigate(id, url), [one.id, server.url("/two")] as const);
  await expect.poll(async () => (await state(chrome)).tabs[0].url).toBe(server.url("/two"));
  await expect(chip).toBeVisible();
  await expect(chrome.locator(".pinned-tab .away-dot")).toHaveCount(1);
  await chip.click();
  await expect.poll(async () => (await state(chrome)).tabs[0].url).toBe(server.url("/one"));
  await expect(chip).toBeHidden();
});

test("tidying tabs proposes folders by site and creates the kept ones", async ({ chrome, server }) => {
  await visit(chrome, server.url("/one"), "Page one");
  await newTab(chrome, server.url("/two"), "Page two");
  await newTab(chrome, server.url("/three"), "Page three");
  await chrome.evaluate(() => (globalThis as unknown as Global).browser.commands.run("tidy-tabs"));
  const panel = chrome.getByTestId("tidy-panel");
  await expect(panel).toContainText("Regroupés par sujet sur cet appareil");
  await expect(panel.getByRole("textbox", { name: "Nom du dossier" })).toHaveValue("127.0.0.1");
  await panel.getByRole("textbox", { name: "Nom du dossier" }).fill("Tests");
  await panel.getByRole("button", { name: "Créer 1 dossier" }).click();
  await expect(panel).toBeHidden();
  await expect.poll(async () => (await state(chrome)).folders?.map((folder) => folder.name)).toEqual(["Tests"]);
  await expect.poll(async () => (await state(chrome)).tabs.every((tab) => !!tab.folderId)).toBe(true);
});

const WEAK = "azerty";

function startRanges(): Promise<{ server: Server; url: string; prefixes: string[] }> {
  const prefixes: string[] = [];
  const hash = createHash("sha1").update(WEAK).digest("hex").toUpperCase();
  const server = createServer((req, res) => {
    const prefix = (req.url ?? "").split("/").pop() ?? "";
    prefixes.push(prefix);
    res.setHeader("content-type", "text/plain");
    res.end(prefix === hash.slice(0, 5) ? `${hash.slice(5)}:4242\r\n${"0".repeat(35)}:0` : `${"0".repeat(35)}:0`);
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/range/`, prefixes })));
}

test("the password checkup flags weak and breached passwords, sending only hash prefixes", async ({ server, profile }) => {
  const ranges = await startRanges();
  const app = await launch(profile, { BROWSER_TEST_PLAIN_KEYCHAIN: "1", BROWSER_TEST_BREACH_URL: ranges.url });
  try {
    const chrome = await chromeOf(app);
    const login = server.url("/login");
    await visit(chrome, login, "Login");
    await evalInTab(app, login, `document.getElementById("user").value = "alice"; document.getElementById("pass").value = ${JSON.stringify(WEAK)};`);
    await clickInTab(app, login, "#submit");
    const prompt = (await overlayOf(app)).getByRole("dialog", { name: "Enregistrer le mot de passe" });
    await prompt.getByRole("button", { name: "Enregistrer", exact: true }).click();
    await expect(prompt).toBeHidden();

    await chrome.evaluate(() => (globalThis as unknown as Global).browser.commands.run("open-passwords"));
    const checkup = chrome.getByTestId("password-checkup");
    await checkup.getByRole("button", { name: "Vérifier mes mots de passe" }).click();
    await expect(checkup.getByRole("status")).toContainText("1 mot de passe à corriger");
    await expect(chrome.getByTestId("badge-breached")).toBeVisible();
    await expect(chrome.getByTestId("passwords-page")).toContainText("Faible");
    expect(ranges.prefixes).toEqual([createHash("sha1").update(WEAK).digest("hex").toUpperCase().slice(0, 5)]);
  } finally {
    await app.close();
    ranges.server.close();
  }
});

test("forced dark pages invert light sites, and the setting applies live", async ({ app, chrome, server }) => {
  const page = server.url("/one");
  await visit(chrome, page, "Page one");
  const filter = () => evalInTab<string>(app, page, "getComputedStyle(document.documentElement).filter");
  expect(await filter()).toBe("none");
  await chrome.evaluate(() => (globalThis as unknown as Global).browser.settings.update({ appearance: { darkPages: "on" } }));
  await expect.poll(filter).toContain("invert");
  await chrome.evaluate(() => (globalThis as unknown as Global).browser.settings.update({ appearance: { darkPages: "off" } }));
  await expect.poll(filter).toBe("none");
});

test("a focus session holds listed sites, and ends on demand", async ({ chrome, server }) => {
  await chrome.evaluate(() => (globalThis as unknown as Global).browser.settings.update({ focus: { sites: ["insecure.test"] } }));
  await chrome.evaluate(() => (globalThis as unknown as Global).browser.wellbeing.startFocus(25));
  await expect(chrome.getByTestId("focus-chip")).toContainText("25");
  const held = server.url("/one").replace("127.0.0.1", "insecure.test");
  await chrome.getByLabel("Barre d'adresse").fill(held);
  await chrome.getByLabel("Barre d'adresse").press("Enter");
  await expect(chrome.getByTestId("focus-held")).toContainText("insecure.test attendra la fin de la session");
  await chrome.getByTestId("focus-held").getByRole("button", { name: "Arrêter la session" }).click();
  await expect(chrome.getByTestId("focus-chip")).toHaveCount(0);
  // The other sites never were held.
  await visit(chrome, server.url("/two"), "Page two");
});

test("a named session keeps the space's pages and opens them again in a folder", async ({ chrome, server }) => {
  await visit(chrome, server.url("/one"), "Page one");
  await newTab(chrome, server.url("/two"), "Page two");
  const saved = await chrome.evaluate(() => (globalThis as unknown as Global).browser.sessions.save("Projet test"));
  expect(saved?.map((session) => [session.name, session.count])).toEqual([["Projet test", 2]]);
  await chrome.evaluate(() => (globalThis as unknown as Global).browser.commands.run("open-sessions"));
  const page = chrome.getByTestId("sessions-page");
  await expect(page).toContainText("Projet test");
  await page.getByRole("button", { name: "Ouvrir dans un dossier" }).click();
  await expect.poll(async () => (await state(chrome)).folders?.map((folder) => folder.name)).toEqual(["Projet test"]);
});
