import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createServer as createHttpsServer, type Server } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron, type ElectronApplication, type Page } from "@playwright/test";
import type { BrowserApi } from "@shared/ipc";
import type { BrowserState, SpaceId, SpaceInput, TabId } from "@shared/types";
import { chromeOf, expect, openPrivateWindow, overlayOf, test } from "./fixtures";

/**
 * Documentation screenshots (docs/screenshots/<screen>-<theme>.png), only with SCREENSHOTS=1:
 *
 *   SCREENSHOTS=1 SCREENSHOT_THEME=dark  xvfb-run -a -s "-screen 0 1600x1000x24" npx playwright test screenshots
 *   SCREENSHOTS=1 SCREENSHOT_THEME=light xvfb-run -a -s "-screen 0 1600x1000x24" npx playwright test screenshots
 *
 * Needs root (the fake web listens on port 443), ImageMagick and openssl. Every host resolves to
 * a local HTTPS server serving made-up sites with their own favicons (`--host-resolver-rules`), so
 * the address bar shows real-looking addresses and nothing touches the network. The window is
 * 1440×900; the X screen is captured (`capturePage()` would miss the native page views).
 */
test.skip(!process.env.SCREENSHOTS, "set SCREENSHOTS=1 to refresh docs/screenshots");
test.describe.configure({ mode: "serial" });
test.setTimeout(300_000);

const theme = process.env.SCREENSHOT_THEME === "light" ? "light" : "dark";
const OUT = "docs/screenshots";
const WIDTH = 1440;
const HEIGHT = 900;
const TEST_FILTERS = fileURLToPath(new URL("./filters.txt", import.meta.url));

/** The chrome UI's preload API (functions below run in the chrome page, where it is a global). */
declare const browser: BrowserApi;
const api = <T, A = undefined>(page: Page, fn: (arg: A) => T | Promise<T>, arg?: A): Promise<T> => page.evaluate(fn as never, arg) as Promise<T>;
const state = (chrome: Page) => api<BrowserState>(chrome, () => browser.getState());
const run = (chrome: Page, id: string) => api(chrome, (command: string) => browser.commands.run(command as never), id);
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// --- Made-up web ------------------------------------------------------------------------------

interface Site {
  name: string;
  color: string;
  letter: string;
}

const SITES: Record<string, Site> = {
  "lejournal.fr": { name: "Le Journal du Web", color: "#e8536b", letter: "J" },
  "atelier.dev": { name: "Atelier", color: "#5b6cff", letter: "A" },
  "forge.dev": { name: "Forge", color: "#2b2f36", letter: "F" },
  "agenda.app": { name: "Agenda", color: "#2f9e7f", letter: "A" },
  "courrier.app": { name: "Courrier", color: "#3b82f6", letter: "C" },
  "recettes.fr": { name: "Carnet de recettes", color: "#f08c00", letter: "R" },
  "trajets.fr": { name: "Trajets", color: "#7b5cf0", letter: "T" },
  "ondes.fm": { name: "Ondes", color: "#12b886", letter: "O" },
  "studio.design": { name: "Studio", color: "#d6336c", letter: "S" },
  "carto.app": { name: "Carto", color: "#0c8599", letter: "C" },
  "cours.edu": { name: "Cours en ligne", color: "#e67700", letter: "C" },
  "tableau.app": { name: "Tableau", color: "#1c7ed6", letter: "T" },
};

/** Page titles by URL (host + path); other paths get a generic page of their site. */
const PAGES: Record<string, string> = {
  "lejournal.fr/navigateurs": "Les navigateurs rapides changent nos habitudes",
  "lejournal.fr/vie-privee": "Vie privée : ce que voient vraiment les sites",
  "atelier.dev/guide": "Guide de démarrage — Atelier",
  "forge.dev/browser/pulls": "Pull requests · browser",
  "agenda.app/semaine": "Semaine 45 — Agenda",
  "courrier.app/boite": "Boîte de réception (3) — Courrier",
  "recettes.fr/courge-rotie": "Courge rôtie au miel et au thym",
  "recettes.fr/tarte-tatin": "Tarte Tatin de grand-mère",
  "trajets.fr/lisbonne": "Paris → Lisbonne · 14 nov.",
  "trajets.fr/porto": "Porto, que voir en 3 jours",
  "ondes.fm/radio": "Ondes — Radio du matin",
  "studio.design/maquettes": "Maquettes — Refonte du site",
  "carto.app/lisbonne": "Lisbonne — Carto",
  "cours.edu/algebre": "Algèbre linéaire — Chapitre 4",
  "cours.edu/histoire": "Histoire de l'art moderne",
  "tableau.app/q4": "Objectifs du T4 — Tableau",
  "forge.dev/browser/revue": "Revue : barre universelle · browser",
};

const url = (key: string) => `https://${key}`;
const titleOf = (key: string) => PAGES[key];

