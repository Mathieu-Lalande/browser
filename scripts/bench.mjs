#!/usr/bin/env node
// Reproducible benchmark of the desktop app (ADR-043): cold start, new tab, memory with 1/10/30
// tabs and after tab sleep, on local pages (no network). Writes JSON + Markdown to docs/perf/.
//
//   npm run bench                          dev build (runs `npm run build` first)
//   node scripts/bench.mjs --runs 5        more cold starts
//   node scripts/bench.mjs --executable release/linux-unpacked/browser --label "Mon portable"
//   node scripts/bench.mjs --no-write      print only
//   node scripts/bench.mjs --serve 8080    only serve the test pages (comparisons, bench-compare.md)
//
// On Linux without a display, run it under `xvfb-run -a`. As root (containers), Chromium needs
// `--no-sandbox`: added automatically.

import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { cpus, platform, release, tmpdir, totalmem } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "@playwright/test";
import { summarize, sumMetrics, toMarkdown } from "./bench-report.mjs";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const CHROME_URL = "app://browser/index.html";

function option(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index > 0 && process.argv[index + 1] && !process.argv[index + 1].startsWith("--") ? process.argv[index + 1] : fallback;
}
const flag = (name) => process.argv.includes(`--${name}`);

const RUNS = Number(option("runs", "3"));
const NEW_TAB_RUNS = Number(option("new-tab-runs", "8"));
const EXECUTABLE = option("executable", process.env.BROWSER_PACKAGED || "");
const LABEL = option("label", process.env.BENCH_LABEL || (process.env.CI ? "CI Linux (GitHub Actions)" : "machine locale"));
const OUT = resolve(ROOT, option("out", "docs/perf"));

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/** A plausible article page: text, styles, an inline image and a little script. */
function fixturePage(n) {
  const paragraph = (i) =>
    `<p>Paragraphe ${i} de la page ${n}. Un navigateur se mesure sur des pages ordinaires : du texte, quelques styles, ` +
    `une image, un peu de script. Celle-ci est servie en local pour que chaque essai voie exactement la même chose.</p>`;
  return (
    `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Page ${n}</title>` +
    `<style>body{font:16px/1.5 system-ui;max-width:720px;margin:40px auto;padding:0 16px}h1{color:#4338ca}.card{padding:12px;border-radius:12px;background:#eef2ff;margin:12px 0}</style></head>` +
    `<body><h1>Page de test ${n}</h1><svg width="320" height="80" viewBox="0 0 320 80"><rect width="320" height="80" rx="12" fill="#c7d2fe"/>` +
    `<circle cx="40" cy="40" r="24" fill="#6366f1"/></svg>` +
    Array.from({ length: 40 }, (_, i) => (i % 8 === 0 ? `<div class="card">${paragraph(i)}</div>` : paragraph(i))).join("") +
    `<script>document.title = document.title + " ✓"; let x = 0; for (let i = 0; i < 1e5; i++) x += i; window.__done = x;</script></body></html>`
  );
}

function startServer(port = 0) {
  const server = createServer((req, res) => {
    const n = Number(/\/page\/(\d+)/.exec(req.url ?? "")?.[1] ?? 0);
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.end(fixturePage(n));
  });
  return new Promise((done) => server.listen(port, "127.0.0.1", () => done({ server, origin: `http://127.0.0.1:${server.address().port}` })));
}

/** A profile that is not fresh (no welcome page, ADR-043). */
function makeProfile() {
  const dir = mkdtempSync(join(tmpdir(), "browser-bench-"));
  writeFileSync(join(dir, "settings.json"), JSON.stringify({ version: 1, data: {} }));
  return dir;
}

async function launch(profile) {
  const args = ["--disable-component-update", `--user-data-dir=${profile}`];
  if (process.getuid?.() === 0 || flag("no-sandbox")) args.unshift("--no-sandbox");
  const env = { ...process.env, BROWSER_PROFILE_DIR: profile, BROWSER_TEST_FILTERS: join(ROOT, "tests/e2e/filters.txt") };
  return EXECUTABLE ? electron.launch({ executablePath: resolve(EXECUTABLE), args, env }) : electron.launch({ args: [...args, ROOT], env, cwd: ROOT });
}

