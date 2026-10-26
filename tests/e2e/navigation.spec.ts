import { expect, tabUrls, test } from "./fixtures";

test("opens on the start page with a single tab", async ({ chrome }) => {
  await expect(chrome.locator(".start h1")).toBeVisible();
  await expect(chrome.locator(".tabs [role=tab]")).toHaveCount(1);
});

test("navigates from the address bar and updates the tab", async ({ app, chrome, server }) => {
  const address = chrome.getByLabel("Barre d'adresse");
  await address.fill(server.url("/hello"));
  await address.press("Enter");
  await expect(chrome.locator(".tab.active .title")).toHaveText("Page hello");
  await expect(chrome.locator(".start")).toHaveCount(0);
  expect(await tabUrls(app)).toContain(server.url("/hello"));
  await expect(chrome.getByLabel("Précédent")).toBeDisabled();
});

test("creates, switches and closes tabs", async ({ chrome, server }) => {
  await chrome.getByRole("button", { name: "Nouvel onglet" }).click();
  await expect(chrome.locator(".tabs [role=tab]")).toHaveCount(2);
  const address = chrome.getByLabel("Barre d'adresse");
  await expect(address).toBeFocused();
  await address.fill(server.url("/second"));
  await address.press("Enter");
  await expect(chrome.locator(".tab.active .title")).toHaveText("Page second");

  await chrome.locator(".tabs [role=tab]").first().click();
  await expect(chrome.locator(".start")).toBeVisible();

  await chrome.locator(".tab.active .close").click();
  await expect(chrome.locator(".tabs [role=tab]")).toHaveCount(1);
  await expect(chrome.locator(".tab.active .title")).toHaveText("Page second");
});

test("links opening a new window become a new tab", async ({ app, chrome, server }) => {
  const address = chrome.getByLabel("Barre d'adresse");
  await address.fill(server.url("/popup"));
  await address.press("Enter");
  await expect(chrome.locator(".tab.active .title")).toHaveText("Opener");
  await app.evaluate(({ webContents }, url) => {
    const page = webContents.getAllWebContents().find((contents) => contents.getURL() === url);
    return page?.executeJavaScript("document.getElementById('open').click()", true);
  }, server.url("/popup"));
  await expect(chrome.locator(".tabs [role=tab]")).toHaveCount(2);
  await expect(chrome.locator(".tab.active .title")).toHaveText("Page second");
});

test("pages cannot navigate to file: URLs", async ({ app, chrome, server }) => {
  const address = chrome.getByLabel("Barre d'adresse");
  await address.fill(server.url("/file-link"));
  await address.press("Enter");
  await expect(chrome.locator(".tab.active .title")).toHaveText("File link");
  await app.evaluate(({ webContents }, url) => {
    const page = webContents.getAllWebContents().find((contents) => contents.getURL() === url);
    return page?.executeJavaScript("document.getElementById('file').click()", true);
  }, server.url("/file-link"));
  await new Promise((resolve) => setTimeout(resolve, 500));
  expect((await tabUrls(app)).some((url) => url.startsWith("file:"))).toBe(false);
});

test("typing a file: URL searches instead of loading it", async ({ app, chrome }) => {
  await app.evaluate(({ session }) => {
    // Keep the test offline: answer search requests locally.
    session.defaultSession.protocol.handle("https", () => new Response("<title>Search</title>", { headers: { "content-type": "text/html" } }));
  });
  const address = chrome.getByLabel("Barre d'adresse");
  await address.fill("file:///etc/passwd");
  await address.press("Enter");
  await expect.poll(() => tabUrls(app)).toContainEqual(expect.stringContaining("duckduckgo.com/?q=file"));
});
