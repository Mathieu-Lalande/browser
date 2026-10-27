import type { ElectronApplication, Page } from "@playwright/test";
import type { BrowserApi } from "@shared/ipc";
import type { BrowserState } from "@shared/types";
import { ICON_PNG, clickInTab, evalInTab, expect, openPrivateWindow, tabUrls, test, visit } from "./fixtures";

/** Regression tests of the post-audit hardening (ADR-017). */

type Api = { browser: BrowserApi };
const stateOf = (chrome: Page) => chrome.evaluate(() => (globalThis as unknown as Api).browser.getState()) as Promise<BrowserState>;
const activeTab = async (chrome: Page) => {
  const state = await stateOf(chrome);
  return state.tabs.find((tab) => tab.id === state.activeTabId)!;
};
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Counts the favicon requests each session made, seen from main (`onCompleted` is free: the pipeline does not use it). */
async function countIconRequests(app: ElectronApplication, pageUrl: string): Promise<void> {
  await app.evaluate(({ session, webContents }, pageUrl) => {
    const g = globalThis as unknown as { iconRequests: Map<Electron.Session, number> };
    g.iconRequests ??= new Map();
    const page = webContents.getAllWebContents().find((contents) => contents.getURL().startsWith(pageUrl));
    for (const ses of [session.defaultSession, ...(page ? [page.session] : [])]) {
      if (g.iconRequests.has(ses)) continue;
      g.iconRequests.set(ses, 0);
      ses.webRequest.onCompleted((details) => {
        if (new URL(details.url).pathname.startsWith("/icon")) g.iconRequests.set(ses, (g.iconRequests.get(ses) ?? 0) + 1);
      });
    }
  }, pageUrl);
}

const iconRequestsOf = (app: ElectronApplication, which: "default" | string) =>
  app.evaluate(({ session, webContents }, which) => {
    const g = globalThis as unknown as { iconRequests: Map<Electron.Session, number> };
    const ses =
      which === "default" ? session.defaultSession : webContents.getAllWebContents().find((contents) => contents.getURL().startsWith(which))!.session;
    return g.iconRequests.get(ses) ?? 0;
  }, which);

test("favicons are fetched by main through the tab's own session and shown as data: URLs (HIGH-1)", async ({ app, chrome, server }) => {
  await app.evaluate(({ session }, url) => session.defaultSession.cookies.set({ url, name: "who", value: "normal" }), server.url("/"));

  // Normal window: the default session is the tab's session.
  await visit(chrome, server.url("/favicon-page"), "Favicon");
  await expect.poll(async () => (await activeTab(chrome)).favicon).toMatch(/^data:image\/png;base64,/);
  await expect(chrome.locator(".tab.active img")).toHaveAttribute("src", `data:image/png;base64,${ICON_PNG.toString("base64")}`);
  const normal = server.log.icons.find((icon) => icon.url === "/icon.png")!;
  expect(normal.cookie).toContain("tabcookie=normal");
  // The tab's privacy pipeline applies: Global Privacy Control is sent.
  expect(normal.gpc).toBe("1");
  // History keeps the small data: favicon, never a URL to fetch.
  const history = await chrome.evaluate(() => (globalThis as unknown as Api).browser.history.search("Favicon", 5));
  expect(history[0]?.favicon).toMatch(/^data:image\/png;base64,/);

  // The chrome UI itself can no longer load remote images (CSP img-src 'self' data:).
  const loaded = await chrome.evaluate(
    `new Promise((resolve) => { const img = new Image(); img.onload = () => resolve(true); img.onerror = () => resolve(false); img.src = ${JSON.stringify(server.url("/icon.png?csp"))}; })`,
  );
  expect(loaded).toBe(false);
  expect(server.log.icons.some((icon) => icon.url.includes("csp"))).toBe(false);

  // Private window: the favicon request goes through the private session only.
  const priv = await openPrivateWindow(app, chrome);
  await visit(priv, server.url("/blank-private"), "Page blank-private");
  await countIconRequests(app, server.url("/blank-private"));
  await visit(priv, server.url("/favicon-page?cookie=private&icon=/icon.png%3Fprivate"), "Favicon");
  await expect.poll(async () => (await activeTab(priv)).favicon).toMatch(/^data:image\/png;base64,/);
  await expect(priv.locator(".tab.active img")).toHaveAttribute("src", /^data:image\/png;base64,/);
  const privateIcon = server.log.icons.find((icon) => icon.url === "/icon.png?private")!;
  expect(privateIcon.cookie).toContain("tabcookie=private");
  expect(privateIcon.cookie).not.toContain("who=normal");
  expect(privateIcon.cookie).not.toContain("tabcookie=normal");
  expect(await iconRequestsOf(app, server.url("/favicon-page?cookie=private"))).toBe(1);
  expect(await iconRequestsOf(app, "default")).toBe(0);

  // A bookmark made in a private window keeps no favicon (nothing about the page is fetched again later).
  await priv.getByRole("button", { name: "Ajouter aux favoris" }).click();
  await expect
    .poll(async () => (await chrome.evaluate(() => (globalThis as unknown as Api).browser.bookmarks.list())).map((bookmark) => bookmark.favicon))
    .toEqual([null]);
});

