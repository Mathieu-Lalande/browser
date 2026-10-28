import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { BrowserApi } from "@shared/ipc";
import { clickInTab, evalInTab, expect, overlayOf, test, visit } from "./fixtures";

// Boosts (ADR-029): created from the site panel, a filter and a zapped element, kept across
// reloads, removed live when the boost is switched off.

type Global = { browser: BrowserApi };

test("a boost with a filter and a zapped element applies, persists and goes away when disabled", async ({ app, chrome, server, profile }) => {
  const url = server.url("/boost");
  await visit(chrome, url, "Boost");
  const page = (script: string) => evalInTab<string>(app, url, script);
  const filter = () => page(`getComputedStyle(document.documentElement).filter`);
  const adDisplay = () => page(`getComputedStyle(document.getElementById("ad")).display`);

  // Site panel: create the site's boost, then a quick filter.
  await chrome.evaluate(() => (globalThis as unknown as Global).browser.commands.run("site-info"));
  const overlay = await overlayOf(app);
  const section = overlay.getByTestId("site-boost");
  await section.getByRole("button", { name: "Personnaliser ce site" }).click();
  await section.getByRole("button", { name: "Gris" }).click();
  await expect(section.getByRole("button", { name: "Gris" })).toHaveAttribute("aria-pressed", "true");
  await expect.poll(filter).toContain("grayscale(1)");

  // Zap tool: a real click hides the element and saves a selector for it; Escape ends the tool.
  await section.getByRole("button", { name: "Masquer des éléments" }).click();
  await expect.poll(() => page(`document.documentElement.innerText.includes("Échap pour terminer")`)).toBe(true);
  await clickInTab(app, url, "#ad");
  await expect.poll(adDisplay).toBe("none");
  await app.evaluate(({ webContents }, prefix) => {
    const contents = webContents.getAllWebContents().find((item) => item.getURL().startsWith(prefix));
    contents?.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
  }, url);
  await expect.poll(() => page(`document.documentElement.innerText.includes("Échap pour terminer")`)).toBe(false);
  const stored = () => {
    try {
      return readFileSync(join(profile, "boosts.json"), "utf8");
    } catch {
      return "";
    }
  };
  await expect.poll(stored).toContain("#ad");

  // Reload: applied again on the new document (not just the hidden inline style).
  await chrome.evaluate(() => (globalThis as unknown as Global).browser.commands.run("reload"));
  await expect.poll(() => page(`document.readyState`)).toBe("complete");
  await expect.poll(filter).toContain("grayscale(1)");
  await expect.poll(adDisplay).toBe("none");
  expect(await page(`getComputedStyle(document.getElementById("text")).display`)).toBe("block");

  // browser://boosts lists it; switching it off removes its CSS live.
  await chrome.evaluate(() => (globalThis as unknown as Global).browser.commands.run("open-boosts"));
  const boostsPage = chrome.getByTestId("boosts-page");
  await expect(boostsPage.getByText("127.0.0.1", { exact: true })).toBeVisible();
  await boostsPage.getByRole("switch", { name: "Désactiver 127.0.0.1" }).click();
  await expect(boostsPage.getByRole("switch", { name: "Activer 127.0.0.1" })).toBeVisible();
  await expect.poll(filter).toBe("none");
  await expect.poll(adDisplay).toBe("block");
});

test("the editor refuses an invalid site and saves custom CSS", async ({ app, chrome, server }) => {
  const url = server.url("/boost");
  await visit(chrome, url, "Boost");
  const api = (script: string) => chrome.evaluate(script);
  expect(await api(`(globalThis).browser.boosts.save({ name: "", match: "*.com", enabled: true, css: "", zaps: [], font: null, filters: { invert: false, grayscale: 0, sepia: 0, brightness: 100, contrast: 100 }, script: { enabled: false, code: "", allowPrivate: false } })`)).toMatchObject({ ok: false });
  const saved = await api(
    `(globalThis).browser.boosts.save({ name: "Test", match: "127.0.0.1", enabled: true, css: "#text { color: rgb(1, 2, 3) !important; }", zaps: ["body"], font: null, filters: { invert: false, grayscale: 0, sepia: 0, brightness: 100, contrast: 100 }, script: { enabled: false, code: "", allowPrivate: false } })`,
  );
  // A selector hiding the whole page is refused.
  expect(saved).toMatchObject({ ok: false });
  expect(
    await api(
      `(globalThis).browser.boosts.save({ name: "Test", match: "127.0.0.1", enabled: true, css: "#text { color: rgb(1, 2, 3) !important; }", zaps: [], font: "mono", filters: { invert: false, grayscale: 0, sepia: 0, brightness: 100, contrast: 100 }, script: { enabled: true, code: "document.body.dataset.boosted = String(typeof chrome)", allowPrivate: false } })`,
    ),
  ).toMatchObject({ ok: true });
  await expect.poll(() => evalInTab(app, url, `getComputedStyle(document.getElementById("text")).color`)).toBe("rgb(1, 2, 3)");
  // The script runs at the next load, in an isolated world (its result lands in the shared DOM).
  await chrome.evaluate(() => (globalThis as unknown as Global).browser.commands.run("reload"));
  await expect.poll(() => evalInTab(app, url, `document.body.dataset.boosted ?? ""`)).not.toBe("");
});
