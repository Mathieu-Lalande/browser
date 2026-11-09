import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { fileURLToPath } from "node:url";
import type { ElectronApplication } from "@playwright/test";
import { crx3, testKey, zipOf } from "../crx-pack";
import { chromeOf, evalInTab, expect, ICON_PNG, launch, overlayOf, test, visit } from "./fixtures";

/**
 * Chrome Web Store installs, updates and extension toolbar buttons (ADR-049), against a local
 * fake store (`BROWSER_TEST_WEBSTORE_URL`): a detail page shaped like the real one served to a
 * browser that is not Chrome (greyed "Ajouter à Chrome", "Passez à Chrome" banner), and the
 * update service answering with a redirect to a CRX3 signed by the test key, or with the version XML.
 */

const key = testKey();
let version = "1.0.0";
/** Next CRX downloads: "fail" answers 500, a number holds the answer that long (ms). */
const downloads: ("fail" | number)[] = [];

const STORE_PAGE = readFileSync(fileURLToPath(new URL("../fixtures/webstore/detail-fr.html", import.meta.url)), "utf8").replace(
  /<title>[^<]*<\/title>/,
  "<title>Extension boutique - Chrome Web Store</title>",
);

function extensionZip(): Buffer {
  const manifest = {
    manifest_version: 3,
    name: "Extension boutique",
    version,
    description: "Installée depuis le faux Chrome Web Store.",
    permissions: version === "1.0.0" ? ["storage", "tabs"] : ["storage", "tabs", "bookmarks"],
    host_permissions: ["https://example.com/*"],
    action: { default_title: "Ouvrir la boutique", default_popup: "popup.html", default_icon: "icon.png" },
    options_ui: { page: "options.html" },
  };
  return zipOf({
    "manifest.json": JSON.stringify(manifest),
    "popup.html": `<!doctype html><title>Popup</title><body style="width:240px;height:120px;margin:0"><p id="hello">Bonjour depuis la popup ${version}</p></body>`,
    "options.html": `<!doctype html><title>Options de la boutique</title><h1>Options</h1>`,
    "icon.png": ICON_PNG,
  });
}

function startStore(): Promise<{ server: Server; origin: string }> {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://store");
    if (url.pathname.startsWith("/detail/")) {
      res.setHeader("content-type", "text/html; charset=utf-8");
      return res.end(STORE_PAGE);
    }
    if (url.pathname === "/service/update2/crx") {
      const x = new URLSearchParams(url.searchParams.get("x") ?? "");
      if (x.get("id") !== key.id) return res.writeHead(204).end();
      if (url.searchParams.get("response") === "redirect") return res.writeHead(302, { location: `/crx/${key.id}-${version}.crx` }).end();
      res.setHeader("content-type", "text/xml");
      return res.end(`<gupdate protocol="2.0"><app appid="${key.id}" status="ok"><updatecheck status="ok" version="${version}"/></app></gupdate>`);
    }
    if (url.pathname.startsWith("/crx/")) {
      const next = downloads.shift();
      if (next === "fail") return res.writeHead(500).end();
      const send = () => {
        res.setHeader("content-type", "application/x-chrome-extension");
        res.end(crx3(extensionZip(), key));
      };
      return typeof next === "number" ? void setTimeout(send, next) : send();
    }
    res.writeHead(404).end();
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, origin: `http://127.0.0.1:${(server.address() as { port: number }).port}` })));
}

/** Our button inside the store page (closed shadow root, read from the agent's isolated world). */
const storeButton = (app: ElectronApplication, prefix: string) =>
  app.evaluate(async ({ webContents }, url) => {
    const page = webContents.getAllWebContents().find((contents) => contents.getURL().startsWith(url));
    if (!page) return null;
    return page.executeJavaScriptInIsolatedWorld(1022, [
      {
        code: `(() => { const s = globalThis.__browserStore; if (!s || !s.host.isConnected) return null;
          const b = s.shadow.querySelector("button"), p = s.shadow.querySelector("p");
          return { label: b.textContent, disabled: b.disabled, message: p.hidden ? null : p.textContent }; })()`,
      },
    ]);
  }, prefix) as Promise<{ label: string; disabled: boolean; message: string | null } | null>;

