/**
 * Favicon rules (audit HIGH-1, ADR-018). The browser UI never loads a page's favicon from the
 * network itself: main fetches it through the tab's own session and hands the UI a `data:` URL.
 * Pure: no Electron, no Node, no DOM (shared with the mobile app).
 */

/** Largest favicon image main accepts (bytes, before base64). */
export const MAX_FAVICON_BYTES = 64 * 1024;
/** Longest `data:` favicon a tab state carries (a 64 KB image in base64, plus the header). */
export const MAX_FAVICON_DATA_URL_LENGTH = Math.ceil(MAX_FAVICON_BYTES / 3) * 4 + 64;
/** Longest favicon written to the profile (history, bookmarks, session), so they do not bloat. */
export const MAX_STORED_FAVICON_LENGTH = 16 * 1024;

/**
 * Raster image types only: SVG is a document format (scripts, external references) and gains
 * nothing for a 16 px icon.
 */
const RASTER_TYPES = new Set([
  "image/png",
  "image/gif",
  "image/jpeg",
  "image/webp",
  "image/avif",
  "image/bmp",
  "image/x-icon",
  "image/vnd.microsoft.icon",
]);

const DATA_URL = /^data:(image\/[a-z.+-]+);base64,[A-Za-z0-9+/]+={0,2}$/i;

/** A base64 `data:` URL of a raster image, at most `maxLength` characters. */
export function isFaviconDataUrl(value: string, maxLength = MAX_FAVICON_DATA_URL_LENGTH): boolean {
  if (value.length > maxLength) return false;
  const match = DATA_URL.exec(value);
  return !!match && RASTER_TYPES.has(match[1].toLowerCase());
}

/** The raster image type of a `Content-Type` header, lowercase without parameters, or null. */
export function faviconImageType(contentType: string | null | undefined): string | null {
  const type = (contentType ?? "").split(";", 1)[0].trim().toLowerCase();
  return RASTER_TYPES.has(type) ? type : null;
}

/** What may be written to the profile: a small `data:` favicon, never a URL to fetch later. */
export function storableFavicon(value: unknown): string | null {
  return typeof value === "string" && isFaviconDataUrl(value, MAX_STORED_FAVICON_LENGTH) ? value : null;
}
