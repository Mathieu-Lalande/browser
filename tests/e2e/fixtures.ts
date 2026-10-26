import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test as base, _electron as electron, type ElectronApplication, type Page } from "@playwright/test";

type Fixtures = {
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

export const test = base.extend<Fixtures>({
  server: async ({}, use) => {
    const { server, origin } = await startServer();
    await use({ url: (path) => `${origin}${path}` });
    server.close();
  },
  app: async ({}, use) => {
    const profile = mkdtempSync(join(tmpdir(), "browser-e2e-"));
    const app = await electron.launch({
      args: ["--no-sandbox", "."],
      env: { ...process.env, BROWSER_PROFILE_DIR: profile },
    });
    await use(app);
    await app.close();
    rmSync(profile, { recursive: true, force: true });
  },
  chrome: async ({ app }, use) => {
    const page = await app.firstWindow();
    await page.waitForSelector(".sidebar");
    await use(page);
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
