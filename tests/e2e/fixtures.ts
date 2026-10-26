import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test as base, expect, _electron as electron, type ElectronApplication, type Page } from "@playwright/test";

type Fixtures = {
  /** Fresh profile directory, removed after the test. */
  profile: string;
  app: ElectronApplication;
  chrome: Page;
  server: { url: (path: string) => string };
};

/** Tiny local site so tests never touch the network. */
function startServer(): Promise<{ server: Server; origin: string }> {
  const server = createServer((req, res) => {
    const path = req.url ?? "/";
    res.setHeader("content-type", "text/html; charset=utf-8");
    if (path.startsWith("/popup")) {
      res.end(`<title>Opener</title><a id="open" href="/second" target="_blank">open</a>`);
    } else if (path.startsWith("/internal-link")) {
      res.end(`<title>Internal link</title><a id="link" href="browser://settings">link</a><a id="popup" href="browser://settings" target="_blank">popup</a>`);
    } else if (path.startsWith("/file-link")) {
      res.end(`<title>File link</title><a id="file" href="file:///etc/hostname">file</a>`);
    } else {
      const name = path.slice(1) || "home";
      res.end(`<title>Page ${name}</title><h1>${name}</h1><a id="next" href="/next">next</a>`);
    }
  });
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({ server, origin: `http://127.0.0.1:${port}` });
    }),
  );
}

/** Launches the app on `profile`; tests that restart the app call it directly. */
export function launch(profile: string): Promise<ElectronApplication> {
  return electron.launch({
    args: ["--no-sandbox", "."],
    env: { ...process.env, BROWSER_PROFILE_DIR: profile },
  });
}

const isChrome = (page: Page) => page.url().endsWith("/renderer/index.html");

/**
 * The chrome UI page of a launched app, once the sidebar is rendered. Not simply `firstWindow()`:
 * a restored tab's page is created right after the window and may be reported first.
 */
export async function chromeOf(app: ElectronApplication): Promise<Page> {
  await expect.poll(() => app.windows().some(isChrome)).toBe(true);
  const page = app.windows().find(isChrome)!;
  await page.waitForSelector(".sidebar");
  return page;
}

export const test = base.extend<Fixtures>({
  server: async ({}, use) => {
    const { server, origin } = await startServer();
    await use({ url: (path) => `${origin}${path}` });
    server.close();
  },
  profile: async ({}, use) => {
    const profile = mkdtempSync(join(tmpdir(), "browser-e2e-"));
    await use(profile);
    rmSync(profile, { recursive: true, force: true });
  },
  app: async ({ profile }, use) => {
    const app = await launch(profile);
    await use(app);
    await app.close();
  },
  chrome: async ({ app }, use) => {
    await use(await chromeOf(app));
  },
});

export { expect } from "@playwright/test";

/** URLs of every tab view, read from the main process (tab pages are not Playwright windows). */
export async function tabUrls(app: ElectronApplication): Promise<string[]> {
  return app.evaluate(({ BrowserWindow, webContents }) => {
    const chromeIds = new Set(BrowserWindow.getAllWindows().map((window) => window.webContents.id));
    return webContents
      .getAllWebContents()
      .filter((contents) => !chromeIds.has(contents.id) && !contents.getURL().startsWith("devtools:"))
      .map((contents) => contents.getURL());
  });
}
