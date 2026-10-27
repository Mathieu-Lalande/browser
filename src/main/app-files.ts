import { extname, isAbsolute, join, relative, sep } from "node:path";

/**
 * Pure rules of the `app://` scheme that serves the browser's own UI (ADR-018). No Electron here,
 * so they are unit-tested; `./app-protocol.ts` wires them to `protocol.handle`.
 */

export const APP_SCHEME = "app";
/** The only host: `app://browser/index.html` (chrome UI) and `app://browser/overlay.html`. */
export const APP_HOST = "browser";
export const CHROME_PAGE = `${APP_SCHEME}://${APP_HOST}/index.html`;
export const OVERLAY_PAGE = `${APP_SCHEME}://${APP_HOST}/overlay.html`;

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".map": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
};

/** Content-Type of a served file; unknown types are refused rather than sniffed. */
export function mimeTypeOf(path: string): string | null {
  return MIME_TYPES[extname(path).toLowerCase()] ?? null;
}

/**
 * The file under `root` an `app://` URL names, or null: wrong scheme or host, encoded separators or
 * NUL bytes, or a path that leaves `root` once resolved (`..`, absolute, another drive).
 */
export function resolveAppFile(root: string, url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== `${APP_SCHEME}:` || parsed.host !== APP_HOST) return null;
  // Encoded slashes, backslashes and dots are never part of a bundle path: refuse rather than decode.
  if (/%2f|%5c|%2e|%00/i.test(parsed.pathname) || parsed.pathname.includes("\\")) return null;
  let path: string;
  try {
    path = decodeURIComponent(parsed.pathname);
  } catch {
    return null;
  }
  if (path.includes("\0")) return null;
  const file = join(root, path === "/" ? "index.html" : path);
  const inside = relative(root, file);
  if (!inside || inside.startsWith(`..${sep}`) || inside === ".." || isAbsolute(inside)) return null;
  return file;
}
