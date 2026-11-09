import { evalInTab, expect, overlayOf, test, visit } from "./fixtures";

/** ADR-046: cookie banners refused, the privacy dashboard, site settings. */

const consent = (app: Parameters<typeof evalInTab>[0], url: string) => evalInTab<string | null>(app, url, "window.consent ?? null");

test("cookie banners are refused, late ones too, hidden when there is no refusal, and can be left alone per site", async ({ app, chrome, server }) => {
  await visit(chrome, server.url("/cmp-onetrust"), "CMP OneTrust");
  await expect.poll(() => consent(app, server.url("/cmp-onetrust"))).toBe("rejected");

  // A banner added by a script after the page is ready: the agent keeps watching for a while.
  await visit(chrome, server.url("/cmp-late"), "CMP late");
  await expect.poll(() => consent(app, server.url("/cmp-late")), { timeout: 8_000 }).toBe("rejected");

  // No refusal at all: the dialog is hidden (user style sheet), "accept" is never clicked.
  await visit(chrome, server.url("/cmp-noreject"), "CMP no reject");
  await expect
    .poll(() => evalInTab<string>(app, server.url("/cmp-noreject"), "getComputedStyle(document.getElementById('CybotCookiebotDialog')).display"))
    .toBe("none");
  expect(await consent(app, server.url("/cmp-noreject"))).toBeNull();

  // Left alone on this site from the site info popover: the banner stays.
  await visit(chrome, server.url("/cmp-onetrust?again"), "CMP OneTrust");
  await chrome.getByRole("button", { name: /^Infos sur le site/ }).click();
  const panel = (await overlayOf(app)).getByRole("dialog", { name: "Infos sur le site" });
  const toggle = panel.getByRole("switch", { name: "Refuser les bandeaux cookies sur ce site" });
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await (await overlayOf(app)).keyboard.press("Escape");
  await visit(chrome, server.url("/cmp-onetrust?third"), "CMP OneTrust");
  await chrome.waitForTimeout(1_500);
  expect(await consent(app, server.url("/cmp-onetrust?third"))).toBeNull();
  expect(await evalInTab(app, server.url("/cmp-onetrust?third"), "!!document.getElementById('onetrust-banner-sdk')")).toBe(true);
});

test("the privacy dashboard counts what was blocked; site settings turn JavaScript off for a site", async ({ app, chrome, server }) => {
  await visit(chrome, server.url("/shields"), "Shields");
  await expect(chrome.getByRole("button", { name: /^Infos sur le site/ })).toHaveAttribute("title", /protections \(2 bloqués\)/);
  await visit(chrome, server.url("/cmp-onetrust"), "CMP OneTrust");
  await expect.poll(() => consent(app, server.url("/cmp-onetrust"))).toBe("rejected");

  await visit(chrome, "browser://privacy", "Confidentialité");
  const dashboard = chrome.getByTestId("privacy-page");
  await expect(dashboard.locator('[data-counter="trackers"] .value')).toHaveText("2");
  await expect(dashboard.locator('[data-counter="cookieBanners"] .value')).toHaveText("1");
  await expect(dashboard.getByRole("button", { name: "127.0.0.1" })).toBeVisible();

  // JavaScript runs until the site's switch turns it off.
  await visit(chrome, server.url("/js-check"), "JS ran");
  await visit(chrome, "browser://site-settings", "Paramètres des sites");
  const page = chrome.getByTestId("site-settings-page");
  await page.getByLabel("Ajouter un site").fill("127.0.0.1");
  await page.getByRole("button", { name: "Ajouter" }).click();
  const js = page.getByRole("switch", { name: "JavaScript sur 127.0.0.1" });
  await expect(js).toHaveAttribute("aria-checked", "true");
  await js.click();
  await expect(js).toHaveAttribute("aria-checked", "false");
  await visit(chrome, server.url("/js-check?off"), "JS check");
  expect(await evalInTab(app, server.url("/js-check?off"), "document.getElementById('out').textContent")).toBe("static");

  // And back on.
  await visit(chrome, "browser://site-settings", "Paramètres des sites");
  await page.getByRole("switch", { name: "JavaScript sur 127.0.0.1" }).click();
  await visit(chrome, server.url("/js-check?on"), "JS ran");
});
