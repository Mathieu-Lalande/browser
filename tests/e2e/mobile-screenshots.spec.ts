import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";

/**
 * Screenshots of the mobile app (docs/screenshots/mobile-<screen>-<theme>.png), only with SCREENSHOTS=1:
 *
 *   SCREENSHOTS=1 SCREENSHOT_THEME=dark  xvfb-run -a npx playwright test mobile-screenshots
 *
 * The app's web build (`expo export --platform web`, built here unless MOBILE_WEB_DIR points to
 * one) runs in a 390×844 window; pages are the web stand-in `WebTab.web.tsx` (no WebView on the
 * web), so reader mode and link peek, which need a real page, are not shot.
 */
test.skip(!process.env.SCREENSHOTS, "set SCREENSHOTS=1 to refresh docs/screenshots");
test.setTimeout(300_000);

const theme = process.env.SCREENSHOT_THEME === "light" ? "light" : "dark";
const OUT = "docs/screenshots";
const SHELL = fileURLToPath(new URL("./mobile-shell.cjs", import.meta.url));
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let server: Server;
let origin: string;
let built: string | null = null;

test.beforeAll(async () => {
  let root = process.env.MOBILE_WEB_DIR;
  if (!root) {
    built = mkdtempSync(join(tmpdir(), "browser-mobile-web-"));
    execFileSync("npx", ["expo", "export", "--platform", "web", "--output-dir", built], { cwd: "mobile", stdio: "ignore" });
    root = built;
  }
  const types: Record<string, string> = { ".js": "text/javascript", ".html": "text/html", ".json": "application/json", ".ttf": "font/ttf", ".png": "image/png", ".ico": "image/x-icon" };
  server = createServer((req, res) => {
    let path = join(root, decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname));
    if (!path.startsWith(root) || !existsSync(path) || statSync(path).isDirectory()) path = join(root, "index.html");
    res.setHeader("content-type", types[extname(path)] ?? "application/octet-stream");
    res.end(readFileSync(path));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  origin = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
});

test.afterAll(() => {
  server?.close();
  if (built) rmSync(built, { recursive: true, force: true });
});

/** What the app finds in its storage (AsyncStorage is localStorage on the web). */
function seed(): Record<string, unknown> {
  const now = Date.now();
  const sites = [
    ["https://lejournal.fr/", "Le Journal du Web"],
    ["https://courrier.app/", "Courrier"],
    ["https://forge.dev/", "Forge"],
    ["https://agenda.app/", "Agenda"],
    ["https://atelier.dev/", "Atelier"],
    ["https://recettes.fr/", "Carnet de recettes"],
    ["https://ondes.fm/", "Ondes"],
    ["https://trajets.fr/", "Trajets"],
  ];
  const boost = (id: string, name: string, match: string, patch: Record<string, unknown>) => ({
    id,
    name,
    match,
    enabled: true,
    css: "",
    zaps: [],
    font: null,
    filters: { invert: false, grayscale: 0, sepia: 0, brightness: 100, contrast: 100 },
    script: { enabled: false, code: "", allowPrivate: false },
    updatedAt: now,
    ...patch,
  });
  return {
    "browser.settings": {
      appearance: { mode: theme },
      startPage: {
        greetingName: "Camille",
        widgets: [
          { id: "clock", kind: "clock", size: "l", options: { greeting: true, date: true } },
          { id: "search", kind: "search", size: "l", options: {} },
          {
            id: "todo",
            kind: "todo",
            size: "m",
            options: {
              hideDone: false,
              items: [
                { id: "t1", text: "Réserver l'hôtel à Lisbonne", done: false },
                { id: "t2", text: "Relire la présentation du T4", done: false },
                { id: "t3", text: "Acheter du thym", done: true },
              ],
            },
          },
          { id: "top-sites", kind: "top-sites", size: "l", options: { count: 8, pins: [] } },
          { id: "notes", kind: "notes", size: "m", options: { text: "Idées d'article : les espaces, la barre universelle." } },
        ],
      },
    },
    "browser.history": sites.map(([url, title], index) => ({ url, title, favicon: null, visitCount: 30 - index * 3, lastVisit: now - index * 600_000 })),
    "browser.boosts": [
      boost("journal", "Lecture confortable", "lejournal.fr", { font: "serif", filters: { invert: false, grayscale: 0, sepia: 20, brightness: 100, contrast: 105 } }),
      boost("forge", "Forge plus compacte", "forge.dev", { css: "main { max-width: 1100px; }" }),
      boost("recettes", "Sans bandeaux", "*.recettes.fr", { zaps: [".newsletter", "#cookie-banner"] }),
    ],
  };
}

async function launchPhone(): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({ args: ["--no-sandbox", SHELL], env: { ...process.env, MOBILE_URL: origin, MOBILE_THEME: theme } });
  const page = await app.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  await page.evaluate((documents) => {
    localStorage.clear();
    for (const [key, data] of Object.entries(documents)) localStorage.setItem(key, JSON.stringify({ version: 1, data }));
  }, seed());
  await page.reload();
  await expect(page.getByText("Camille", { exact: false }).first()).toBeVisible();
  return { app, page };
}

