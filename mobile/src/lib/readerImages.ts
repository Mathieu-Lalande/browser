import { mapReaderImages, readerImageSources, type ReaderArticle } from "@shared/reader";
import { toBase64Url } from "@shared/sync/bytes";

/**
 * Reader images on the phone (ADR-050). An RN `Image` given the page's URL would load it through
 * the app's HTTP stack, which on Android shares the WebView's cookie jar. Instead the app fetches
 * the first images itself with **no credentials** (no cookies either way), no cache and no
 * referrer, HTTPS only, keeps raster images recognized by their first bytes (never SVG), and hands
 * them to the reader as `data:` URLs. What is not fetched keeps its description, as before.
 */

export const READER_IMAGE_LIMITS = { count: 12, bytes: 2 * 1024 * 1024, timeoutMs: 5000 } as const;

export type FetchLike = (url: string, init: { credentials: "omit"; cache: "no-store"; referrerPolicy: "no-referrer"; redirect: "follow"; signal: AbortSignal }) => Promise<{
  ok: boolean;
  url?: string;
  headers: { get(name: string): string | null };
  arrayBuffer(): Promise<ArrayBuffer>;
}>;

/** The article's images worth fetching: https only, deduplicated, the first `count`. */
export function readerImagePlan(article: ReaderArticle, count: number = READER_IMAGE_LIMITS.count): string[] {
  return [...new Set(readerImageSources(article.content))].filter((src) => /^https:\/\//i.test(src)).slice(0, count);
}

/** The raster type of an image from its first bytes (PNG, JPEG, GIF, WebP), else null. */
export function sniffRasterType(bytes: Uint8Array): string | null {
  const starts = (...values: number[]) => values.every((value, index) => bytes[index] === value);
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  if (starts(0xff, 0xd8, 0xff)) return "image/jpeg";
  if (starts(0x47, 0x49, 0x46, 0x38)) return "image/gif";
  if (starts(0x52, 0x49, 0x46, 0x46) && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return "image/webp";
  return null;
}

/** A `data:` URL for raster bytes (standard base64), or null when the bytes are not an allowed image. */
export function rasterDataUrl(bytes: Uint8Array, maxBytes: number = READER_IMAGE_LIMITS.bytes): string | null {
  const type = bytes.length <= maxBytes ? sniffRasterType(bytes) : null;
  if (!type) return null;
  const base64 = toBase64Url(bytes).replace(/-/g, "+").replace(/_/g, "/");
  return `data:${type};base64,${base64}${"=".repeat((4 - (base64.length % 4)) % 4)}`;
}

async function fetchOne(fetchImpl: FetchLike, src: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), READER_IMAGE_LIMITS.timeoutMs);
  try {
    const response = await fetchImpl(src, { credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer", redirect: "follow", signal: controller.signal });
    // A redirect to plain http (or elsewhere than the web) is refused like an http source.
    if (!response.ok || (response.url && !/^https:\/\//i.test(response.url))) return null;
    const length = Number(response.headers.get("content-length"));
    if (length > READER_IMAGE_LIMITS.bytes) return null;
    return rasterDataUrl(new Uint8Array(await response.arrayBuffer()));
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** The article with its first images inlined as `data:` (the others keep their http(s) source, drawn as their description). */
export async function withReaderImages(article: ReaderArticle, fetchImpl: FetchLike): Promise<ReaderArticle> {
  const sources = readerImagePlan(article);
  if (!sources.length) return article;
  const fetched = new Map<string, string | null>();
  await Promise.all(sources.map(async (src) => fetched.set(src, await fetchOne(fetchImpl, src))));
  return { ...article, content: mapReaderImages(article.content, (src) => fetched.get(src) ?? src) };
}