const paragraph = (text: string) => `<p>${text}</p>`;
const ARTICLE_TEXT = [
  "Un bon navigateur s'efface derrière les pages. Onglets verticaux, espaces séparés et barre universelle : en quelques années, la façon de naviguer a changé plus vite que les sites eux-mêmes.",
  "Les espaces regroupent les onglets d'un même contexte. Le travail d'un côté, les voyages de l'autre, et chaque espace peut garder ses propres cookies. On passe de l'un à l'autre d'un geste à deux doigts.",
  "La barre universelle, elle, cherche partout à la fois : onglets ouverts, historique, favoris, commandes et même de petits calculs, sans jamais quitter le clavier.",
  "Côté vie privée, le blocage des traqueurs et des cookies tiers devient la norme. Les fenêtres privées n'écrivent plus rien sur le disque, et la synchronisation chiffre tout avant de l'envoyer.",
  "Reste l'essentiel : lire. Le mode lecture retire les menus et les publicités pour ne garder que le texte, les liens et les images, dans une mise en page reposante.",
  "Pour les curieux, l'aperçu des liens ouvre une page dans une carte au-dessus de l'article, sans perdre sa place. Un clic la transforme en onglet si elle mérite qu'on s'y attarde.",
];

function pageHtml(host: string, path: string): string {
  const site = SITES[host];
  const title = titleOf(`${host}${path}`) ?? `${site.name}`;
  const isArticle = host === "lejournal.fr" || host === "recettes.fr" || host === "trajets.fr";
  const style = `
  * { box-sizing: border-box; }
  body { margin: 0; font: 17px/1.65 Georgia, "DejaVu Serif", serif; color: #1f2328; background: #fbfaf7; }
  header { display: flex; align-items: center; gap: 14px; padding: 18px 48px; border-bottom: 1px solid #e7e3da; background: #fff;
    font: 600 15px Inter, system-ui, sans-serif; }
  header .logo { width: 30px; height: 30px; border-radius: 8px; background: ${site.color}; color: #fff; display: grid; place-items: center; font-weight: 700; }
  header nav { margin-left: auto; display: flex; gap: 22px; color: #59636e; font-weight: 500; }
  header a { color: inherit; text-decoration: none; }
  main { max-width: 720px; margin: 44px auto; padding: 0 24px; }
  h1 { font-size: 40px; line-height: 1.15; margin: 0 0 16px; letter-spacing: -0.01em; }
  .lead { font-size: 20px; color: #59636e; }
  .meta { font: 14px Inter, system-ui, sans-serif; color: #8a8f98; margin-bottom: 22px; }
  .hero { height: 240px; margin: 28px 0; border-radius: 14px; background: linear-gradient(135deg, ${site.color}, #f6a04d 55%, #7b5cf0); }
  a { color: ${site.color}; }
  .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-top: 24px; font-family: Inter, system-ui, sans-serif; }
  .card { padding: 18px; border-radius: 12px; background: #fff; border: 1px solid #e7e3da; }
  .card b { display: block; margin-bottom: 6px; }
  .bar { height: 8px; border-radius: 4px; background: #eceae4; margin-top: 10px; overflow: hidden; }
  .bar i { display: block; height: 100%; background: ${site.color}; }
  .row { display: flex; gap: 14px; align-items: center; padding: 14px 0; border-bottom: 1px solid #ece9e2; font-family: Inter, system-ui, sans-serif; font-size: 15px; }
  .row .dot { width: 34px; height: 34px; border-radius: 50%; background: ${site.color}22; color: ${site.color}; display: grid; place-items: center; font-weight: 700; }
  .row small { color: #8a8f98; margin-left: auto; }`;
  const head = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${title}</title><link rel="icon" href="/favicon.png"><style>${style}</style></head><body>
<header><span class="logo">${site.letter}</span>${site.name}<nav><a href="/">Accueil</a><a href="/rubriques">Rubriques</a><a href="/a-propos">À propos</a></nav></header>`;
  let body: string;
  if (isArticle) {
    body = `<main><article><h1>${title}</h1><p class="byline meta">Par Camille Martin</p>
<p class="lead">Onglets verticaux, espaces et barre universelle : ce qui change vraiment au quotidien.</p><div class="hero"></div>
${ARTICLE_TEXT.slice(0, 2).map(paragraph).join("")}
<p>À lire aussi : <a id="peek-link" href="https://lejournal.fr/vie-privee">Vie privée : ce que voient vraiment les sites</a>, et notre <a href="https://atelier.dev/guide">guide de démarrage</a>.</p>
${ARTICLE_TEXT.slice(2).map(paragraph).join("")}</article></main>`;
  } else if (host === "courrier.app" || host === "forge.dev" || host === "agenda.app") {
    const rows = [
      ["Léa Bernard", "Réunion de lancement jeudi"],
      ["Équipe Forge", "3 nouvelles revues demandées"],
      ["Hugo Petit", "Photos du week-end"],
      ["Agence Trajets", "Votre billet pour Lisbonne"],
      ["Nora Lambert", "Re: maquettes de la page d'accueil"],
      ["Club de lecture", "Prochaine séance le 12"],
    ];
    body = `<main><h1>${title}</h1>${rows.map(([who, what]) => `<div class="row"><span class="dot">${who[0]}</span><span><b>${who}</b><br>${what}</span><small>10:4${who.length % 10}</small></div>`).join("")}</main>`;
  } else {
    const cards = [
      ["Prise en main", 72],
      ["Espaces", 45],
      ["Raccourcis", 88],
      ["Synchronisation", 30],
      ["Extensions", 60],
      ["Thèmes", 54],
    ] as const;
    body = `<main><h1>${title}</h1><p class="lead">${site.name} : tout ce qu'il faut pour avancer, au même endroit.</p>
<div class="grid">${cards.map(([name, value]) => `<div class="card"><b>${name}</b>${value} %<div class="bar"><i style="width:${value}%"></i></div></div>`).join("")}</div>
${ARTICLE_TEXT.slice(0, 2).map(paragraph).join("")}</main>`;
  }
  return `${head}${body}</body></html>`;
}

const LOGIN_HTML = (host: string) => `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Connexion — ${SITES[host].name}</title><link rel="icon" href="/favicon.png">
<style>body{margin:0;display:grid;place-items:center;height:100vh;font:15px Inter,system-ui,sans-serif;background:#f4f3ef}form{display:grid;gap:12px;width:320px;padding:28px;border-radius:14px;background:#fff;border:1px solid #e7e3da}input,button{height:40px;padding:0 12px;border-radius:8px;border:1px solid #d9d5cc;font:inherit}button{background:${SITES[host].color};color:#fff;border:0}</style></head>
<body><form method="post" action="/bienvenue"><h2>${SITES[host].name}</h2><input id="user" name="user" autocomplete="username"><input id="pass" name="pass" type="password"><button id="submit">Se connecter</button></form></body></html>`;

const FORECAST = {
  current: { temperature_2m: 14.2, weather_code: 2, is_day: 1 },
  daily: {
    time: ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06"],
    temperature_2m_min: [8, 9, 7, 6, 8],
    temperature_2m_max: [15, 16, 13, 12, 14],
    weather_code: [2, 3, 61, 1, 0],
  },
};

/** A favicon: the site's letter on its color, as a PNG (raster only, ADR-018). */
function favicon(site: Site): Buffer {
  return execFileSync("convert", [
    "-size",
    "64x64",
    "xc:none",
    "-fill",
    site.color,
    "-draw",
    "roundrectangle 0,0 63,63 14,14",
    "-fill",
    "white",
    "-font",
    "DejaVu-Sans-Bold",
    "-pointsize",
    "38",
    "-gravity",
    "center",
    "-annotate",
    "+0+1",
    site.letter,
    "png:-",
  ]);
}

const icons = new Map<string, Buffer>();
const iconData = (host: string) => `data:image/png;base64,${icons.get(host)!.toString("base64")}`;

let web: Server;
let certDir: string;

function handle(req: IncomingMessage, res: ServerResponse): void {
  const host = (req.headers.host ?? "").replace(/:\d+$/, "").replace(/^(www|comptes)\./, "");
  const path = new URL(req.url ?? "/", "https://x").pathname;
  if (host === "api.open-meteo.com") {
    res.setHeader("content-type", "application/json");
    return void res.end(JSON.stringify(FORECAST));
  }
  if (host === "geocoding-api.open-meteo.com") {
    res.setHeader("content-type", "application/json");
    return void res.end(JSON.stringify({ results: [{ name: "Lyon", admin1: "Auvergne-Rhône-Alpes", country: "France", latitude: 45.75, longitude: 4.85 }] }));
  }
  const site = SITES[host];
  if (!site) {
    res.statusCode = 404;
    return void res.end();
  }
  if (path === "/favicon.png" || path === "/favicon.ico") {
    res.setHeader("content-type", "image/png");
    return void res.end(icons.get(host));
  }
  res.setHeader("content-type", "text/html; charset=utf-8");
  if (path === "/connexion") return void res.end(LOGIN_HTML(host));
  if (path === "/bienvenue") return void res.end(`<!doctype html><title>Bienvenue — ${site.name}</title><link rel="icon" href="/favicon.png"><h1>Bienvenue</h1>`);
  if (path.startsWith("/fichiers/")) {
    const name = path.slice("/fichiers/".length);
    res.setHeader("content-type", "application/octet-stream");
    res.setHeader("content-disposition", `attachment; filename="${name}"`);
    return void res.end(Buffer.alloc(name.endsWith(".zip") ? 4_200_000 : name.endsWith(".pdf") ? 860_000 : 2_400_000, 7));
  }
  if (path === "/telechargements") {
    return void res.end(
      `<!doctype html><title>Téléchargements — ${site.name}</title><link rel="icon" href="/favicon.png">` +
        ["rapport-annuel-2026.pdf", "photos-lisbonne.zip", "presentation-t4.key"].map((name, i) => `<a id="f${i}" href="/fichiers/${name}">${name}</a>`).join(" "),
    );
  }
  res.end(pageHtml(host, path));
}

test.beforeAll(async () => {
  for (const [host, site] of Object.entries(SITES)) icons.set(host, favicon(site));
  certDir = mkdtempSync(join(tmpdir(), "browser-shots-cert-"));
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "2", "-subj", "/CN=localhost", "-keyout", join(certDir, "key.pem"), "-out", join(certDir, "cert.pem")], {
    stdio: "ignore",
  });
  web = createHttpsServer({ key: readFileSync(join(certDir, "key.pem")), cert: readFileSync(join(certDir, "cert.pem")) }, handle);
  await new Promise<void>((resolve) => web.listen(443, "127.0.0.1", resolve));
  // Plain http: answers only to say "use https" (nothing should land there).
  const redirect = createServer((req, res) => {
    res.statusCode = 301;
    res.setHeader("location", `https://${req.headers.host}${req.url}`);
    res.end();
  });
  redirect.listen(80, "127.0.0.1");
  web.on("close", () => redirect.close());
});

