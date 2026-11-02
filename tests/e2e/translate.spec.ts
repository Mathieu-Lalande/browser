import type { Page } from "@playwright/test";
import type { BrowserApi } from "@shared/ipc";
import type { BrowserState } from "@shared/types";
import { evalInTab, expect, openPrivateWindow, overlayOf, test, visit } from "./fixtures";

// Page translation (ADR-036) with a fake LibreTranslate server (the test server uppercases texts):
// off by default, a privacy notice first, text nodes translated in place (never code, scripts,
// fields, editable or hidden content), new content followed, and "Afficher l'original" restores.

type Global = { browser: BrowserApi };
const state = (chrome: Page) => chrome.evaluate(() => (globalThis as unknown as Global).browser.getState()) as Promise<BrowserState>;

const KEPT = { pre: "keep this pre", code: "keep.this.code()", edit: "keep this editable", hidden: "keep this hidden", no: "keep this brand" };

async function useFakeServer(chrome: Page, origin: string): Promise<void> {
  await chrome.evaluate(
    (libreUrl) => (globalThis as unknown as Global).browser.settings.update({ translate: { provider: "libretranslate", libreUrl, target: "fr" } }),
    origin,
  );
}

test("translates a page in place after the privacy notice, then shows the original", async ({ app, chrome, server }) => {
  const url = server.url("/translate-page");
  // Off by default: no button, nothing sent.
  await visit(chrome, url, "Translate me");
  await expect(chrome.getByRole("button", { name: "Traduire la page" })).toHaveCount(0);

  await useFakeServer(chrome, server.url(""));
  await chrome.evaluate(() => (globalThis as unknown as Global).browser.commands.run("reload"));
  const button = chrome.getByRole("button", { name: "Traduire la page" });
  await expect(button).toBeVisible();
  expect(server.log.translations).toHaveLength(0);

  await button.click();
  const overlay = await overlayOf(app);
  const panel = overlay.getByTestId("translate-panel");
  await expect(panel).toContainText("sera envoyé à LibreTranslate");
  await panel.getByRole("button", { name: "Envoyer et traduire" }).click();

  const text = (id: string) => evalInTab<string>(app, url, `document.getElementById(${JSON.stringify(id)}).textContent`);
  await expect.poll(() => text("title")).toBe("HELLO WORLD");
  await expect.poll(() => text("bold")).toBe("JUMPS");
  // Spaces around the translated runs are kept.
  expect(await text("text")).toBe("THE QUICK BROWN FOX JUMPS OVER THE DOG.");
  for (const [id, value] of Object.entries(KEPT)) expect(await text(id)).toBe(value);
  expect(await evalInTab(app, url, `document.getElementById("field").value`)).toBe("keep this input");
  expect(await evalInTab(app, url, `document.getElementById("area").value`)).toBe("keep this area");
  expect(await evalInTab(app, url, `document.scripts[0].textContent`)).toContain("keep this script");
  // Nothing of the skipped content left the page, and no cookie went along.
  const sent = server.log.translations.flatMap((entry) => entry.q).join("\n");
  expect(sent).not.toContain("keep");
  expect(server.log.translations.every((entry) => entry.source === "en" && entry.target === "fr" && !entry.cookie)).toBe(true);
  await expect.poll(async () => (await state(chrome)).tabs.find((tab) => tab.url === url)?.translated).toBe(true);
  expect(await chrome.evaluate(() => (globalThis as unknown as Global).browser.settings.get().then((s) => s.translate.acknowledged))).toBe(true);

  // Content added later is translated too.
  await evalInTab(app, url, `document.getElementById("late").textContent = "late content"`);
  await expect.poll(() => text("late")).toBe("LATE CONTENT");

  // "Afficher l'original" (the command toggles).
  await chrome.evaluate(() => (globalThis as unknown as Global).browser.commands.run("translate-page"));
  await expect.poll(() => text("title")).toBe("Hello world");
  expect(await text("late")).toBe("late content");
  expect(await text("text")).toBe("The quick brown fox jumps over the dog.");
  await expect.poll(async () => (await state(chrome)).tabs.find((tab) => tab.url === url)?.translated).toBe(false);
});

test("'always translate' applies on load; a private window asks first and keeps its rules", async ({ app, chrome, server }) => {
  await useFakeServer(chrome, server.url(""));
  await chrome.evaluate(() =>
    (globalThis as unknown as Global).browser.settings.update({ translate: { acknowledged: true, alwaysLanguages: ["de"] } }),
  );
  const url = server.url("/translate-page?lang=de");
  await visit(chrome, url, "Translate me");
  await expect.poll(() => evalInTab<string>(app, url, `document.getElementById("title").textContent`)).toBe("HELLO WORLD");

  // Private window: nothing is sent before its own confirmation, even with the rule.
  const before = server.log.translations.length;
  const privateChrome = await openPrivateWindow(app, chrome);
  const privateUrl = server.url("/translate-page?lang=de&private");
  await visit(privateChrome, privateUrl, "Translate me");
  await expect(privateChrome.getByRole("button", { name: "Traduire la page" })).toBeVisible();
  const tabId = (await state(privateChrome)).activeTabId!;
  const refused = await privateChrome.evaluate((id) => (globalThis as unknown as Global).browser.translate.run(id, null, "fr", false), tabId);
  expect(refused.ok).toBe(false);
  expect(server.log.translations.length).toBe(before);
  const done = await privateChrome.evaluate((id) => (globalThis as unknown as Global).browser.translate.run(id, null, "fr", true), tabId);
  expect(done.ok).toBe(true);
  await expect.poll(() => evalInTab<string>(app, privateUrl, `document.getElementById("title").textContent`)).toBe("HELLO WORLD");
  // A rule set in the private window stays there.
  await privateChrome.evaluate((id) => (globalThis as unknown as Global).browser.translate.setRule(id, "never-site", true), tabId);
  const saved = await chrome.evaluate(() => (globalThis as unknown as Global).browser.settings.get().then((s) => s.translate.neverSites));
  expect(saved).toEqual([]);
});