test("favicons that are not small raster images are refused (HIGH-1)", async ({ chrome, server }) => {
  for (const icon of ["/icon.svg", "/icon-html", "/icon-huge"]) {
    await visit(chrome, server.url(`/favicon-page?icon=${icon}`), "Favicon");
    await expect.poll(() => server.log.icons.some((logged) => logged.url === icon)).toBe(true);
    await pause(300);
    expect((await activeTab(chrome)).favicon).toBeNull();
  }
});

test("the start page image is fetched by main, and private windows do not load it (HIGH-1)", async ({ app, chrome }) => {
  await app.evaluate(({ session }, png) => {
    session.fromPartition("browser-assets").protocol.handle("https", () => new Response(Buffer.from(png, "base64"), { headers: { "content-type": "image/png" } }));
  }, ICON_PNG.toString("base64"));
  await chrome.evaluate(() =>
    (globalThis as unknown as Api).browser.settings.update({ startPage: { background: "image", backgroundImage: "https://images.test/bg.png" } }),
  );
  const startImage = (page: Page) => page.evaluate(`getComputedStyle(document.querySelector(".start")).getPropertyValue("--start-image")`);
  await expect.poll(() => startImage(chrome)).toContain("data:image/png;base64,");

  const priv = await openPrivateWindow(app, chrome);
  await expect(priv.locator(".start")).toBeVisible();
  expect(await startImage(priv)).toBe("");
});

test("popups without a user gesture are blocked, with a notice that can open them (MEDIUM-1)", async ({ app, chrome, server }) => {
  await visit(chrome, server.url("/auto-popup"), "Auto popup");
  const notice = chrome.getByRole("status", { name: "Fenêtre surgissante bloquée" });
  await expect(notice).toContainText("Fenêtre surgissante bloquée");
  await pause(300);
  await expect(chrome.locator(".tabs [role=tab]")).toHaveCount(1);

  await notice.getByRole("button", { name: "Ouvrir" }).click();
  await expect(chrome.locator(".tabs [role=tab]")).toHaveCount(2);
  await expect(chrome.locator(".tab.active .title")).toHaveText("Page popped");
  expect(await tabUrls(app)).toContain(server.url("/popped"));

  // A blocked data: popup is not even offered.
  await visit(chrome, server.url(`/auto-popup?to=${encodeURIComponent("data:text/html,<title>phish</title>")}`), "Auto popup");
  await pause(400);
  await expect(chrome.getByRole("status", { name: "Fenêtre surgissante bloquée" })).toHaveCount(0);
  expect((await tabUrls(app)).some((url) => url.startsWith("data:"))).toBe(false);
});

