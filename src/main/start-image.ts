import { session } from "electron";
import { faviconImageType } from "@shared/favicon";

/**
 * The start page's background image (a https URL chosen in the settings), fetched by main and
 * handed to the chrome UI as a `data:` URL: the UI's CSP only allows `'self'` and `data:` images
 * (ADR-017). It goes through a dedicated in-memory session without cookies, so the image host
 * learns nothing of the user's profile and nothing reaches the disk cache. Private windows do not
 * show it at all (they keep their fixed private look, and make no request of their own).
 */

/** In-memory partition (no `persist:` prefix): no cookies sent, nothing written to disk. */
export const ASSETS_PARTITION = "browser-assets";
const MAX_BYTES = 8 * 1024 * 1024;
const TIMEOUT_MS = 15_000;

let cached: { url: string; image: Promise<string | null> } | null = null;

async function fetchImage(url: string): Promise<string | null> {
  const response = await session.fromPartition(ASSETS_PARTITION).fetch(url, {
    credentials: "omit",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const type = faviconImageType(response.headers.get("content-type"));
  if (!response.ok || !type || Number(response.headers.get("content-length") ?? 0) > MAX_BYTES) return null;
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length === 0 || bytes.length > MAX_BYTES) return null;
  return `data:${type};base64,${bytes.toString("base64")}`;
}

/** The image at `url` (https only, raster, ≤ 8 MB) as a data: URL, or null; kept for the last URL asked. */
export function startImage(url: string): Promise<string | null> {
  if (!url.startsWith("https://")) return Promise.resolve(null);
  if (cached?.url !== url) {
    const image = fetchImage(url).catch(() => null);
    cached = { url, image };
    // A failure (offline) is retried the next time the start page asks.
    void image.then((result) => {
      if (!result && cached?.image === image) cached = null;
    });
  }
  return cached.image;
}
