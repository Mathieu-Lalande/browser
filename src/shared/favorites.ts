import { webHostname } from "./hosts";
import { displayUrl, isNavigableUrl } from "./url";

/**
 * Favorites (ADR-022): a small grid of site tiles at the top of the sidebar (desktop) and on the
 * start page / tab overview (mobile), shared by every space and synced between devices. Distinct
 * from the bookmarks (a long filed list) and from pinned tabs (per space). Pure.
 */

export interface Favorite {
  /** http(s) URL, also the favorite's identity (one tile per URL). */
  url: string;
  title: string;
  /** Small data: URL kept on this device only (never synced). */
  favicon: string | null;
  /** Epoch ms. */
  createdAt: number;
}

export const MAX_FAVORITES = 24;
const MAX_TITLE = 256;

export const isFavoriteUrl = (value: unknown): value is string =>
  typeof value === "string" && value.length <= 4096 && /^https?:\/\//i.test(value) && isNavigableUrl(value);

function sanitizeFavorite(value: unknown, favicon: (value: unknown) => string | null): Favorite | null {
  if (typeof value !== "object" || value === null) return null;
  const f = value as Record<string, unknown>;
  if (!isFavoriteUrl(f.url)) return null;
  return {
    url: f.url,
    title: (typeof f.title === "string" ? f.title.trim().slice(0, MAX_TITLE) : "") || displayUrl(f.url),
    favicon: favicon(f.favicon),
    createdAt: typeof f.createdAt === "number" && Number.isFinite(f.createdAt) && f.createdAt >= 0 ? Math.floor(f.createdAt) : 0,
  };
}

/** Validates a stored list (order kept, duplicates and invalid entries dropped, at most MAX_FAVORITES). */
export function sanitizeFavorites(value: unknown, favicon: (value: unknown) => string | null = () => null): Favorite[] {
  if (!Array.isArray(value)) return [];
  const list: Favorite[] = [];
  for (const item of value) {
    const favorite = sanitizeFavorite(item, favicon);
    if (favorite && !list.some((other) => other.url === favorite.url)) list.push(favorite);
    if (list.length >= MAX_FAVORITES) break;
  }
  return list;
}

/** Adds a favorite at the end (or at `index`); unchanged list for a duplicate, a non-web URL or at the limit. */
export function addFavorite(list: readonly Favorite[], input: { url: string; title?: string; favicon?: string | null }, now: number, index = list.length): Favorite[] {
  if (!isFavoriteUrl(input.url) || list.length >= MAX_FAVORITES || list.some((favorite) => favorite.url === input.url)) return [...list];
  const favorite: Favorite = {
    url: input.url,
    title: (input.title?.trim() || displayUrl(input.url)).slice(0, MAX_TITLE),
    favicon: input.favicon ?? null,
    createdAt: now,
  };
  const at = Math.max(0, Math.min(Math.trunc(index), list.length));
  return [...list.slice(0, at), favorite, ...list.slice(at)];
}

export function removeFavorite(list: readonly Favorite[], url: string): Favorite[] {
  return list.filter((favorite) => favorite.url !== url);
}

/** Moves a favorite to `index` (in the list without it). */
export function moveFavorite(list: readonly Favorite[], url: string, index: number): Favorite[] {
  const favorite = list.find((candidate) => candidate.url === url);
  if (!favorite) return [...list];
  const rest = list.filter((candidate) => candidate.url !== url);
  const at = Math.max(0, Math.min(Number.isFinite(index) ? Math.trunc(index) : rest.length, rest.length));
  return [...rest.slice(0, at), favorite, ...rest.slice(at)];
}

/**
 * Whether a tab shows the favorite's site: the same page, or any page on the same host (a
 * favorite for mail.example.com stays "open" while browsing that mailbox).
 */
export function isFavoriteTab(favoriteUrl: string, tabUrl: string): boolean {
  if (!tabUrl) return false;
  if (favoriteUrl === tabUrl) return true;
  const host = webHostname(favoriteUrl);
  return host !== "" && host === webHostname(tabUrl);
}

/** The best tab for a favorite among `tabs`: the exact page first, then the most recent on its site. */
export function favoriteTab<T extends { url: string; lastActiveAt: number }>(favoriteUrl: string, tabs: readonly T[]): T | undefined {
  const exact = tabs.find((tab) => tab.url === favoriteUrl);
  if (exact) return exact;
  return tabs.filter((tab) => isFavoriteTab(favoriteUrl, tab.url)).sort((a, b) => b.lastActiveAt - a.lastActiveAt)[0];
}

/** Whether a URL belongs to one of the favorites (such tabs are never archived). */
export function matchesFavorite(list: readonly Favorite[], url: string): boolean {
  return list.some((favorite) => isFavoriteTab(favorite.url, url));
}

// --- Sync (ADR-019 collection "favorites") -----------------------------------------------------

/** Favorites are keyed by URL across devices (the id never leaves the device in clear). */
export const favoriteLocalId = (url: string) => `fav:${url}`;

export interface SyncedFavorite {
  url: string;
  title: string;
  createdAt: number;
  /** Position in the grid. */
  position: number;
}

export function favoriteRecord(favorite: Favorite, position: number): SyncedFavorite {
  return { url: favorite.url, title: favorite.title, createdAt: favorite.createdAt, position };
}

export function sanitizeSyncedFavorite(value: unknown, localId: string): SyncedFavorite | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (!isFavoriteUrl(v.url) || localId !== favoriteLocalId(v.url)) return null;
  const number = (n: unknown, max: number) => (typeof n === "number" && Number.isFinite(n) && n >= 0 ? Math.min(Math.floor(n), max) : 0);
  return {
    url: v.url,
    title: (typeof v.title === "string" ? v.title.slice(0, MAX_TITLE) : "") || displayUrl(v.url),
    createdAt: number(v.createdAt, Number.MAX_SAFE_INTEGER),
    position: number(v.position, 1000),
  };
}

/** Merges synced favorites into the local list: deletions, updates, additions, then synced order. */
export function mergeFavorites(local: readonly Favorite[], upserts: readonly SyncedFavorite[], deletes: readonly string[]): Favorite[] {
  const removed = new Set(deletes.map((id) => (id.startsWith("fav:") ? id.slice(4) : id)));
  const positions = new Map(local.map((favorite, index) => [favorite.url, index]));
  const byUrl = new Map(local.filter((favorite) => !removed.has(favorite.url)).map((favorite) => [favorite.url, favorite]));
  for (const record of upserts) {
    const existing = byUrl.get(record.url);
    byUrl.set(record.url, { url: record.url, title: record.title, favicon: existing?.favicon ?? null, createdAt: record.createdAt });
    positions.set(record.url, record.position);
  }
  return [...byUrl.values()]
    .map((favorite, index) => ({ favorite, index }))
    .sort((a, b) => (positions.get(a.favorite.url) ?? a.index) - (positions.get(b.favorite.url) ?? b.index) || a.index - b.index)
    .map(({ favorite }) => favorite)
    .slice(0, MAX_FAVORITES);
}
