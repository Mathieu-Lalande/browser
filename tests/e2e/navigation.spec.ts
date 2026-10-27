import { CHROME_URL, clickInTab, evalInTab, expect, isChrome, tabUrls, test, visit } from "./fixtures";

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
  const address = chrome.getByLabel("Barre d'adresse");
  await address.fill(server.url("/first"));
  await address.press("Enter");
  await expect(chrome.locator(".tab.active .title")).toHaveText("Page first");
  await chrome.getByRole("button", { name: "Nouvel onglet" }).click();
  await expect(chrome.locator(".tabs [role=tab]")).toHaveCount(2);
  await expect(address).toBeFocused();
  await address.fill(server.url("/second"));
  await address.press("Enter");
  await expect(chrome.locator(".tab.active .title")).toHaveText("Page second");

  await chrome.locator(".tabs [role=tab]").first().click();
  await expect(chrome.locator(".tab.active .title")).toHaveText("Page first");

  await chrome.locator(".tab.active .close").click();
  await expect(chrome.locator(".tabs [role=tab]")).toHaveCount(1);
  await expect(chrome.locator(".tab.active .title")).toHaveText("Page second");
});

test("links opening a new window become a new tab", async ({ app, chrome, server }) => {
  const address = chrome.getByLabel("Barre d'adresse");
  await address.fill(server.url("/popup"));
  await address.press("Enter");
  await expect(chrome.locator(".tab.active .title")).toHaveText("Opener");
  // A real click: the popup blocker lets pages open tabs right after a trusted input only (ADR-018).
  await clickInTab(app, server.url("/popup"), "#open");
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

test("the chrome UI is served from app://, which pages can neither reach nor open (MEDIUM-2)", async ({ app, chrome, server }) => {
  expect(isChrome(chrome)).toBe(true);
  expect(chrome.url()).toBe(CHROME_URL);
  await visit(chrome, server.url("/internal-link"), "Internal link");
  const page = server.url("/internal-link");
  // Subresource requests to app:// are cancelled for tab pages.
  const fetched = await evalInTab(app, page, `fetch(${JSON.stringify(CHROME_URL)}, { mode: "no-cors" }).then(() => "loaded", () => "blocked")`);
  expect(fetched).toBe("blocked");
  await evalInTab(app, page, `window.open(${JSON.stringify(CHROME_URL)}); location.href = ${JSON.stringify(CHROME_URL)}; true`);
  await new Promise((resolve) => setTimeout(resolve, 600));
  await expect(chrome.locator(".tabs [role=tab]")).toHaveCount(1);
  await expect(chrome.locator(".tab.active .title")).toHaveText("Internal link");
  expect((await tabUrls(app)).some((url) => url.startsWith("app:"))).toBe(false);
  // Only the browser's own UIs run on app:// (the chrome, the overlay).
  const appPages = await app.evaluate(({ webContents }) =>
    webContents
      .getAllWebContents()
      .map((contents) => contents.getURL())
      .filter((url) => url.startsWith("app:")),
  );
  expect(appPages.every((url) => url === "app://browser/index.html" || url === "app://browser/overlay.html")).toBe(true);
  // Nothing outside the renderer bundle is served, path traversal included.
  const traversal = await chrome.evaluate(
    `Promise.all(["app://browser/../main/index.js", "app://browser/%2e%2e/main/index.js", "app://browser/..%2fmain%2findex.js", "app://other/index.html"].map((url) => fetch(url).then((r) => r.status, () => "error")))`,
  );
  expect((traversal as unknown[]).every((status) => status === 404 || status === "error")).toBe(true);
});