/** A real (trusted) click on our button: the top of its host, below which an error message may show. */
const clickStoreButton = (app: ElectronApplication, prefix: string) =>
  app.evaluate(async ({ webContents }, url) => {
    const page = webContents.getAllWebContents().find((contents) => contents.getURL().startsWith(url))!;
    const rect: { x: number; y: number } = await page.executeJavaScript(
      `(() => { const r = document.querySelector(".SwFHyf > span").getBoundingClientRect(); return { x: r.x + 30, y: r.y + 15 }; })()`,
    );
    const [x, y] = [Math.round(rect.x), Math.round(rect.y)];
    page.sendInputEvent({ type: "mouseMove", x, y });
    page.sendInputEvent({ type: "mouseDown", x, y, button: "left", clickCount: 1 });
    page.sendInputEvent({ type: "mouseUp", x, y, button: "left", clickCount: 1 });
  }, prefix);

test("a Chrome Web Store extension installs from our button in the store page, shows its progress, button, popup, details, options, and updates", async ({
  profile,
}) => {
  version = "1.0.0";
  downloads.length = 0;
  downloads.push("fail", 2500);
  const { server, origin } = await startStore();
  const app = await launch(profile, { BROWSER_TEST_WEBSTORE_URL: origin });
  try {
    const chrome = await chromeOf(app);
    const detail = `${origin}/detail/extension-boutique/${key.id}`;
    await visit(chrome, detail, "Extension boutique - Chrome Web Store");

    // The store's greyed "Ajouter à Chrome" and its "Passez à Chrome" banner give way to our button.
    await expect.poll(() => storeButton(app, detail)).toEqual({ label: "Ajouter à Browser", disabled: false, message: null });
    const page = await evalInTab<{ theirs: string; banner: string; next: string }>(
      app,
      detail,
      `({ theirs: getComputedStyle(document.querySelector("button[jscontroller]")).display,
          banner: getComputedStyle(document.querySelector(".Sb7Fwe")).display,
          next: document.querySelector("button[jscontroller]").nextElementSibling.tagName })`,
    );
    expect(page).toEqual({ theirs: "none", banner: "none", next: "SPAN" });
    // The address bar keeps its own action; no store bar while nothing went wrong.
    await expect(chrome.getByRole("button", { name: "Ajouter à Browser" })).toHaveCount(1);
    await expect(chrome.getByTestId("webstore-bar")).toHaveCount(0);

    // First attempt: the store answers 500. The button says why and offers "Réessayer"; so does the store bar.
    await clickStoreButton(app, detail);
    await expect.poll(async () => (await storeButton(app, detail))?.label).toBe("Réessayer");
    expect((await storeButton(app, detail))?.message).toContain("erreur 500");
    await expect(chrome.getByTestId("webstore-bar")).toContainText("erreur 500");
    await expect(chrome.getByRole("button", { name: "Réessayer d'ajouter à Browser" })).toBeVisible();

    // Retry: the download is held a moment, its progress shows in the page and the address bar.
    await clickStoreButton(app, detail);
    await expect.poll(() => storeButton(app, detail)).toEqual({ label: "Téléchargement…", disabled: true, message: null });
    await expect(chrome.locator("[data-store-phase='download']")).toBeVisible();
    await expect(chrome.getByTestId("webstore-bar")).toHaveCount(0);

    const overlay = await overlayOf(app);
    const review = overlay.getByRole("dialog", { name: "Ajouter « Extension boutique » ?" });
    await expect(review).toBeVisible();
    expect((await storeButton(app, detail))?.label).toBe("En attente de votre accord…");
    await expect(review.getByText("Lire et modifier vos données sur example.com")).toBeVisible();
    await expect(review.getByText("Lire votre historique de navigation")).toBeVisible();
    await review.getByRole("button", { name: "Ajouter l'extension" }).click();

    // Installed: a confirmation hangs from the extension bar and offers to pin its button.
    const installed = overlay.getByTestId("extension-installed");
    await expect(installed.getByText("« Extension boutique » a été ajoutée")).toBeVisible();
    await installed.getByRole("button", { name: "Épingler" }).click();
    await expect.poll(async () => (await storeButton(app, detail))?.label).toBe("Supprimer de Browser");
    await expect(chrome.getByRole("button", { name: "Ajouter à Browser" })).toHaveCount(0);

    // Its toolbar button, under the address bar; a click opens its popup below it, in a native view.
    const button = chrome.getByTestId("extension-bar").getByRole("button", { name: "Ouvrir la boutique" });
    await expect(button).toBeVisible();
    await button.click();
    const popupUrl = `chrome-extension://${key.id}/popup.html`;
    const popup = () =>
      app.evaluate(async ({ BrowserWindow, WebContentsView }, url) => {
        const view = BrowserWindow.getAllWindows()[0].contentView.children.find(
          (child) => child instanceof WebContentsView && child.webContents.getURL() === url,
        ) as InstanceType<typeof WebContentsView> | undefined;
        if (!view || view.webContents.isLoading()) return null;
        return { text: await view.webContents.executeJavaScript("document.getElementById('hello')?.textContent ?? ''"), ...view.getBounds() };
      }, popupUrl);
    await expect.poll(async () => (await popup())?.text).toBe("Bonjour depuis la popup 1.0.0");
    // Sized by the page (240×120), below the button.
    const box = (await button.boundingBox())!;
    await expect.poll(async () => (await popup())?.width).toBe(240);
    expect((await popup())!.y).toBeGreaterThanOrEqual(Math.floor(box.y + box.height));
    // A click outside closes it.
    await overlay.mouse.click(box.x + 600, box.y + 400);
    await expect.poll(popup).toBe(null);

    // browser://extensions: its card, "Détails" (sites, size, update status) and its options page in a tab.
    await chrome.evaluate(() => (globalThis as unknown as { browser: { commands: { run(id: string): void } } }).browser.commands.run("open-extensions"));
    const extensions = chrome.getByTestId("extensions-page");
    const row = extensions.locator(`[data-extension-id]`);
    await expect(row.getByRole("button", { name: /Chrome Web Store/ })).toBeVisible();
    await row.getByRole("button", { name: "Détails" }).click();
    const details = row.getByTestId("extension-details");
    await expect(details.getByText("example.com", { exact: true })).toBeVisible();
    await expect(details.getByText(/^Taille : /)).toBeVisible();
    await expect(details.getByText("Mises à jour : jamais vérifiées")).toBeVisible();
    await details.getByRole("button", { name: "Ouvrir les options" }).click();
    const optionsUrl = `chrome-extension://${key.id}/options.html`;
    await expect.poll(() => evalInTab<string>(app, optionsUrl, "document.title").catch(() => null)).toBe("Options de la boutique");

    // A new version asking for more: "Mettre à jour les extensions" shows only the new permission.
    version = "1.1.0";
    await chrome.evaluate(() => (globalThis as unknown as { browser: { commands: { run(id: string): void } } }).browser.commands.run("open-extensions"));
    await extensions.getByRole("button", { name: "Mettre à jour les extensions" }).click();
    const update = overlay.getByRole("dialog", { name: "Mettre à jour « Extension boutique » ?" });
    await expect(update.getByText("Lire et modifier vos favoris")).toBeVisible();
    await expect(update.getByText("Lire votre historique de navigation")).toHaveCount(0);
    await update.getByRole("button", { name: "Mettre à jour" }).click();
    await expect(extensions.getByText("Mise à jour : « Extension boutique » 1.1.0.")).toBeVisible();
    await expect(extensions.locator("[data-extension-id] .version")).toHaveText("1.1.0");
    await expect(extensions.getByTestId("extensions-last-check")).toContainText("Dernière vérification");
  } finally {
    await app.close();
    server.close();
  }
});
