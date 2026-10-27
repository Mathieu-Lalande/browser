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
      // Folders come from the desktop through sync (not shown on the phone, but kept).
      ...(typeof b.folderId === "string" && /^[\w-]{1,64}$/.test(b.folderId) ? { folderId: b.folderId } : {}),
    });
  }
  return result.slice(-MAX_BOOKMARKS);
}

/** Bookmark folders received from the desktop (sync); invalid entries are dropped. */
export function parseFolders(data: unknown): { id: string; name: string; createdAt: number }[] {
  if (!Array.isArray(data)) return [];
  return data
    .filter((value): value is Record<string, unknown> => typeof value === "object" && value !== null)
    .filter((f) => typeof f.id === "string" && /^[\w-]{1,64}$/.test(f.id) && typeof f.name === "string")
    .map((f) => ({ id: f.id as string, name: (f.name as string).slice(0, 128), createdAt: typeof f.createdAt === "number" ? f.createdAt : 0 }))
    .slice(0, 500);
}
