import { randomUUID } from "node:crypto";
import { storableFavicon } from "@shared/favicon";
import { displayUrl, isNavigableUrl } from "@shared/url";
import type { Bookmark, BookmarkInput } from "@shared/types";

export const BOOKMARKS_VERSION = 1;

export interface BookmarkFolder {
  id: string;
  name: string;
  createdAt: number;
}

export interface BookmarksData {
  bookmarks: Bookmark[];
  folders: BookmarkFolder[];
}

const MAX_TEXT = 2048;
const isText = (value: unknown): value is string => typeof value === "string";

function sanitizeBookmark(value: unknown): Bookmark | null {
  if (typeof value !== "object" || value === null) return null;
  const b = value as Record<string, unknown>;
  if (!isText(b.id) || !isText(b.url) || !isNavigableUrl(b.url)) return null;
  return {
    id: b.id,
    url: b.url,
    title: isText(b.title) ? b.title.slice(0, MAX_TEXT) : displayUrl(b.url),
    // Migration (ADR-018): remote favicon URLs are dropped, only small data: URLs are kept.
    favicon: storableFavicon(b.favicon),
    createdAt: typeof b.createdAt === "number" && Number.isFinite(b.createdAt) ? b.createdAt : 0,
    ...(isText(b.folderId) ? { folderId: b.folderId } : {}),
  };
}

function sanitizeFolder(value: unknown): BookmarkFolder | null {
  if (typeof value !== "object" || value === null) return null;
  const f = value as Record<string, unknown>;
  if (!isText(f.id) || !isText(f.name)) return null;
  return { id: f.id, name: f.name.slice(0, MAX_TEXT), createdAt: typeof f.createdAt === "number" ? f.createdAt : 0 };
}

/** Bookmarks: a flat list, each optionally filed in a folder. Pure (no I/O). */
export class Bookmarks {
  private bookmarks: Bookmark[];
  private readonly folders: BookmarkFolder[];
  /** url → number of bookmarks with that url, for O(1) `has()` in every tab state push. */
  private readonly urls = new Map<string, number>();

  constructor(data: BookmarksData = { bookmarks: [], folders: [] }) {
    this.bookmarks = data.bookmarks.map((bookmark) => ({ ...bookmark }));
    this.folders = data.folders.map((folder) => ({ ...folder }));
    for (const bookmark of this.bookmarks) this.index(bookmark.url, 1);
  }

  static parse(data: unknown): BookmarksData | null {
    if (typeof data !== "object" || data === null) return null;
    const d = data as Record<string, unknown>;
    if (!Array.isArray(d.bookmarks)) return null;
    const folders = Array.isArray(d.folders) ? d.folders.map(sanitizeFolder).filter((f) => f !== null) : [];
    const folderIds = new Set(folders.map((folder) => folder.id));
    const bookmarks = d.bookmarks
      .map(sanitizeBookmark)
      .filter((bookmark) => bookmark !== null)
      // A bookmark whose folder vanished falls back to the root.
      .map(({ folderId, ...bookmark }) => (folderId && folderIds.has(folderId) ? { ...bookmark, folderId } : bookmark));
    return { bookmarks, folders };
  }

  list(): Bookmark[] {
    return this.bookmarks.map((bookmark) => ({ ...bookmark }));
  }

  has(url: string): boolean {
    return this.urls.has(url);
  }

  /** Adds a bookmark (or returns the existing one for that URL). Null for non-web URLs. */
  add(input: BookmarkInput, now: number): Bookmark | null {
    if (!isNavigableUrl(input.url)) return null;
    const existing = this.bookmarks.find((bookmark) => bookmark.url === input.url);
    if (existing) return { ...existing };
    const folderId = input.folderId && this.folders.some((folder) => folder.id === input.folderId) ? input.folderId : undefined;
    const bookmark: Bookmark = {
      id: randomUUID(),
      url: input.url,
      title: (input.title?.trim() || displayUrl(input.url)).slice(0, MAX_TEXT),
      favicon: storableFavicon(input.favicon),
      createdAt: now,
      ...(folderId ? { folderId } : {}),
    };
    this.bookmarks.push(bookmark);
    this.index(bookmark.url, 1);
    return { ...bookmark };
  }

  remove(id: string): boolean {
    const index = this.bookmarks.findIndex((bookmark) => bookmark.id === id);
    if (index === -1) return false;
    const [removed] = this.bookmarks.splice(index, 1);
    this.index(removed.url, -1);
    return true;
  }

  /** Bookmarks the page, or removes every bookmark of it. Returns whether it is now bookmarked. */
  toggle(input: BookmarkInput, now: number): boolean {
    if (this.has(input.url)) {
      this.bookmarks = this.bookmarks.filter((bookmark) => bookmark.url !== input.url);
      this.urls.delete(input.url);
      return false;
    }
    return this.add(input, now) !== null;
  }

  // --- Sync (ADR-019): bookmarks are identified by URL across devices ------------------------

  folderList(): BookmarkFolder[] {
    return this.folders.map((folder) => ({ ...folder }));
  }

  /** Creates or updates the bookmark of `input.url` (the first one, when there are several). */
  upsertByUrl(input: { url: string; title: string; createdAt: number; folderId?: string }): void {
    if (!isNavigableUrl(input.url)) return;
    const folderId = input.folderId && this.folders.some((folder) => folder.id === input.folderId) ? input.folderId : undefined;
    const existing = this.bookmarks.find((bookmark) => bookmark.url === input.url);
    if (existing) {
      existing.title = input.title.slice(0, MAX_TEXT);
      existing.createdAt = input.createdAt;
      if (folderId) existing.folderId = folderId;
      else delete existing.folderId;
      return;
    }
    this.bookmarks.push({ id: randomUUID(), url: input.url, title: input.title.slice(0, MAX_TEXT), favicon: null, createdAt: input.createdAt, ...(folderId ? { folderId } : {}) });
    this.index(input.url, 1);
  }

  removeByUrl(url: string): boolean {
    if (!this.has(url)) return false;
    this.bookmarks = this.bookmarks.filter((bookmark) => bookmark.url !== url);
    this.urls.delete(url);
    return true;
  }

  upsertFolder(folder: BookmarkFolder): void {
    const existing = this.folders.find((candidate) => candidate.id === folder.id);
    if (existing) Object.assign(existing, { name: folder.name.slice(0, MAX_TEXT), createdAt: folder.createdAt });
    else this.folders.push({ id: folder.id, name: folder.name.slice(0, MAX_TEXT), createdAt: folder.createdAt });
  }

  /** Deletes a folder; its bookmarks move to the root. */
  removeFolder(id: string): boolean {
    const index = this.folders.findIndex((folder) => folder.id === id);
    if (index === -1) return false;
    this.folders.splice(index, 1);
    for (const bookmark of this.bookmarks) if (bookmark.folderId === id) delete bookmark.folderId;
    return true;
  }

  toJSON(): BookmarksData {
    return { bookmarks: this.bookmarks, folders: this.folders };
  }

  private index(url: string, delta: number): void {
    const count = (this.urls.get(url) ?? 0) + delta;
    if (count > 0) this.urls.set(url, count);
    else this.urls.delete(url);
  }
}
