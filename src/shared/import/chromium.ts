import { t } from "../i18n";
import { SEARCH_ENGINES } from "../url";
import { cleanText, isImportableUrl, MAX_FOLDER_DEPTH, MAX_IMPORTED_BOOKMARKS, type ImportedBookmark } from "./types";

/**
 * Chromium family files (Chrome, Edge, Brave, Vivaldi, Opera): `Bookmarks` (JSON), `Local State`
 * (profile names), `Preferences` (default search engine). `History` is SQLite, read by main.
 */

/** Microseconds between 1601-01-01 (Windows epoch, used by Chromium) and 1970-01-01. */
const WINDOWS_EPOCH_OFFSET_US = 11_644_473_600_000_000;

/** Chromium timestamps (µs since 1601, as number, bigint or decimal string) → epoch ms; 0 when absent. */
export function chromiumTime(value: unknown): number {
  // Current dates are past Number.MAX_SAFE_INTEGER in µs: integers are converted exactly.
  if (typeof value === "bigint" || (typeof value === "string" && /^\d{1,20}$/.test(value))) {
    const micros = BigInt(value);
    return micros > BigInt(WINDOWS_EPOCH_OFFSET_US) ? Number((micros - BigInt(WINDOWS_EPOCH_OFFSET_US)) / 1000n) : 0;
  }
  const micros = typeof value === "number" ? value : NaN;
  if (!Number.isFinite(micros) || micros <= WINDOWS_EPOCH_OFFSET_US) return 0;
  return Math.floor((micros - WINDOWS_EPOCH_OFFSET_US) / 1000);
}

/** French names of the bookmark roots, as the user sees them in their browser. */
const ROOT_NAMES: Record<string, string> = {
  get bookmark_bar() { return t("importChromium.bookmarksBar") },
  get other() { return t("importChromium.otherBookmarks") },
  get synced() { return t("importChromium.mobileBookmarks") },
};

type Node = { type?: unknown; name?: unknown; url?: unknown; children?: unknown; date_added?: unknown };
const isNode = (value: unknown): value is Node => typeof value === "object" && value !== null && !Array.isArray(value);

/** Every web bookmark of a Chromium `Bookmarks` file, depth first, with its folder path. */
export function parseChromiumBookmarks(data: unknown): ImportedBookmark[] {
  const roots = isNode(data) ? (data as { roots?: unknown }).roots : undefined;
  if (!isNode(roots)) return [];
  const found: ImportedBookmark[] = [];
  const walk = (node: Node, path: string[], depth: number) => {
    if (found.length >= MAX_IMPORTED_BOOKMARKS || depth > 64) return;
    if (node.type === "url") {
      if (isImportableUrl(node.url)) found.push({ url: node.url, title: cleanText(node.name), folder: path.slice(0, MAX_FOLDER_DEPTH), addedAt: chromiumTime(node.date_added) });
      return;
    }
    if (!Array.isArray(node.children)) return;
    for (const child of node.children) {
      if (!isNode(child)) continue;
      const name = cleanText(child.name);
      walk(child, child.type === "folder" && name ? [...path, name] : path, depth + 1);
    }
  };
  for (const [key, root] of Object.entries(roots)) {
    if (!isNode(root)) continue;
    walk(root, [ROOT_NAMES[key] ?? (cleanText(root.name) || key)], 0);
  }
  return found;
}

/** A profile folder name as Chromium writes them ("Default", "Profile 2"), never a path. */
export const isProfileFolderName = (name: string) => /^[\w .-]{1,100}$/.test(name) && !name.includes("..");

/** Profile folder → display name, from `Local State` (`profile.info_cache`). */
export function parseChromiumProfiles(data: unknown): Map<string, string> {
  const profiles = new Map<string, string>();
  const cache = isNode(data) ? (data as { profile?: { info_cache?: unknown } }).profile?.info_cache : undefined;
  if (!isNode(cache)) return profiles;
  for (const [dir, info] of Object.entries(cache)) {
    if (!isProfileFolderName(dir)) continue;
    const name = isNode(info) ? cleanText((info as { name?: unknown }).name) : "";
    profiles.set(dir, name || dir);
  }
  return profiles;
}

/**
 * The id of our search engine matching a profile's default one (`Preferences`), if any: by its
 * search URL's host (custom engines are not imported).
 */
export function chromiumSearchEngine(preferences: unknown): string | null {
  const data = isNode(preferences) ? (preferences as { default_search_provider_data?: { template_url_data?: { url?: unknown } } }) : null;
  const template = data?.default_search_provider_data?.template_url_data;
  return searchEngineForUrl(typeof template?.url === "string" ? template.url : "");
}

const siteOf = (url: string) => new URL(url).hostname.replace(/^www\./, "");

/** Our engine whose search page is on the same site as `url` (`{searchTerms}` templates included). */
export function searchEngineForUrl(url: string): string | null {
  let host: string;
  try {
    host = siteOf(url.replace(/\{[^}]*\}/g, "x"));
  } catch {
    return null;
  }
  return SEARCH_ENGINES.find((engine) => siteOf(engine.template.replace("%s", "x")) === host)?.id ?? null;
}