test.afterAll(() => {
  web?.close();
  if (certDir) rmSync(certDir, { recursive: true, force: true });
});

// --- Profile and app --------------------------------------------------------------------------

const MINUTE = 60_000;

/** Settings, history, archive and boosts written before the first launch. */
function seedProfile(profile: string, downloads: string, extra: Record<string, unknown> = {}): void {
  const write = (name: string, data: unknown, version = 1) => writeFileSync(join(profile, name), JSON.stringify({ version, data }));
  const now = Date.now();
  write("settings.json", {
    appearance: { mode: theme },
    layout: { sidebarWidth: 300 },
    downloads: { folder: downloads, askWhere: false },
    startPage: {
      greetingName: "Camille",
      widgets: [
        { id: "clock", kind: "clock", size: "l", options: { greeting: true, date: true } },
        { id: "search", kind: "search", size: "l", options: {} },
        { id: "weather", kind: "weather", size: "s", options: { place: { name: "Lyon", region: "Auvergne-Rhône-Alpes, France", latitude: 45.75, longitude: 4.85 }, unit: "c" } },
        { id: "calendar", kind: "calendar", size: "s", options: { weekNumbers: false } },
        {
          id: "todo",
          kind: "todo",
          size: "m",
          options: {
            hideDone: false,
            items: [
              { id: "t1", text: "Réserver l'hôtel à Lisbonne", done: false },
              { id: "t2", text: "Relire la présentation du T4", done: false },
              { id: "t3", text: "Acheter du thym et une courge", done: true },
            ],
          },
        },
        { id: "notes", kind: "notes", size: "m", options: { text: "Idées d'article :\n— les espaces au quotidien\n— la barre universelle\n— lire sans distraction" } },
        { id: "favorites", kind: "favorites", size: "m", options: { count: 8 } },
        { id: "top-sites", kind: "top-sites", size: "l", options: { count: 8, pins: [] } },
      ],
    },
    ...extra,
  });
  const visited = ["lejournal.fr", "courrier.app", "forge.dev", "agenda.app", "atelier.dev", "recettes.fr", "ondes.fm", "trajets.fr", "studio.design", "carto.app"];
  write(
    "history.json",
    visited.flatMap((host, index) => {
      const key = Object.keys(PAGES).find((page) => page.startsWith(`${host}/`))!;
      return [
        { url: url(`${host}/`), title: SITES[host].name, favicon: iconData(host), visitCount: 40 - index * 3, lastVisit: now - index * 7 * MINUTE },
        { url: url(key), title: PAGES[key], favicon: iconData(host), visitCount: 6, lastVisit: now - (index + 2) * 11 * MINUTE },
      ];
    }),
  );
  write(
    "archive.json",
    [
      ["recettes.fr/tarte-tatin", 2],
      ["cours.edu/histoire", 5],
      ["trajets.fr/porto", 26],
      ["studio.design/maquettes", 50],
      ["ondes.fm/radio", 75],
      ["carto.app/lisbonne", 100],
    ].map(([key, hours], i) => ({
      id: `archived-${i}`,
      url: url(key as string),
      title: PAGES[key as string],
      favicon: iconData((key as string).split("/")[0]),
      spaceId: null,
      archivedAt: now - (hours as number) * 60 * MINUTE,
    })),
  );
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
  write("boosts.json", [
    boost("journal", "Lecture confortable", "lejournal.fr", { font: "serif", filters: { invert: false, grayscale: 0, sepia: 20, brightness: 100, contrast: 105 } }),
    boost("forge", "Forge plus compacte", "forge.dev", { css: "main { max-width: 1100px; }\n.row { padding: 8px 0; }" }),
    boost("recettes", "Sans bandeaux", "*.recettes.fr", { zaps: [".newsletter", "#cookie-banner", "aside.promo"] }),
    boost("studio", "Mode nuit", "studio.design", { enabled: false, filters: { invert: true, grayscale: 0, sepia: 0, brightness: 90, contrast: 100 } }),
  ]);
}