async function chromeOf(app) {
  for (let i = 0; i < 400; i++) {
    const page = app.windows().find((candidate) => candidate.url() === CHROME_URL);
    if (page) {
      await page.waitForSelector(".sidebar", { timeout: 30_000 });
      return page;
    }
    await sleep(25);
  }
  throw new Error("the chrome UI never showed");
}

/** One cold start: process start → first contentful paint of the chrome UI, and → sidebar ready. */
async function coldStart() {
  const profile = makeProfile();
  const app = await launch(profile);
  try {
    const chrome = await chromeOf(app);
    const ready = await chrome.evaluate(() => performance.timeOrigin + performance.now());
    const started = await app.evaluate(() => Date.now() - process.uptime() * 1000);
    let paint = null;
    for (let i = 0; i < 40 && paint === null; i++) {
      paint = await chrome.evaluate(() => {
        const entry = performance.getEntriesByName("first-contentful-paint")[0];
        return entry ? performance.timeOrigin + entry.startTime : null;
      });
      if (paint === null) await sleep(50);
    }
    return { firstPaint: paint === null ? null : paint - started, ready: ready - started };
  } finally {
    await app.close();
    rmSync(profile, { recursive: true, force: true });
  }
}

/** "Nouvel onglet" → the start page is drawn and the address field focused, measured in the UI. */
async function newTab(chrome) {
  return chrome.evaluate(
    () =>
      new Promise((done) => {
        const count = () => document.querySelectorAll(".tabs [role=tab]").length;
        const before = count();
        const start = performance.now();
        globalThis.browser.commands.run("new-tab");
        const check = () => {
          if (performance.now() - start > 5000) return done(Number.NaN);
          if (count() > before && document.querySelector(".start")) requestAnimationFrame(() => done(performance.now() - start));
          else requestAnimationFrame(check);
        };
        requestAnimationFrame(check);
      }),
  );
}

async function memory(app) {
  await sleep(1500);
  return sumMetrics(await app.evaluate(({ app: electronApp }) => electronApp.getAppMetrics()));
}

async function waitLoaded(chrome, expected) {
  for (let i = 0; i < 600; i++) {
    const state = await chrome.evaluate(() => globalThis.browser.getState());
    const web = state.tabs.filter((tab) => tab.url.startsWith("http"));
    if (web.length >= expected && web.every((tab) => !tab.isLoading)) return;
    await sleep(100);
  }
  throw new Error(`tabs did not load (${expected})`);
}

async function memoryRun(origin) {
  const profile = makeProfile();
  const app = await launch(profile);
  try {
    const chrome = await chromeOf(app);
    // "Nouvel onglet" reuses an empty start page: measure it from a web page, closing each new tab.
    await chrome.evaluate((url) => globalThis.browser.tabs.create(url), `${origin}/page/999`);
    await waitLoaded(chrome, 1);
    await chrome.evaluate(async () => {
      const state = await globalThis.browser.getState();
      for (const tab of state.tabs) if (!tab.url.startsWith("http")) globalThis.browser.tabs.close(tab.id);
    });
    await sleep(500);
    const newTabs = [];
    for (let i = 0; i < NEW_TAB_RUNS; i++) {
      newTabs.push(await newTab(chrome));
      await chrome.evaluate(async () => {
        const state = await globalThis.browser.getState();
        if (state.activeTabId) globalThis.browser.tabs.close(state.activeTabId);
      });
      await sleep(300);
    }
    // Back to one web tab (/page/999 counts as the first of the memory runs' pages).
    const open = async (from, to) => {
      for (let i = from; i < to; i++) await chrome.evaluate((url) => globalThis.browser.tabs.create(url), `${origin}/page/${i}`);
      await waitLoaded(chrome, to);
    };
    await open(1, 1);
    const one = await memory(app);
    await open(1, 10);
    const ten = await memory(app);
    await open(10, 30);
    const thirty = await memory(app);
    await chrome.evaluate(() => globalThis.browser.commands.run("sleep-other-tabs"));
    await sleep(1000);
    const asleep = await memory(app);
    const versions = await app.evaluate(({ app: electronApp }) => ({ app: electronApp.getVersion(), electron: process.versions.electron, packaged: electronApp.isPackaged }));
    return { newTabs, one, ten, thirty, asleep, versions };
  } finally {
    await app.close();
    rmSync(profile, { recursive: true, force: true });
  }
}