async function shoot(page: Page, name: string, settle = 600): Promise<void> {
  await pause(settle);
  mkdirSync(OUT, { recursive: true });
  const path = `${OUT}/mobile-${name}-${theme}.png`;
  await page.screenshot({ path });
  try {
    execFileSync("pngquant", ["--quality", "80-95", "--speed", "1", "--strip", "--force", "--skip-if-larger", "--ext", ".png", path]);
  } catch {
    // Not installed, or no gain.
  }
}

/** Opens `address` from the bottom bar's search sheet. */
async function visit(page: Page, address: string): Promise<void> {
  const input = page.getByLabel("Adresse ou recherche");
  // A new tab opens with the search sheet already up.
  if (!(await input.isVisible())) await page.getByTestId("address-pill").click();
  await expect(input).toBeVisible();
  await input.fill(address);
  await input.press("Enter");
  await expect(input).toBeHidden();
  await pause(300);
}

test("mobile screens", async () => {
  const { app, page } = await launchPhone();
  try {
    await shoot(page, "start", 1200);

    // The universal bar sheet, results for a query.
    await page.getByTestId("address-pill").click();
    const input = page.getByLabel("Adresse ou recherche");
    await input.pressSequentially("jour");
    await shoot(page, "search", 900);
    await input.fill("forge.dev/browser");
    await input.press("Enter");
    await expect(input).toBeHidden();

    for (const address of ["recettes.fr/courge-rotie", "trajets.fr/lisbonne", "lejournal.fr/navigateurs"]) {
      // Each in a new tab, from the tabs overview.
      await page.getByRole("button", { name: /^Onglets \(/ }).click();
      await page.getByLabel("Nouvel onglet", { exact: true }).click();
      await pause(400);
      await visit(page, address);
    }
    await shoot(page, "page", 900);

    // Page menu.
    await page.getByRole("button", { name: "Plus d'actions" }).click();
    await shoot(page, "menu", 900);
    await page.keyboard.press("Escape");
    await page.mouse.click(195, 80);
    await pause(500);

    // Tabs overview.
    await page.getByRole("button", { name: /^Onglets \(/ }).click();
    await shoot(page, "tabs", 900);
  } finally {
    await app.close();
  }
});

test("mobile settings", async () => {
  const { app, page } = await launchPhone();
  try {
    await page.getByRole("button", { name: "Plus d'actions" }).click();
    await page.getByText("Paramètres", { exact: true }).last().click();
    await expect(page.getByText("Apparence", { exact: true }).first()).toBeVisible();
    await shoot(page, "settings", 900);
    await page.getByText("Thèmes", { exact: true }).first().evaluate((element) => element.scrollIntoView({ block: "start" }));
    await shoot(page, "themes", 700);
    await page.getByText("Boosts", { exact: true }).first().evaluate((element) => element.scrollIntoView({ block: "start" }));
    await shoot(page, "boosts", 700);
  } finally {
    await app.close();
  }
});