/** Launches the app on `profile` with every host mapped to the fake web. */
async function launchApp(profile: string, env: Record<string, string> = {}): Promise<{ app: ElectronApplication; chrome: Page }> {
  const app = await electron.launch({
    args: ["--no-sandbox", "--host-resolver-rules=MAP * 127.0.0.1, EXCLUDE localhost", "--ignore-certificate-errors", "--no-proxy-server", "."],
    env: { ...process.env, BROWSER_PROFILE_DIR: profile, BROWSER_TEST_FILTERS: TEST_FILTERS, ...env },
  });
  const chrome = await chromeOf(app);
  await resize(app);
  return { app, chrome };
}

async function resize(app: ElectronApplication): Promise<void> {
  await app.evaluate(
    ({ BrowserWindow }, [width, height]) => {
      for (const window of BrowserWindow.getAllWindows()) window.setContentBounds({ x: 0, y: 0, width, height });
    },
    [WIDTH, HEIGHT] as const,
  );
  await pause(500);
}

/** Captures the window's area of the X screen (pages included) into docs/screenshots/<name>-<theme>.png. */
async function shoot(app: ElectronApplication, name: string, settle = 500): Promise<void> {
  await pause(settle);
  const bounds = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getContentBounds());
  mkdirSync(OUT, { recursive: true });
  execFileSync("import", [
    "-window",
    "root",
    "-crop",
    `${bounds.width}x${bounds.height}+${bounds.x}+${bounds.y}`,
    "+repage",
    "-strip",
    "-define",
    "png:compression-level=9",
    `${OUT}/${name}-${theme}.png`,
  ]);
  // Lossy palette compression when pngquant is installed (a third of the size, still sharp).
  try {
    execFileSync("pngquant", ["--quality", "80-95", "--speed", "1", "--strip", "--force", "--skip-if-larger", "--ext", ".png", `${OUT}/${name}-${theme}.png`]);
  } catch {
    // Not installed, or no gain: the plain PNG stays.
  }
}

