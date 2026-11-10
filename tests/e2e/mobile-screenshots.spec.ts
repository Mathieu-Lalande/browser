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
 *
 * Store sizes (mobile/store/README.md): STORE_DEVICE=<key of STORE_DEVICES> writes
 * mobile/store/screenshots/<device>/<screen>-<theme>.png at that device's exact pixel size;
 * `cd mobile && npm run store:screenshots` runs every device.
 */
test.skip(!process.env.SCREENSHOTS, "set SCREENSHOTS=1 to refresh docs/screenshots");
test.setTimeout(300_000);

/** Logical size × pixel ratio = the size App Store Connect / Play Console expect. */
const STORE_DEVICES = {
  "iphone-6.9": { width: 440, height: 956, scale: 3 }, // 1320×2868
  "iphone-6.5": { width: 428, height: 926, scale: 3 }, // 1284×2778
  "ipad-13": { width: 1032, height: 1376, scale: 2 }, // 2064×2752
  "android-phone": { width: 432, height: 768, scale: 2.5 }, // 1080×1920
} as const;

const theme = process.env.SCREENSHOT_THEME === "light" ? "light" : "dark";
const storeDevice = process.env.STORE_DEVICE as keyof typeof STORE_DEVICES | undefined;
if (storeDevice && !(storeDevice in STORE_DEVICES)) throw new Error(`unknown STORE_DEVICE ${storeDevice}`);
const device = storeDevice ? STORE_DEVICES[storeDevice] : { width: 390, height: 844, scale: 1 };
const OUT = storeDevice ? `mobile/store/screenshots/${storeDevice}` : "docs/screenshots";
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
      // French UI whatever the shell's language (ADR-052): the labels below are French.
      appearance: { mode: theme, language: "fr" },
      assistant: { enabled: true },
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
    "browser.reading-list": [
      ["https://lejournal.fr/navigateurs", "Les navigateurs rapides changent nos habitudes", "Le Journal du Web", 0],
      ["https://recettes.fr/courge-rotie", "Courge rôtie au miel et au thym", "Carnet de recettes", 1],
      ["https://trajets.fr/porto", "Porto, que voir en 3 jours", "Trajets", 2],
    ].map(([url, title, siteName, index]) => ({
      url,
      title,
      siteName,
      excerpt: "",
      text: "Un bon navigateur s'efface derrière les pages. Onglets verticaux, espaces séparés et barre universelle : la façon de naviguer a changé.\n\nLes espaces regroupent les onglets d'un même contexte, chacun avec ses cookies.",
      addedAt: now - (index as number) * 3_600_000,
      readAt: index === 2 ? now - 600_000 : null,
    })),
    "browser.history": sites.map(([url, title], index) => ({ url, title, favicon: null, visitCount: 30 - index * 3, lastVisit: now - index * 600_000 })),
    "browser.boosts": [
      boost("journal", "Lecture confortable", "lejournal.fr", { font: "serif", filters: { invert: false, grayscale: 0, sepia: 20, brightness: 100, contrast: 105 } }),
      boost("forge", "Forge plus compacte", "forge.dev", { css: "main { max-width: 1100px; }" }),
      boost("recettes", "Sans bandeaux", "*.recettes.fr", { zaps: [".newsletter", "#cookie-banner"] }),
    ],
  };
}

async function launchPhone(): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    args: ["--no-sandbox", `--force-device-scale-factor=${device.scale}`, SHELL],
    env: { ...process.env, MOBILE_URL: origin, MOBILE_THEME: theme, MOBILE_WIDTH: String(device.width), MOBILE_HEIGHT: String(device.height) },
  });
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
  const path = storeDevice ? `${OUT}/${name}-${theme}.png` : `${OUT}/mobile-${name}-${theme}.png`;
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
    await page.mouse.click(device.width / 2, 80);
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

/** A row of the page menu (the action sheet), by its label. */
async function menuItem(page: Page, label: string): Promise<void> {
  await page.getByRole("button", { name: "Plus d'actions" }).click();
  await pause(400);
  await page.getByText(label, { exact: true }).last().click();
  await pause(500);
}

test("mobile reading list, notes, shields, assistant", async () => {
  const { app, page } = await launchPhone();
  try {
    await visit(page, "lejournal.fr/navigateurs");

    // Site info: the per-site shield (blocker, cookie banners).
    await menuItem(page, "Infos sur le site");
    await shoot(page, "shields", 900);
    await page.keyboard.press("Escape");
    await page.mouse.click(device.width / 2, 80);
    await pause(400);

    // A note on the page.
    await menuItem(page, "Note de la page");
    const note = page.getByRole("textbox").last();
    await note.fill("À relire avant la réunion : la partie sur les espaces et la barre universelle.");
    await shoot(page, "note", 900);
    await page.getByText("OK", { exact: true }).last().click();
    await pause(400);

    // The AI assistant sheet (no key here: it says where to add one).
    await menuItem(page, "Assistant IA");
    await shoot(page, "assistant", 900);
    await page.getByRole("button", { name: "Fermer l'assistant" }).click().catch(() => page.keyboard.press("Escape"));
    await pause(400);

    // Reading list.
    await menuItem(page, "Liste de lecture");
    await expect(page.getByText("Courge rôtie au miel et au thym").first()).toBeVisible();
    await shoot(page, "reading-list", 900);
  } finally {
    await app.close();
  }
});
