#!/usr/bin/env node
/**
 * Builds the content blocker's rules (ADR-051) from EasyList, EasyPrivacy and Peter Lowe's list,
 * fetched from the mirror the desktop engine downloads them from (`adsAndTrackingLists` of
 * @ghostery/adblocker), with the pure converter of `src/shared/blocklist/`:
 *
 * - modules/content-blocker/ios/Blocklists/webkit-<n>.json   WebKit content blocker lists (iOS)
 * - modules/content-blocker/android/src/main/assets/blocklists/network.json   request filter (Android)
 * - src/generated/cosmetic.json   element hiding, injected by the app on both platforms (Expo Go too)
 * - src/generated/cookie-banner-agent.json   source text of `cookieBannerAgent` (ADR-046), which
 *   the app injects: Hermes keeps no source for `Function.prototype.toString`
 * - modules/content-blocker/blocklists.json   what was built, from what, when
 *
 * Generated, never committed. Runs from `postinstall` (`--if-missing`: nothing to do when the
 * outputs exist) and from the config plugin at prebuild. Offline, or with a list that does not
 * download, the build falls back to `scripts/blocklists-seed.txt` (a few hundred well-known hosts)
 * and says so: an install never fails because of the network.
 *
 *   node scripts/build-blocklists.mjs [--if-missing] [--offline] [--from <dir of .txt lists>]
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const MOBILE = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SHARED = resolve(MOBILE, "../src/shared");
const MODULE = join(MOBILE, "modules/content-blocker");
const OUT = {
  ios: join(MODULE, "ios/Blocklists"),
  android: join(MODULE, "android/src/main/assets/blocklists"),
  cosmetic: join(MOBILE, "src/generated"),
  manifest: join(MODULE, "blocklists.json"),
};
const MIRROR = "https://raw.githubusercontent.com/ghostery/adblocker/master/packages/adblocker/assets";
/** In priority order: rules over the caps are dropped from the end. */
const LISTS = [`${MIRROR}/easylist/easylist.txt`, `${MIRROR}/easylist/easyprivacy.txt`, `${MIRROR}/peter-lowe/serverlist.txt`];
const SEED = join(MOBILE, "scripts/blocklists-seed.txt");

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => {
  const at = args.indexOf(name);
  return at === -1 ? null : args[at + 1];
};

const AGENT_OUT = join(OUT.cosmetic, "cookie-banner-agent.json");
const outputsExist = () =>
  [OUT.manifest, join(OUT.android, "network.json"), join(OUT.cosmetic, "cosmetic.json"), join(OUT.ios, "webkit-0.json"), AGENT_OUT].every((file) => existsSync(file));

/**
 * Compiles files of a `src/shared` folder (relative imports only) to a temporary ES module
 * directory and imports `entry` (typescript is a dev dependency). ES2018 output: what the cookie
 * banner agent promises to stay within.
 */
async function loadShared(folder, files, entry) {
  const require = createRequire(join(MOBILE, "package.json"));
  const ts = require("typescript");
  const dir = mkdtempSync(join(tmpdir(), "blocklist-"));
  writeFileSync(join(dir, "package.json"), '{"type":"module"}');
  for (const file of files ?? readdirSync(join(SHARED, folder))) {
    if (!file.endsWith(".ts") || file.endsWith(".test.ts")) continue;
    const source = readFileSync(join(SHARED, folder, file), "utf8");
    const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2018 } });
    writeFileSync(join(dir, file.replace(/\.ts$/, ".js")), outputText.replace(/from "(\.\/[^"]+)"/g, 'from "$1.js"'));
  }
  try {
    return await import(pathToFileURL(join(dir, entry)).href);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The cookie banner agent's source (ADR-046): Hermes keeps no source text for `Function.prototype.toString`. */
async function writeAgentSource() {
  const { cookieBannerAgent } = await loadShared("cookie-banners", ["agent.ts"], "agent.js");
  mkdirSync(OUT.cosmetic, { recursive: true });
  writeFileSync(AGENT_OUT, JSON.stringify({ source: String(cookieBannerAgent) }));
}

async function download(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.text();
}

async function readLists() {
  const from = option("--from");
  if (from) {
    const files = readdirSync(from).filter((file) => file.endsWith(".txt")).sort();
    return { source: files.map((file) => join(from, file)), texts: files.map((file) => readFileSync(join(from, file), "utf8")) };
  }
  if (!flag("--offline")) {
    try {
      return { source: LISTS, texts: await Promise.all(LISTS.map(download)) };
    } catch (error) {
      console.warn(`[blocklists] download failed (${error.message}); using the seed list (reduced blocking).`);
    }
  }
  return { source: ["scripts/blocklists-seed.txt"], texts: [readFileSync(SEED, "utf8")] };
}

async function main() {
  if (flag("--if-missing") && outputsExist()) return;
  await writeAgentSource();
  const { buildBlocklists } = await loadShared("blocklist", null, "index.js");
  const { source, texts } = await readLists();
  const build = buildBlocklists(texts);

  for (const dir of Object.values(OUT).slice(0, 3)) mkdirSync(dir, { recursive: true });
  for (const file of readdirSync(OUT.ios)) if (/^webkit-\d+\.json$/.test(file)) rmSync(join(OUT.ios, file));
  const hash = createHash("sha256");
  build.webkit.forEach((list, index) => {
    const text = JSON.stringify(list);
    hash.update(text);
    writeFileSync(join(OUT.ios, `webkit-${index}.json`), text);
  });
  writeFileSync(join(OUT.android, "network.json"), JSON.stringify(build.android));
  writeFileSync(join(OUT.cosmetic, "cosmetic.json"), JSON.stringify(build.cosmetic));
  const manifest = {
    version: 1,
    builtAt: new Date().toISOString(),
    source,
    seed: source[0] === "scripts/blocklists-seed.txt",
    // Changes when the iOS rules change: part of the compiled lists' identifiers.
    webkitHash: hash.digest("hex").slice(0, 16),
    webkitLists: build.webkit.length,
    stats: build.stats,
    cosmetic: { generic: build.cosmetic.generic.length, sites: Object.keys(build.cosmetic.hosts).length },
  };
  writeFileSync(OUT.manifest, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(
    `[blocklists] ${build.stats.webkit} iOS rules in ${build.webkit.length} list(s), ${build.android.block.length} Android entries, ${manifest.cosmetic.generic} generic + ${manifest.cosmetic.sites} sites cosmetic${manifest.seed ? " (seed list)" : ""}.`,
  );
}

main().catch((error) => {
  // Never break an install: the app still bundles, with an empty cosmetic index and no native lists.
  console.warn(`[blocklists] ${error.stack ?? error}`);
  try {
    mkdirSync(OUT.cosmetic, { recursive: true });
    const cosmetic = join(OUT.cosmetic, "cosmetic.json");
    if (!existsSync(cosmetic)) writeFileSync(cosmetic, JSON.stringify({ version: 1, generic: [], hosts: {}, exceptions: {} }));
    if (!existsSync(AGENT_OUT)) writeFileSync(AGENT_OUT, JSON.stringify({ source: "" }));
  } catch {
    // Nothing more to do.
  }
  process.exitCode = flag("--strict") ? 1 : 0;
});