async function waitTitle(chrome: Page, title: string): Promise<void> {
  await expect.poll(async () => (await state(chrome)).tabs.some((tab) => tab.title === title && !tab.isLoading), { timeout: 15_000 }).toBe(true).catch(async (error) => { console.log(JSON.stringify((await state(chrome)).tabs)); throw error; });
}

/** Opens `key` in a new tab of the current space; resolves to its id once loaded. */
async function openTab(chrome: Page, key: string): Promise<TabId> {
  await api(chrome, (target: string) => browser.tabs.create(target), url(key));
  await waitTitle(chrome, titleOf(key));
  return (await state(chrome)).tabs.find((tab) => tab.title === titleOf(key))!.id;
}

/** Spaces, pinned tabs, favorites, folders: the window everything else is shot on. */
async function buildScene(chrome: Page): Promise<void> {
  const first = await state(chrome);
  await api(chrome, (id: SpaceId) => browser.spaces.update(id, { name: "Personnel", icon: "circle-user", color: "#e8536b" }), first.spaces[0].id);
  for (const input of <SpaceInput[]>[
    { name: "Travail", icon: "briefcase", color: "#4fc3a1" },
    { name: "Études", icon: "graduation-cap", color: "#5aa9ff" },
    { name: "Voyages", icon: "plane", color: "#ffb454" },
  ]) {
    await api(chrome, (value: SpaceInput) => browser.spaces.create(value), input);
  }
  await api(chrome, (id: SpaceId) => browser.spaces.switchTo(id), first.spaces[0].id);
  await expect(chrome.locator(".space-name")).toHaveText("Personnel");
  const initial = first.tabs[0]?.id;

  // Favorites: added from tabs, which are then closed (the tiles stay).
  for (const key of ["courrier.app/boite", "agenda.app/semaine", "ondes.fm/radio", "forge.dev/browser/pulls"]) {
    const id = await openTab(chrome, key);
    await api(chrome, (tab: TabId) => browser.favorites.add(tab), id);
    if (key !== "courrier.app/boite") await api(chrome, (tab: TabId) => browser.tabs.close(tab), id);
  }
  const pinned = await openTab(chrome, "studio.design/maquettes");
  await api(chrome, (tab: TabId) => browser.tabs.togglePin(tab), pinned);

  const reading = [await openTab(chrome, "recettes.fr/courge-rotie"), await openTab(chrome, "lejournal.fr/vie-privee")];
  await api(chrome, (tabs: TabId[]) => browser.folders.create({ name: "À lire", icon: "book-open" } as never, null, tabs), reading);
  const trip = [await openTab(chrome, "trajets.fr/lisbonne"), await openTab(chrome, "carto.app/lisbonne")];
  await api(chrome, (tabs: TabId[]) => browser.folders.create({ name: "Week-end à Lisbonne", icon: "plane" } as never, null, tabs), trip);
  await openTab(chrome, "atelier.dev/guide");
  await openTab(chrome, "forge.dev/browser/revue");
  if (initial !== undefined) await api(chrome, (tab: TabId) => browser.tabs.close(tab), initial);
  await openTab(chrome, "lejournal.fr/navigateurs");
  await expect(chrome.locator(".tab.active .title")).toHaveText(titleOf("lejournal.fr/navigateurs"));
  // Away from every hover effect.
  await chrome.mouse.move(WIDTH - 20, HEIGHT - 20);
}

