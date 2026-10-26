import type { BrowserApi } from "@shared/ipc";
import { evalInTab, expect, tabUrls, test, type ElectronApplication } from "./fixtures";

test("the user agent and client hints never mention Electron; Accept-Language can be normalized", async ({ app, chrome, server }) => {
  const address = chrome.getByLabel("Barre d'adresse");
  await address.fill(server.url("/hints"));
  await address.press("Enter");
  await expect(chrome.locator(".tab.active .title")).toHaveText("Page hints");
  const headers = () => evalInTab<Record<string, string>>(app, server.url("/hints"), "fetch('/headers').then((r) => r.json())");

  const sent = await headers();
  expect(sent["sec-ch-ua"]).toContain("Chromium");
  expect(sent["sec-ch-ua"]).not.toMatch(/electron|browser/i);
  expect(sent["user-agent"]).toMatch(/ Chrome\/\d+\.0\.0\.0 /);
  expect(sent["user-agent"]).not.toMatch(/electron|browser\//i);
  // Same major version in the user agent and the client hints.
  const major = /Chrome\/(\d+)/.exec(sent["user-agent"])![1];
  expect(sent["sec-ch-ua"]).toContain(`"Chromium";v="${major}"`);
  expect(sent["sec-gpc"]).toBe("1");

  await chrome.evaluate(() =>
    (globalThis as unknown as { browser: BrowserApi }).browser.settings.update({ privacy: { normalizeAcceptLanguage: true } }),
  );
  await expect.poll(async () => (await headers())["accept-language"]).toBe("en-US,en;q=0.9");
});

/** `display` of the decoy ads of the /shields page: [generic `.ad-box` rule, `127.0.0.1##.site-ad` rule]. */
const adDisplay = (app: ElectronApplication, url: string) =>
  evalInTab<string[]>(app, url, "['.ad-box', '.site-ad'].map((s) => getComputedStyle(document.querySelector(s)).display)");

test("blocks matching requests, counts them, and can be turned off per site", async ({ app, chrome, server }) => {
  const address = chrome.getByLabel("Barre d'adresse");
  await address.fill(server.url("/shields"));
  await address.press("Enter");
  await expect(chrome.locator(".tab.active .title")).toHaveText("Shields");

  const shield = chrome.locator(".address .shield");
  // The image and the script are blocked.
  await expect(shield.locator(".count")).toHaveText("2");
  await expect(shield).toHaveAttribute("aria-pressed", "true");
  expect(await evalInTab(app, server.url("/shields"), "window.adLoaded === true")).toBe(false);
  // Cosmetic filtering, without any preload: site rules at commit, generic rules after a DOM scan.
  await expect.poll(() => adDisplay(app, server.url("/shields"))).toEqual(["none", "none"]);

  await shield.click();
  await expect(shield).toHaveAttribute("aria-pressed", "false");
  await expect(shield.locator(".count")).toHaveCount(0);
  await expect.poll(() => evalInTab(app, server.url("/shields"), "window.adLoaded === true")).toBe(true);
  expect(await adDisplay(app, server.url("/shields"))).toEqual(["block", "block"]);

  // And back on.
  await shield.click();
  await expect(shield).toHaveAttribute("aria-pressed", "true");
  await expect(shield.locator(".count")).toHaveText("2");
});

test("permission requests show a bar; Bloquer denies them", async ({ app, chrome, server }) => {
  const address = chrome.getByLabel("Barre d'adresse");
  await address.fill(server.url("/permission"));
  await address.press("Enter");
  await expect(chrome.locator(".tab.active .title")).toHaveText("Permission");
  const viewportBefore = await chrome.locator(".viewport").boundingBox();

  await evalInTab(
    app,
    server.url("/permission"),
    "Notification.requestPermission().then((result) => (document.title = 'result: ' + result)); true",
  );
  const bar = chrome.getByRole("alertdialog", { name: "Demande d'autorisation" });
  await expect(bar).toContainText("vous envoyer des notifications");
  await expect(bar).toContainText("127.0.0.1");
  // The bar pushes the page down instead of covering it.
  const viewportWithBar = await chrome.locator(".viewport").boundingBox();
  expect(viewportWithBar!.y).toBeGreaterThan(viewportBefore!.y);

  await bar.getByRole("button", { name: "Bloquer" }).click();
  await expect(bar).toHaveCount(0);
  await expect(chrome.locator(".tab.active .title")).toHaveText("result: denied");
});

test("permission requests are queued until their tab is active, and allowed on demand", async ({ app, chrome, server }) => {
  const address = chrome.getByLabel("Barre d'adresse");
  await address.fill(server.url("/permission"));
  await address.press("Enter");
  await expect(chrome.locator(".tab.active .title")).toHaveText("Permission");

  await chrome.getByRole("button", { name: "Nouvel onglet" }).click();
  await expect(chrome.locator(".start")).toBeVisible();
  await evalInTab(
    app,
    server.url("/permission"),
    "Notification.requestPermission().then((result) => (document.title = 'result: ' + result)); true",
  );
  const bar = chrome.getByRole("alertdialog", { name: "Demande d'autorisation" });
  await new Promise((resolve) => setTimeout(resolve, 300));
  await expect(bar).toHaveCount(0);

  await chrome.locator(".tabs [role=tab]").first().click();
  await expect(bar).toBeVisible();
  await bar.getByRole("button", { name: "Autoriser" }).click();
  await expect(chrome.locator(".tab.active .title")).toHaveText("result: granted");
});

test("HTTPS-Only upgrades public hosts and offers an http fallback", async ({ app, chrome, server }) => {
  test.setTimeout(60_000);
  // The local server only speaks http: the upgraded https load of a "public" host fails.
  const httpUrl = server.url("/plain").replace("127.0.0.1", "insecure.test");
  const address = chrome.getByLabel("Barre d'adresse");
  await address.fill(httpUrl);
  await address.press("Enter");

  // Slow (5–15 s): Chromium retries when the plain-http test server resets the TLS handshake.
  await expect(chrome.getByRole("heading", { name: "Connexion sécurisée indisponible" })).toBeVisible({ timeout: 30_000 });
  await chrome.getByRole("button", { name: "Continuer en HTTP" }).click();
  await expect(chrome.locator(".tab.active .title")).toHaveText("Page plain");
  await expect.poll(() => tabUrls(app)).toContain(httpUrl);

  // The exception lasts for the session: no more interstitial for this host.
  await address.fill(httpUrl.replace("/plain", "/again"));
  await address.press("Enter");
  await expect(chrome.locator(".tab.active .title")).toHaveText("Page again");
});
