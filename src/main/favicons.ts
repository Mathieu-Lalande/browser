import type { Session, WebContents } from "electron";
import { MAX_FAVICON_BYTES, faviconImageType, isFaviconDataUrl } from "@shared/favicon";
import { faviconRequestUrl } from "./privacy";

/**
 * Favicons (ADR-018, audit HIGH-1). The chrome UI used to load the URL a page declared with an
 * `<img>` from the default session: a private window or an isolated space leaked a request, cookies
 * and a disk cache entry to the normal profile, outside shields, HTTPS-Only and GPC. Main now
 * fetches it with the tab's own session, checks it (raster image type, size, time) and hands the UI
 * a `data:` URL; the UI's CSP refuses any other image source.
 */

const FETCH_TIMEOUT_MS = 5000;
/** Candidates tried per page (pages may list many sizes). */
const MAX_CANDIDATES = 3;
/** Per-session cache of fetched icons (null: the URL gave nothing usable), most recent last. */
const CACHE_SIZE = 200;

const caches = new WeakMap<Session, Map<string, string | null>>();

function cacheOf(ses: Session): Map<string, string | null> {
  let cache = caches.get(ses);
  if (!cache) caches.set(ses, (cache = new Map()));
  return cache;
}

function remember(cache: Map<string, string | null>, url: string, icon: string | null): void {
  cache.delete(url);
  cache.set(url, icon);
  if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!);
}

/** Forgets a session's icons (a private window closed). */
export function forgetFavicons(ses: Session): void {
  caches.delete(ses);
}

/**
 * GETs an image through `ses` (the tab's session: its cookies, cache, proxy) as a `data:` URL, or
 * null: raster types only, at most `maxBytes`. Also used for reader mode images (ADR-026).
 */
export async function fetchImageDataUrl(ses: Session, url: string, maxBytes = MAX_FAVICON_BYTES, timeoutMs = FETCH_TIMEOUT_MS): Promise<string | null> {
  const response = await ses.fetch(url, {
    credentials: "include",
    // Main's own requests are invisible to the tab's webRequest pipeline: send GPC here (ADR-008).
    headers: { "Sec-GPC": "1" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const type = faviconImageType(response.headers.get("content-type"));
  const announced = Number(response.headers.get("content-length") ?? 0);
  if (!response.ok || !type || announced > maxBytes || !response.body) {
    await response.body?.cancel().catch(() => {});
    return null;
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = response.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  if (size === 0) return null;
  return `data:${type};base64,${Buffer.concat(chunks).toString("base64")}`;
}

/**
 * The favicon of the page `pageUrl` shown in `contents`, from the candidates the page declared
 * (`page-favicon-updated`): a small raster `data:` URL, or null.
 */
export async function loadFavicon(contents: WebContents, candidates: readonly string[], pageUrl: string): Promise<string | null> {
  const cache = cacheOf(contents.session);
  for (const candidate of candidates.slice(0, MAX_CANDIDATES)) {
    if (candidate.startsWith("data:")) {
      if (isFaviconDataUrl(candidate)) return candidate;
      continue;
    }
    const url = faviconRequestUrl(contents, candidate, pageUrl);
    if (!url) continue;
    let icon = cache.get(url);
    if (icon === undefined) {
      icon = await fetchImageDataUrl(contents.session, url).catch(() => null);
      remember(cache, url, icon);
    }
    if (icon) return icon;
  }
  return null;
}