/** Closes whatever the overlay shows. */
async function closeOverlay(app: ElectronApplication): Promise<void> {
  const overlay = await overlayOf(app);
  await overlay.keyboard.press("Escape").catch(() => {});
  await pause(300);
}

const tabRow = (chrome: Page, title: string) => chrome.locator(".tabs [role=tab]", { hasText: title });

// --- Shots ------------------------------------------------------------------------------------

test("tour of the main window", async ({ profile }) => {
  const downloads = mkdtempSync(join(tmpdir(), "browser-shots-dl-"));
  seedProfile(profile, downloads);
  const { app, chrome } = await launchApp(profile);
  try {
    await buildScene(chrome);
    await shoot(app, "sidebar", 1200);

    // Multi-tab selection (Ctrl+click).
    await tabRow(chrome, titleOf("atelier.dev/guide")).click({ modifiers: ["Control"] });
    await tabRow(chrome, titleOf("forge.dev/browser/revue")).click({ modifiers: ["Control"] });
    await expect(chrome.getByTestId("tab-selection")).toBeVisible();
    await chrome.mouse.move(WIDTH - 20, HEIGHT - 20);
    await shoot(app, "tab-selection");
    await chrome.getByTestId("tab-selection").getByRole("button", { name: "Annuler la sélection" }).click();

    const overlay = await overlayOf(app);
    // App menu, a submenu open.
    await chrome.getByTestId("app-menu-button").click();
    const menu = overlay.getByRole("menu", { name: "Menu de l'application" });
    await expect(menu).toBeVisible();
    await menu.getByRole("menuitem", { name: "Plus d'outils" }).hover();
    await expect(overlay.getByRole("menu", { name: "Plus d'outils" })).toBeVisible();
    await shoot(app, "app-menu");
    await closeOverlay(app);
    await closeOverlay(app);

    // Universal bar: results in sections, then an instant answer.
    await run(chrome, "command-palette");
    const input = overlay.getByRole("combobox", { name: "Barre universelle" });
    await expect(input).toBeFocused();
    await input.pressSequentially("lisbonne");
    await shoot(app, "omnibox", 900);
    await input.fill("");
    await input.pressSequentially("2*(3+4)");
    await shoot(app, "omnibox-answer", 900);
    await closeOverlay(app);

    // Page options popover.
    await chrome.locator(".address").hover();
    await chrome.getByRole("button", { name: "Options de la page" }).click();
    await expect(overlay.getByRole("dialog", { name: "Options de la page" })).toBeVisible();
    await shoot(app, "page-options");
    await closeOverlay(app);

    // Site info.
    await run(chrome, "site-info");
    await pause(600);
    await shoot(app, "site-info");
    await closeOverlay(app);

    // Screenshot preview.
    await chrome.mouse.move(WIDTH - 20, HEIGHT - 20);
    await run(chrome, "screenshot-visible");
    await expect(overlay.getByRole("dialog", { name: "Capture d'écran" })).toBeVisible();
    await shoot(app, "capture", 800);
    await overlay.getByRole("dialog", { name: "Capture d'écran" }).getByRole("button", { name: /Fermer|Ignorer|Supprimer/ }).first().click().catch(() => closeOverlay(app));
    await closeOverlay(app);

    // Link peek, from the page's context menu.
    await app.evaluate(({ Menu }) => {
      Menu.prototype.popup = function (this: Electron.Menu) {
        setTimeout(() => this.getMenuItemById("link-peek")?.click(), 0);
      };
    });
    await app.evaluate(async ({ webContents }, prefix) => {
      const page = webContents.getAllWebContents().find((contents) => contents.getURL().startsWith(prefix))!;
      const point: { x: number; y: number } = await page.executeJavaScript(
        `(() => { const a = document.getElementById("peek-link"); a.scrollIntoView({ block: "center" }); const r = a.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`,
      );
      const x = Math.round(point.x);
      const y = Math.round(point.y);
      page.sendInputEvent({ type: "mouseMove", x, y });
      page.sendInputEvent({ type: "mouseDown", x, y, button: "right", clickCount: 1 });
      page.sendInputEvent({ type: "mouseUp", x, y, button: "right", clickCount: 1 });
    }, url("lejournal.fr/navigateurs"));
    await expect(overlay.getByRole("dialog", { name: "Aperçu du lien" })).toBeVisible();
    await shoot(app, "peek", 1500);
    await app.evaluate(({ webContents }, target) => {
      webContents.getAllWebContents().find((contents) => contents.getURL() === target)?.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
    }, url("lejournal.fr/vie-privee"));
    await pause(500);
    await app.evaluate(async ({ webContents }, prefix) => {
      await webContents.getAllWebContents().find((contents) => contents.getURL().startsWith(prefix))!.executeJavaScript("scrollTo(0, 0)");
    }, url("lejournal.fr/navigateurs"));

    // Reader view.
    await chrome.getByRole("button", { name: "Mode lecture", exact: true }).click();
    await expect(chrome.getByTestId("reader-view")).toBeVisible();
    await chrome.mouse.move(WIDTH - 20, HEIGHT - 20);
    await shoot(app, "reader", 800);
    await run(chrome, "toggle-reader");
    await expect(chrome.getByTestId("reader-view")).toHaveCount(0);

    // Split view: the article next to the docs.
    const docs = (await state(chrome)).tabs.find((tab) => tab.title === titleOf("atelier.dev/guide"))!.id;
    await api(chrome, (id: TabId) => browser.split.open(id), docs);
    await api(chrome, () => browser.split.setRatios(0.55, 0.5));
    await expect(chrome.locator(".split .pane")).toHaveCount(2);
    await chrome.mouse.move(WIDTH - 20, HEIGHT - 20);
    await shoot(app, "split", 1000);
    await api(chrome, () => browser.split.exit());

    // Compact mode: a rail of icons.
    await api(chrome, () => browser.settings.update({ layout: { compactMode: true } }));
    await chrome.mouse.move(WIDTH - 20, HEIGHT - 20);
    await expect(chrome.getByTestId("compact-rail")).toBeVisible();
    await shoot(app, "compact", 900);
    await api(chrome, () => browser.settings.update({ layout: { compactMode: false } }));
  } finally {
    await app.close();
    rmSync(downloads, { recursive: true, force: true });
  }
});

