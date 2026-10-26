import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { expect, test } from "./fixtures";

/**
 * Documentation screenshots, only with SCREENSHOTS=1 (under xvfb-run, needs ImageMagick).
 * The X screen is captured: `BrowserWindow.capturePage()` would miss the native child views.
 */
test.skip(!process.env.SCREENSHOTS, "set SCREENSHOTS=1 to refresh docs/screenshots");

const article = `<!doctype html><title>Le guide des navigateurs rapides</title>
<style>
  body { margin: 0; font: 17px/1.6 Georgia, serif; color: #1f2328; background: #fbfaf7; }
  header { padding: 22px 48px; border-bottom: 1px solid #e7e3da; font: 600 15px system-ui, sans-serif; letter-spacing: .02em; }
  main { max-width: 680px; margin: 48px auto; padding: 0 24px; }
  h1 { font-size: 42px; line-height: 1.15; margin: 0 0 18px; }
  .lead { font-size: 20px; color: #59636e; }
  .hero { height: 220px; margin: 28px 0; border-radius: 14px; background: linear-gradient(135deg, #f6a04d, #e8536b 45%, #7b5cf0); }
</style>
<header>LE JOURNAL DU WEB</header>
<main><h1>Le guide des navigateurs rapides</h1>
<p class="lead">Onglets verticaux, palette de commandes et protection de la vie privée : ce qui change vraiment au quotidien.</p>
<div class="hero"></div>
<p>Un bon navigateur s'efface derrière les pages. Les raccourcis clavier y jouent un rôle central : tout doit être à une touche de distance, sans jamais quitter le clavier.</p></main>`;

test("command palette over a page", async ({ app, chrome, server }) => {
  const colorScheme = process.env.SCREENSHOT_THEME === "light" ? "light" : "dark";
  await chrome.emulateMedia({ colorScheme });
  const address = chrome.getByLabel("Barre d'adresse");
  for (const path of ["/docs", "/notes", "/projets"]) {
    await address.fill(server.url(path));
    await address.press("Enter");
    await chrome.getByRole("button", { name: "Nouvel onglet" }).click();
  }
  await address.fill(`data:text/html;charset=utf-8,${encodeURIComponent(article)}`);
  await address.press("Enter");
  await expect(chrome.locator(".tab.active .title")).toHaveText("Le guide des navigateurs rapides");

  await expect.poll(() => app.windows().some((page) => page.url().endsWith("/renderer/overlay.html"))).toBe(true);
  const overlay = app.windows().find((page) => page.url().endsWith("/renderer/overlay.html"))!;
  await overlay.emulateMedia({ colorScheme });
  await app.evaluate(({ BrowserWindow }) => {
    const contents = BrowserWindow.getAllWindows()[0].webContents;
    contents.sendInputEvent({ type: "keyDown", keyCode: "K", modifiers: ["control"] });
    contents.sendInputEvent({ type: "keyUp", keyCode: "K", modifiers: ["control"] });
  });
  const input = overlay.getByRole("combobox", { name: "Palette de commandes" });
  await expect(input).toBeFocused();
  await input.pressSequentially(process.env.PALETTE_QUERY ?? "pa");
  await expect(overlay.locator(".backdrop")).toBeVisible();
  // Let the open animation and the backdrop fade finish.
  await new Promise((resolve) => setTimeout(resolve, 600));

  const bounds = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getContentBounds());
  mkdirSync("docs/screenshots", { recursive: true });
  execFileSync("import", [
    "-window",
    "root",
    "-crop",
    `${bounds.width}x${bounds.height}+${bounds.x}+${bounds.y}`,
    "+repage",
    "-strip",
    "-colors",
    "256",
    "docs/screenshots/palette.png",
  ]);
});
