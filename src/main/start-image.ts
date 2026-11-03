import { session } from "electron";
import { faviconImageType } from "@shared/favicon";
import { appServices } from "./services";

/**
 * The start page's background image (a https URL chosen in the settings), fetched by main and
 * handed to the chrome UI as a `data:` URL: the UI's CSP only allows `'self'` and `data:` images
 * (ADR-018). It goes through a dedicated in-memory session without cookies, so the image host
 * learns nothing of the user's profile and nothing reaches the disk cache. Private windows do not
 * show it at all (they keep their fixed private look, and make no request of their own).
 */

/** In-memory partition (no `persist:` prefix): no cookies sent, nothing written to disk. */
export const ASSETS_PARTITION = "browser-assets";
const MAX_BYTES = 8 * 1024 * 1024;
const TIMEOUT_MS = 15_000;

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

const assetsFetch: Fetch = (url, init) => session.fromPartition(ASSETS_PARTITION).fetch(url, init);

/** The last start image asked for, fetched once (a failure is retried the next time). */
export class StartImageCache {
  private cached: { url: string; image: Promise<string | null> } | null = null;

  constructor(private readonly fetch: Fetch = assetsFetch) {}

  /** The image at `url` (https only, raster, ≤ 8 MB) as a data: URL, or null; kept for the last URL asked. */
  get(url: string): Promise<string | null> {
    if (!url.startsWith("https://")) return Promise.resolve(null);
    if (this.cached?.url !== url) {
      const image = this.download(url).catch(() => null);
      this.cached = { url, image };
      // A failure (offline) is retried the next time the start page asks.
      void image.then((result) => {
        if (!result && this.cached?.image === image) this.cached = null;
      });
    }
    return this.cached.image;
  }

  private async download(url: string): Promise<string | null> {
    const response = await this.fetch(url, { credentials: "omit", signal: AbortSignal.timeout(TIMEOUT_MS) });
    const type = faviconImageType(response.headers.get("content-type"));
    if (!response.ok || !type || Number(response.headers.get("content-length") ?? 0) > MAX_BYTES) return null;
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length === 0 || bytes.length > MAX_BYTES) return null;
    return `data:${type};base64,${bytes.toString("base64")}`;
  }
}

/** The image at `url` as a data: URL, or null (see `StartImageCache`). */
export const startImage = (url: string): Promise<string | null> => appServices().startImage.get(url);