function git(command) {
  try {
    return execSync(`git ${command}`, { cwd: ROOT, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return "inconnu";
  }
}

async function main() {
  // `--serve 8080`: only serve the test pages, for measuring other browsers (scripts/bench-compare.md).
  if (option("serve")) {
    const { origin } = await startServer(Number(option("serve")));
    process.stdout.write(`Pages de test : ${origin}/page/0 … ${origin}/page/29 (Ctrl+C pour arrêter)\n`);
    return;
  }
  if (!EXECUTABLE && !flag("no-build")) execSync("npm run build", { cwd: ROOT, stdio: "inherit" });
  const { server, origin } = await startServer();
  try {
    const starts = [];
    for (let i = 0; i < RUNS; i++) {
      starts.push(await coldStart());
      process.stdout.write(`démarrage ${i + 1}/${RUNS} : ${Math.round(starts.at(-1).firstPaint ?? NaN)} ms\n`);
    }
    const run = await memoryRun(origin);
    const cpu = cpus()[0]?.model?.replace(/\s+/g, " ").trim() ?? "?";
    const result = {
      date: new Date().toISOString(),
      runs: RUNS,
      newTabRuns: NEW_TAB_RUNS,
      environment: {
        label: LABEL,
        os: `${platform()} ${release()}`,
        cpu,
        cores: cpus().length,
        memoryGb: Math.round(totalmem() / 1024 ** 3),
        display: process.env.DISPLAY ? (process.env.XVFB_RUN || /xvfb/i.test(process.env.XAUTHORITY ?? "") ? "Xvfb" : process.env.DISPLAY) : "aucun",
        build: run.versions.packaged ? "empaquetée" : "dev (out/, non empaquetée)",
        appVersion: run.versions.app,
        electron: run.versions.electron,
        node: process.version,
        commit: git("rev-parse --short HEAD"),
        notes: "Widevine désactivé (--disable-component-update), listes de blocage de test (dev), profil neuf à chaque démarrage.",
      },
      metrics: {
        coldStartFirstPaintMs: summarize(starts.map((start) => start.firstPaint ?? NaN)),
        coldStartReadyMs: summarize(starts.map((start) => start.ready)),
        newTabMs: summarize(run.newTabs, 1),
        memory1TabMb: summarize([run.one.memoryMb], 1),
        memory10TabsMb: summarize([run.ten.memoryMb], 1),
        memory30TabsMb: summarize([run.thirty.memoryMb], 1),
        memoryAfterSleepMb: summarize([run.asleep.memoryMb], 1),
      },
      processes: { tabs1: run.one.processes, tabs10: run.ten.processes, tabs30: run.thirty.processes, afterSleep: run.asleep.processes },
      raw: { starts, newTabs: run.newTabs },
    };
    const markdown = toMarkdown(result);
    process.stdout.write(`\n${markdown}\n`);
    if (!flag("no-write")) {
      mkdirSync(OUT, { recursive: true });
      writeFileSync(join(OUT, "latest.json"), `${JSON.stringify(result, null, 2)}\n`);
      writeFileSync(join(OUT, "latest.md"), markdown);
      process.stdout.write(`\nÉcrit : ${join(OUT, "latest.json")}, ${join(OUT, "latest.md")}\n`);
    }
  } finally {
    server.close();
  }
}

await main();
