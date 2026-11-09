/**
 * Chrome Web Store (ADR-049), pure: recognizing an extension's store page, the update service's
 * URLs (download as a redirect to the CRX, version check as XML) and reading its answer.
 * Requests, signature checks and installation are main's (`src/main/extensions/webstore.ts`).
 */

import { isExtensionId } from "./extensions";

/** Google's extension update service (what Chrome itself asks). */
export const WEBSTORE_UPDATE_URL = "https://clients2.google.com/service/update2/crx";

/** Store pages: `chromewebstore.google.com/detail/<slug>/<id>` and the former `chrome.google.com/webstore/detail/…`. */
const STORE_PAGES: { origin: string; prefix: string }[] = [
  { origin: "https://chromewebstore.google.com", prefix: "/detail/" },
  { origin: "https://chrome.google.com", prefix: "/webstore/detail/" },
];

/**
 * The extension id of a Chrome Web Store detail page, or null. `testOrigin`: a local fake store
 * (dev-only test hook), whose pages are `<origin>/detail/<slug>/<id>`.
 */
export function webStoreIdFromUrl(url: string, testOrigin: string | null = null): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const pages = testOrigin ? [...STORE_PAGES, { origin: testOrigin, prefix: "/detail/" }] : STORE_PAGES;
  const page = pages.find((candidate) => candidate.origin === parsed.origin && parsed.pathname.startsWith(candidate.prefix));
  if (!page) return null;
  const parts = parsed.pathname.slice(page.prefix.length).split("/").filter(Boolean);
  // `<slug>/<id>` or `<id>` alone; nothing else after it (e.g. `/reviews` keeps the id before it).
  const id = parts.find((part) => isExtensionId(part));
  return id ?? null;
}

const formatX = (parts: string) => `x=${encodeURIComponent(parts)}`;

/** The CRX download: answered by a redirect to the package of the latest version. */
export function crxDownloadUrl(id: string, chromeMajor: number, endpoint: string = WEBSTORE_UPDATE_URL): string {
  return `${endpoint}?response=redirect&prodversion=${chromeMajor}&acceptformat=crx2,crx3&${formatX(`id=${id}&uc`)}`;
}

/** One version check for several extensions (`v`: the installed version), answered in XML. */
export function updateCheckUrl(entries: readonly { id: string; version: string }[], chromeMajor: number, endpoint: string = WEBSTORE_UPDATE_URL): string {
  const xs = entries.map((entry) => formatX(`id=${entry.id}&v=${entry.version}&uc`)).join("&");
  return `${endpoint}?prodversion=${chromeMajor}&acceptformat=crx2,crx3&${xs}`;
}

const attribute = (tag: string, name: string): string | null => {
  const match = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`).exec(tag);
  return match ? (match[2] ?? match[3] ?? null) : null;
};

/**
 * Latest version per extension id from the update service's XML (`<gupdate><app appid="…">
 * <updatecheck status="ok" version="…" codebase="…"/></app></gupdate>`). Apps without an
 * `ok` update check (`noupdate`, errors) are absent. The codebase is ignored: packages are always
 * downloaded through the fixed endpoint, then their signature is checked.
 */
export function parseUpdateCheck(xml: string): Map<string, string> {
  const versions = new Map<string, string>();
  for (const app of xml.matchAll(/<app\b([^>]*)>([\s\S]*?)<\/app>/g)) {
    const id = attribute(app[1], "appid");
    const check = /<updatecheck\b[^>]*>/.exec(app[2])?.[0];
    if (!id || !isExtensionId(id) || !check || attribute(check, "status") !== "ok") continue;
    const version = attribute(check, "version");
    if (version && /^\d+(\.\d+){0,3}$/.test(version)) versions.set(id, version);
  }
  return versions;
}

/** Chrome version order (`1.10` > `1.9`); missing parts count as 0. */
export function compareVersions(a: string, b: string): number {
  const left = a.split(".").map(Number);
  const right = b.split(".").map(Number);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff) return Math.sign(diff);
  }
  return 0;
}