test("internal pages", async ({ profile }) => {
  const downloads = mkdtempSync(join(tmpdir(), "browser-shots-dl-"));
  seedProfile(profile, downloads);
  const { app, chrome } = await launchApp(profile, { BROWSER_TEST_PLAIN_KEYCHAIN: "1" });
  const extensions = mkdtempSync(join(tmpdir(), "browser-shots-ext-"));
  try {
    await buildScene(chrome);
    const overlay = await overlayOf(app);

    // Saved passwords: three logins, each saved from its prompt.
    for (const [host, user] of [
      ["courrier.app", "camille.martin"],
      ["forge.dev", "camille-m"],
      ["trajets.fr", "camille.martin@courrier.app"],
    ]) {
      const login = `https://comptes.${host}/connexion`;
      await api(chrome, (target: string) => browser.tabs.create(target), login);
      await waitTitle(chrome, `Connexion — ${SITES[host].name}`);
      await app.evaluate(
        async ({ webContents }, [prefix, name]) => {
          const page = webContents.getAllWebContents().find((contents) => contents.getURL().startsWith(prefix))!;
          await page.executeJavaScript(`document.getElementById("user").value = ${JSON.stringify(name)}; document.getElementById("pass").value = "correct-horse-battery";`);
          const r: { x: number; y: number } = await page.executeJavaScript(`(() => { const r = document.getElementById("submit").getBoundingClientRect(); return { x: r.x + 10, y: r.y + 10 }; })()`);
          page.sendInputEvent({ type: "mouseMove", x: Math.round(r.x), y: Math.round(r.y) });
          page.sendInputEvent({ type: "mouseDown", x: Math.round(r.x), y: Math.round(r.y), button: "left", clickCount: 1 });
          page.sendInputEvent({ type: "mouseUp", x: Math.round(r.x), y: Math.round(r.y), button: "left", clickCount: 1 });
        },
        [login, user] as const,
      );
      const prompt = overlay.getByRole("dialog", { name: "Enregistrer le mot de passe" });
      await expect(prompt).toBeVisible();
      await prompt.getByRole("button", { name: "Enregistrer", exact: true }).click();
      await expect(prompt).toBeHidden();
      await run(chrome, "close-tab");
    }

    // Extensions: three unpacked ones, loaded from their folder.
    const made = [
      ["surligneur", "Surligneur", "1.4.0", "Surligne les passages importants et les retrouve plus tard.", "#f59f00"],
      ["traducteur", "Traduction instantanée", "2.1.3", "Traduit une sélection sans quitter la page.", "#1c7ed6"],
      ["minuteur", "Minuteur Pomodoro", "0.9.2", "Des séances de travail de 25 minutes, avec des pauses.", "#e8536b"],
    ];
    for (const [dir, name, version, description, color] of made) {
      const folder = join(extensions, dir);
      mkdirSync(folder);
      writeFileSync(join(folder, "manifest.json"), JSON.stringify({ manifest_version: 3, name, version, description, icons: { "128": "icon.png" } }));
      writeFileSync(join(folder, "icon.png"), favicon({ name, color, letter: name[0] }));
    }
    await run(chrome, "open-extensions");
    const extensionsPage = chrome.getByTestId("extensions-page");
    for (const [dir] of made) {
      await app.evaluate(({ dialog }, folder) => {
        dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [folder] })) as unknown as typeof dialog.showOpenDialog;
      }, join(extensions, dir));
      await extensionsPage.getByRole("button", { name: "Charger un dossier" }).click();
      await pause(700);
    }
    await expect(extensionsPage.locator("[data-extension-id]")).toHaveCount(3);
    await extensionsPage.getByRole("button", { name: "Fermer le message" }).click();
    await chrome.mouse.move(WIDTH - 20, HEIGHT - 20);
    await shoot(app, "extensions", 2500);
    await run(chrome, "close-tab");

    await run(chrome, "open-passwords");
    await expect(chrome.getByTestId("passwords-page").getByRole("list", { name: "Mots de passe enregistrés" }).getByRole("listitem")).toHaveCount(3);
    await shoot(app, "passwords");
    await run(chrome, "close-tab");

    await run(chrome, "open-boosts");
    await expect(chrome.getByTestId("boosts-page")).toBeVisible();
    await shoot(app, "boosts");
    await run(chrome, "close-tab");

    await run(chrome, "open-archive");
    await expect(chrome.getByTestId("archive-page").locator(".row")).toHaveCount(6);
    await shoot(app, "archive");
    await run(chrome, "close-tab");

    // Downloads: three files from a page, then browser://downloads.
    await api(chrome, (target: string) => browser.tabs.create(target), url("atelier.dev/telechargements"));
    await waitTitle(chrome, "Téléchargements — Atelier");
    for (const id of ["f0", "f1", "f2"]) {
      await app.evaluate(async ({ webContents }, script) => {
        const page = webContents.getAllWebContents().find((contents) => contents.getURL().startsWith("https://atelier.dev/telechargements"))!;
        await page.executeJavaScript(script, true);
      }, `document.getElementById("${id}").click()`);
      await pause(600);
    }
    await expect.poll(async () => (await api<{ state: string }[]>(chrome, () => browser.downloads.list())).filter((entry) => entry.state === "completed").length, { timeout: 20_000 }).toBe(3);
    await run(chrome, "close-tab");
    await api(chrome, () => browser.downloads.openPage());
    await pause(800);
    await chrome.mouse.move(WIDTH - 20, HEIGHT - 20);
    await shoot(app, "downloads");
    await run(chrome, "close-tab");

    // Settings: appearance with the theme gallery, a search, the shortcuts.
    await run(chrome, "open-settings");
    const gallery = chrome.getByRole("group", { name: "Galerie de thèmes" });
    await expect(gallery).toBeVisible();
    await chrome.mouse.move(WIDTH - 20, HEIGHT - 20);
    await shoot(app, "settings", 700);

    await chrome.locator("#shortcuts").evaluate((element) => element.scrollIntoView({ block: "start" }));
    await shoot(app, "settings-shortcuts", 700);

    const search = chrome.getByLabel("Rechercher un réglage");
    await search.fill("onglet");
    await pause(400);
    await search.evaluate((element) => element.closest("main, .page, body")?.scrollTo?.(0, 0));
    await shoot(app, "settings-search", 700);
  } finally {
    await app.close();
    rmSync(downloads, { recursive: true, force: true });
    rmSync(extensions, { recursive: true, force: true });
  }
});

