import { createServer, type Server } from "node:http";
import { crx3, testKey, zipOf } from "../crx-pack";
import { chromeOf, expect, ICON_PNG, launch, overlayOf, test, visit } from "./fixtures";

/**
 * Chrome Web Store installs, updates and extension toolbar buttons (ADR-049), against a local
 * fake store (`BROWSER_TEST_WEBSTORE_URL`): a detail page, and the update service answering with
 * a redirect to a CRX3 signed by the test key, or with the version XML.
 */

const key = testKey();
let version = "1.0.0";

function extensionZip(): Buffer {
  const manifest = {
    manifest_version: 3,
    name: "Extension boutique",
    version,
    description: "Installée depuis le faux Chrome Web Store.",
    permissions: version === "1.0.0" ? ["storage", "tabs"] : ["storage", "tabs", "bookmarks"],
    host_permissions: ["https://example.com/*"],
    action: { default_title: "Ouvrir la boutique", default_popup: "popup.html", default_icon: "icon.png" },
  };
  return zipOf({
    "manifest.json": JSON.stringify(manifest),
    "popup.html": `<!doctype html><title>Popup</title><body style="width:240px;height:120px;margin:0"><p id="hello">Bonjour depuis la popup ${version}</p></body>`,
    "icon.png": ICON_PNG,
  });
}

function startStore(): Promise<{ server: Server; origin: string }> {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://store");
    if (url.pathname.startsWith("/detail/")) {
      res.setHeader("content-type", "text/html; charset=utf-8");
      return res.end(`<title>Extension boutique - Chrome Web Store</title><h1>Extension boutique</h1>`);
    }
    if (url.pathname === "/service/update2/crx") {
      const x = new URLSearchParams(url.searchParams.get("x") ?? "");
      if (x.get("id") !== key.id) return res.writeHead(204).end();
      if (url.searchParams.get("response") === "redirect") return res.writeHead(302, { location: `/crx/${key.id}-${version}.crx` }).end();
      res.setHeader("content-type", "text/xml");
      return res.end(`<gupdate protocol="2.0"><app appid="${key.id}" status="ok"><updatecheck status="ok" version="${version}"/></app></gupdate>`);
    }
    if (url.pathname.startsWith("/crx/")) {
      res.setHeader("content-type", "application/x-chrome-extension");
      return res.end(crx3(extensionZip(), key));
    }
    res.writeHead(404).end();
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, origin: `http://127.0.0.1:${(server.address() as { port: number }).port}` })));
}

test("a Chrome Web Store extension installs after its permissions, shows its button and popup, and updates", async ({ profile }) => {
  version = "1.0.0";
  const { server, origin } = await startStore();
  const app = await launch(profile, { BROWSER_TEST_WEBSTORE_URL: origin });
  try {
    const chrome = await chromeOf(app);
    await visit(chrome, `${origin}/detail/extension-boutique/${key.id}`, "Extension boutique - Chrome Web Store");
    // Offered twice: the address bar button and the bar above the (unmodified) store page.
    await expect(chrome.getByRole("button", { name: "Ajouter à Browser" })).toHaveCount(2);
    const bar = chrome.getByTestId("webstore-bar");
    await bar.getByRole("button", { name: "Ajouter à Browser" }).click();

    const overlay = await overlayOf(app);
    const review = overlay.getByRole("dialog", { name: "Ajouter « Extension boutique » ?" });
    await expect(review).toBeVisible();
    await expect(review.getByText("Lire et modifier vos données sur example.com")).toBeVisible();
    await expect(review.getByText("Lire votre historique de navigation")).toBeVisible();
    await review.getByRole("button", { name: "Ajouter l'extension" }).click();
    await expect(bar.getByText("« Extension boutique » est installée.")).toBeVisible();
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

    // A new version asking for more: "Mettre à jour les extensions" shows only the new permission.
    version = "1.1.0";
    await chrome.evaluate(() => (globalThis as unknown as { browser: { commands: { run(id: string): void } } }).browser.commands.run("open-extensions"));
    const page = chrome.getByTestId("extensions-page");
    await expect(page.getByText("Chrome Web Store", { exact: false }).first()).toBeVisible();
    await page.getByRole("button", { name: "Mettre à jour les extensions" }).click();
    const update = overlay.getByRole("dialog", { name: "Mettre à jour « Extension boutique » ?" });
    await expect(update.getByText("Lire et modifier vos favoris")).toBeVisible();
    await expect(update.getByText("Lire votre historique de navigation")).toHaveCount(0);
    await update.getByRole("button", { name: "Mettre à jour" }).click();
    await expect(page.getByText("Mise à jour : « Extension boutique » 1.1.0.")).toBeVisible();
    await expect(page.locator("[data-extension-id] .version")).toHaveText("1.1.0");
  } finally {
    await app.close();
    server.close();
  }
});
