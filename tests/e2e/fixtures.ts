import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test as base, expect, _electron as electron, type ElectronApplication, type Page } from "@playwright/test";

export type { ElectronApplication };

type Fixtures = {
  /** Fresh profile directory, removed after the test. */
  profile: string;
  app: ElectronApplication;
  chrome: Page;
  server: { url: (path: string) => string };
};

/** Tiny filter list replacing the downloaded ones (BROWSER_TEST_FILTERS), so the blocker stays offline. */
const TEST_FILTERS = fileURLToPath(new URL("./filters.txt", import.meta.url));

/** Tiny local site so tests never touch the network. */
function startServer(): Promise<{ server: Server; origin: string }> {
  const server = createServer((req, res) => {
    const path = req.url ?? "/";
    res.setHeader("content-type", "text/html; charset=utf-8");
    if (path.startsWith("/ads/")) {
      // Matches the test filter list: only reachable when shields are off.
      res.setHeader("content-type", path.endsWith(".js") ? "text/javascript" : "image/svg+xml");
      res.end(path.endsWith(".js") ? "window.adLoaded = true;" : `<svg xmlns="http://www.w3.org/2000/svg"/>`);
    } else if (path.startsWith("/shields")) {
      res.end(
        `<title>Shields</title><img src="/ads/banner.svg"><script src="/ads/banner.js"></script>` +
          `<div class="ad-box">ad</div><div class="site-ad">ad</div><p id="content">content</p>`,
      );
    } else if (path.startsWith("/permission")) {
      res.end(`<title>Permission</title><p>asks for permissions</p>`);
    } else if (path.startsWith("/popup")) {
      res.end(`<title>Opener</title><a id="open" href="/second" target="_blank">open</a>`);
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
    // `*.test` hosts resolve to the local server, to exercise HTTPS-Only on a "public" hostname.
    args: ["--no-sandbox", "--host-resolver-rules=MAP *.test 127.0.0.1", "."],
    env: { ...process.env, BROWSER_PROFILE_DIR: profile, BROWSER_TEST_FILTERS: TEST_FILTERS },
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

/** Run a script in the tab page whose URL starts with `urlPrefix` (with a user gesture). */
export async function evalInTab<T>(app: ElectronApplication, urlPrefix: string, script: string): Promise<T> {
  return app.evaluate(
    ({ webContents }, [prefix, code]) => {
      const page = webContents.getAllWebContents().find((contents) => contents.getURL().startsWith(prefix));
      if (!page) throw new Error(`no tab at ${prefix}`);
      return page.executeJavaScript(code, true);
    },
    [urlPrefix, script] as const,
  ) as Promise<T>;
}