test("new tab page", async ({ profile }) => {
  const downloads = mkdtempSync(join(tmpdir(), "browser-shots-dl-"));
  seedProfile(profile, downloads);
  const { app, chrome } = await launchApp(profile);
  try {
    await buildScene(chrome);
    await api(chrome, () => browser.tabs.create());
    await expect(chrome.locator(".start .site").first()).toBeVisible();
    await expect(chrome.locator("[data-widget-id=weather]")).toContainText("°");
    await chrome.locator(".start input").first().blur();
    await chrome.mouse.move(WIDTH - 20, HEIGHT - 20);
    await shoot(app, "start", 900);

    await chrome.getByRole("button", { name: "Personnaliser" }).click();
    await chrome.getByRole("button", { name: "Ajouter un widget" }).click();
    await expect(chrome.getByRole("dialog", { name: "Ajouter un widget" })).toBeVisible();
    await chrome.mouse.move(WIDTH - 20, HEIGHT - 20);
    await shoot(app, "start-edit", 700);
  } finally {
    await app.close();
    rmSync(downloads, { recursive: true, force: true });
  }
});

test("private window", async ({ profile }) => {
  const downloads = mkdtempSync(join(tmpdir(), "browser-shots-dl-"));
  seedProfile(profile, downloads);
  const { app, chrome } = await launchApp(profile);
  try {
    const priv = await openPrivateWindow(app, chrome);
    // Only the private window stays on screen (shoot() captures the first window).
    await api(chrome, () => browser.window.close());
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
    await priv.waitForSelector(".private-badge");
    await resize(app);
    for (const key of ["trajets.fr/lisbonne", "recettes.fr/tarte-tatin"]) await openTab(priv, key);
    await api(priv, () => browser.tabs.create());
    await expect(priv.getByRole("heading", { name: "Navigation privée" })).toBeVisible();
    await priv.locator(".start input").first().blur();
    await priv.mouse.move(WIDTH - 20, HEIGHT - 20);
    await shoot(app, "private", 800);
  } finally {
    await app.close();
    rmSync(downloads, { recursive: true, force: true });
  }
});