test("a real click opens one tab per gesture, never a data: or app: page (MEDIUM-1)", async ({ app, chrome, server }) => {
  await visit(chrome, server.url("/opener"), "Opener");
  const tabs = chrome.locator(".tabs [role=tab]");

  await clickInTab(app, server.url("/opener"), "#data");
  await clickInTab(app, server.url("/opener"), "#app");
  await pause(500);
  await expect(tabs).toHaveCount(1);
  expect((await tabUrls(app)).some((url) => url.startsWith("data:") || url.startsWith("app:"))).toBe(false);

  // One click, two window.open() calls: one tab.
  await clickInTab(app, server.url("/opener"), "#two");
  await expect(tabs).toHaveCount(2);
  await pause(500);
  await expect(tabs).toHaveCount(2);
  expect((await tabUrls(app)).filter((url) => url.includes("/popped"))).toEqual([server.url("/popped?a")]);
});

test("mailto: needs a user gesture and is rate-limited (LOW-1)", async ({ app, chrome, server }) => {
  await app.evaluate(({ shell }) => {
    const g = globalThis as unknown as { launched: string[] };
    g.launched = [];
    shell.openExternal = async (url: string) => void g.launched.push(url);
  });
  const launched = () => app.evaluate(() => (globalThis as unknown as { launched: string[] }).launched);

  await visit(chrome, server.url("/auto-mailto"), "Auto mailto");
  await pause(500);
  expect(await launched()).toEqual([]);

  await visit(chrome, server.url("/opener"), "Opener");
  await clickInTab(app, server.url("/opener"), "#mail");
  await expect.poll(launched).toEqual(["mailto:hello@example.com"]);
  // A second launch right away is refused, even with a click.
  await clickInTab(app, server.url("/opener"), "#mail");
  await pause(500);
  expect(await launched()).toEqual(["mailto:hello@example.com"]);
});

test("pushState storms do not flood the history (MEDIUM-4)", async ({ chrome, server }) => {
  await visit(chrome, server.url("/push-storm"), "Storm");
  await pause(500);
  const found = await chrome.evaluate(() => (globalThis as unknown as Api).browser.history.search("push-storm", 100));
  expect(found.length).toBeLessThanOrEqual(2);
});

test("a permission allowed to an embedded frame only holds inside that site (LOW-2)", async ({ app, chrome, server }) => {
  const port = new URL(server.url("/")).port;
  const frameUrl = `http://localhost:${port}/permission`;
  await visit(chrome, server.url(`/embedder?frame=${encodeURIComponent(frameUrl)}`), "Embedder");
  const askFromFrame = () =>
    app.evaluate(async ({ webContents }, prefix) => {
      const page = webContents.getAllWebContents().find((contents) => contents.getURL().startsWith(prefix))!;
      const frame = page.mainFrame.frames.find((child) => child.url.startsWith("http://localhost"));
      if (!frame) return false;
      await frame.executeJavaScript("navigator.geolocation.getCurrentPosition(() => {}, () => {}); true", true);
      return true;
    }, server.url("/embedder"));
  await expect.poll(askFromFrame).toBe(true);

  const bar = chrome.getByRole("alertdialog", { name: "Demande d'autorisation" });
  await expect(bar).toContainText(`localhost:${port} (intégré dans 127.0.0.1:${port})`);
  await expect(bar).toContainText("connaître votre position");
  await bar.getByRole("button", { name: "Autoriser" }).click();
  await expect(bar).toHaveCount(0);

  // The same origin, on its own, must ask again.
  await visit(chrome, frameUrl, "Permission");
  await evalInTab(app, frameUrl, "navigator.geolocation.getCurrentPosition(() => {}, () => {}); true");
  await expect(bar).toContainText(`localhost:${port} souhaite`);
  await expect(bar).not.toContainText("intégré");
});
