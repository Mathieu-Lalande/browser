import type { Bookmark } from "@shared/types";
import { isNavigableUrl } from "@shared/url";

/** Bookmarks (favorites) of the mobile app: a flat list, newest last. Pure. */

export const MAX_BOOKMARKS = 2000;
const MAX_TEXT = 512;

export function isBookmarked(bookmarks: readonly Bookmark[], url: string): boolean {
  return url !== "" && bookmarks.some((bookmark) => bookmark.url === url);
}

/** Adds the page, or removes it when it is already there. */
export function toggleBookmark(bookmarks: readonly Bookmark[], page: { url: string; title: string }, id: string, now: number): Bookmark[] {
  if (!/^https?:/i.test(page.url)) return [...bookmarks];
  if (isBookmarked(bookmarks, page.url)) return bookmarks.filter((bookmark) => bookmark.url !== page.url);
  const bookmark: Bookmark = { id, url: page.url, title: page.title.slice(0, MAX_TEXT), favicon: null, createdAt: now };
  return [...bookmarks, bookmark].slice(-MAX_BOOKMARKS);
}

export function removeBookmark(bookmarks: readonly Bookmark[], id: string): Bookmark[] {
  return bookmarks.filter((bookmark) => bookmark.id !== id);
}

/** Validates stored bookmarks; invalid entries are dropped. */
export function parseBookmarks(data: unknown): Bookmark[] {
  if (!Array.isArray(data)) return [];
  const result: Bookmark[] = [];
  const seen = new Set<string>();
  for (const value of data) {
    if (typeof value !== "object" || value === null) continue;
    const b = value as Record<string, unknown>;
    if (typeof b.id !== "string" || typeof b.url !== "string" || !isNavigableUrl(b.url) || seen.has(b.url)) continue;
    seen.add(b.url);
    result.push({
      id: b.id.slice(0, 64),
      url: b.url,
      title: typeof b.title === "string" ? b.title.slice(0, MAX_TEXT) : "",
      favicon: null,
      createdAt: typeof b.createdAt === "number" && Number.isFinite(b.createdAt) ? b.createdAt : 0,
    });
  }
  return result.slice(-MAX_BOOKMARKS);
}
