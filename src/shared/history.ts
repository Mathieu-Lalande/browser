import { storableFavicon } from "./favicon";
import { fold } from "./fuzzy";
import { rankHistory, topSites } from "./search";
import type { HistoryEntry } from "./types";

export const HISTORY_VERSION = 1;
export const MAX_HISTORY_ENTRIES = 10_000;
/** Visiting the same URL again within this delay (reloads, redirects back…) is not a new visit. */
export const REVISIT_MS = 30_000;

/** Longer URLs (pushState spam, data smuggled in a query string) are not recorded. */
export const MAX_HISTORY_URL_LENGTH = 8192;

const isRecordable = (url: string) => url.length <= MAX_HISTORY_URL_LENGTH && /^https?:\/\//i.test(url);
const MAX_TEXT = 2048;

function sanitizeEntry(value: unknown): HistoryEntry | null {
  if (typeof value !== "object" || value === null) return null;
  const e = value as Record<string, unknown>;
  if (typeof e.url !== "string" || !isRecordable(e.url)) return null;
  if (typeof e.lastVisit !== "number" || !Number.isFinite(e.lastVisit)) return null;
  return {
    url: e.url,
    title: typeof e.title === "string" ? e.title.slice(0, MAX_TEXT) : "",
    // Migration (ADR-018): favicons used to be remote URLs the UI fetched; only small data: URLs are kept.
    favicon: storableFavicon(e.favicon),
    visitCount: typeof e.visitCount === "number" && e.visitCount >= 1 ? Math.floor(e.visitCount) : 1,
    lastVisit: e.lastVisit,
  };
}

/** Where a page of `browser://history` ends: the next one starts after this entry. */
export interface HistoryCursor {
  lastVisit: number;
  url: string;
}

export interface HistoryPage {
  entries: HistoryEntry[];
  /** Null on the last page. */
  next: HistoryCursor | null;
}

export const HISTORY_PAGE_SIZE = 100;

/** Most recent first, then by URL: a total order, so pages never skip nor repeat an entry. */
function compareRecent(a: { lastVisit: number; url: string }, b: { lastVisit: number; url: string }): number {
  return b.lastVisit - a.lastVisit || (a.url < b.url ? -1 : a.url > b.url ? 1 : 0);
}

/** "Effacer l'historique" ranges of `browser://history`. */
export type HistoryClearRange = "hour" | "today" | "week" | "all";
export const HISTORY_CLEAR_RANGES: readonly HistoryClearRange[] = ["hour", "today", "week", "all"];

/** The first instant a range clears (local midnight for "today"); 0 for everything. */
export function clearRangeStart(range: HistoryClearRange, now: number): number {
  if (range === "hour") return now - 60 * 60 * 1000;
  if (range === "week") return now - 7 * 24 * 60 * 60 * 1000;
  if (range === "today") {
    const midnight = new Date(now);
    midnight.setHours(0, 0, 0, 0);
    return midnight.getTime();
  }
  return 0;
}

/** Entries grouped by local day (`YYYY-MM-DD`), in the given order: the history page's sections. */
export function groupByDay<T extends { lastVisit: number }>(entries: readonly T[]): { day: string; date: number; entries: T[] }[] {
  const groups: { day: string; date: number; entries: T[] }[] = [];
  for (const entry of entries) {
    const date = new Date(entry.lastVisit);
    const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    const group = groups.at(-1);
    if (group?.day === day) group.entries.push(entry);
    else groups.push({ day, date: new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime(), entries: [entry] });
  }
  return groups;
}

/**
 * Browsing history, one entry per URL. Pure (no I/O): the owner persists `toJSON()`.
 * Entries are kept in a Map ordered by last visit, so pruning the oldest is cheap.
 */
export class History {
  private readonly entries = new Map<string, HistoryEntry>();

  constructor(
    entries: readonly HistoryEntry[] = [],
    private readonly maxEntries = MAX_HISTORY_ENTRIES,
  ) {
    for (const entry of [...entries].sort((a, b) => a.lastVisit - b.lastVisit)) this.entries.set(entry.url, { ...entry });
    this.prune();
  }

  /** Validates stored data; invalid entries are dropped, a non-list is corrupt. */
  static parse(data: unknown): HistoryEntry[] | null {
    if (!Array.isArray(data)) return null;
    return data.map(sanitizeEntry).filter((entry): entry is HistoryEntry => entry !== null);
  }

  get size(): number {
    return this.entries.size;
  }

  /** Records a visit to `url`. Returns whether anything changed. Only http(s) pages are kept. */
  recordVisit(url: string, now: number, page: { title?: string; favicon?: string | null } = {}): boolean {
    if (!isRecordable(url)) return false;
    const existing = this.entries.get(url);
    const entry: HistoryEntry = existing ?? { url, title: "", favicon: null, visitCount: 0, lastVisit: now };
    if (!existing || now - existing.lastVisit >= REVISIT_MS) entry.visitCount += 1;
    entry.lastVisit = now;
    if (page.title) entry.title = page.title.slice(0, MAX_TEXT);
    const favicon = storableFavicon(page.favicon);
    if (favicon) entry.favicon = favicon;
    // Re-insert so the Map stays ordered by last visit.
    this.entries.delete(url);
    this.entries.set(url, entry);
    this.prune();
    return true;
  }

  /** Updates title/favicon of an already recorded page (they arrive after the navigation). */
  updatePage(url: string, page: { title?: string; favicon?: string | null }): boolean {
    const entry = this.entries.get(url);
    if (!entry) return false;
    let changed = false;
    if (page.title && page.title !== entry.title) {
      entry.title = page.title.slice(0, MAX_TEXT);
      changed = true;
    }
    const favicon = page.favicon === undefined ? entry.favicon : storableFavicon(page.favicon);
    if (favicon !== entry.favicon) {
      entry.favicon = favicon;
      changed = true;
    }
    return changed;
  }

  /** Stores entries as given (sync from another device), keeping the order by last visit. */
  upsertMany(entries: readonly HistoryEntry[]): boolean {
    const valid = entries.filter((entry) => isRecordable(entry.url));
    if (valid.length === 0) return false;
    for (const entry of valid) this.entries.set(entry.url, { ...entry });
    const sorted = [...this.entries.values()].sort((a, b) => a.lastVisit - b.lastVisit);
    this.entries.clear();
    for (const entry of sorted) this.entries.set(entry.url, entry);
    this.prune();
    return true;
  }

  /** Forgets one page (deleted on another device). */
  remove(url: string): boolean {
    return this.entries.delete(url);
  }

  get(url: string): HistoryEntry | undefined {
    const entry = this.entries.get(url);
    return entry && { ...entry };
  }

  search(query: string, limit: number, now: number): HistoryEntry[] {
    return rankHistory(this.entries.values(), query, limit, now).map((entry) => ({ ...entry }));
  }

  topSites(limit: number, now: number): HistoryEntry[] {
    return topSites(this.entries.values(), limit, now).map((entry) => ({ ...entry }));
  }

  clear(): void {
    this.entries.clear();
  }

  /**
   * One page of `browser://history`: most recent first, ties by URL, after `cursor` (the last
   * entry of the previous page), keeping entries whose title or URL contain every word of `query`.
   */
  page(options: { query?: string; cursor?: HistoryCursor | null; limit: number }): HistoryPage {
    const words = fold(options.query ?? "").split(/\s+/).filter(Boolean);
    const cursor = options.cursor ?? null;
    const matches = (entry: HistoryEntry) => {
      if (!words.length) return true;
      const text = fold(`${entry.title} ${entry.url}`);
      return words.every((word) => text.includes(word));
    };
    const sorted = [...this.entries.values()].filter((entry) => !cursor || compareRecent(entry, cursor) > 0).filter(matches).sort(compareRecent);
    const entries = sorted.slice(0, options.limit).map((entry) => ({ ...entry }));
    const last = entries.at(-1);
    return { entries, next: sorted.length > options.limit && last ? { lastVisit: last.lastVisit, url: last.url } : null };
  }

  /** Forgets these pages. Returns how many were known. */
  removeMany(urls: Iterable<string>): number {
    let removed = 0;
    for (const url of urls) if (this.entries.delete(url)) removed++;
    return removed;
  }

  /** Forgets the pages last visited at or after `since` (epoch ms). Returns how many. */
  removeSince(since: number): number {
    let removed = 0;
    for (const [url, entry] of this.entries) {
      if (entry.lastVisit >= since) {
        this.entries.delete(url);
        removed++;
      }
    }
    return removed;
  }

  /**
   * Merges pages imported from another browser: a known page keeps its title (unless it has none)
   * and gets the most recent visit and the higher visit count. Returns how many pages were new.
   */
  importEntries(entries: readonly { url: string; title: string; visitCount: number; lastVisit: number }[]): number {
    let added = 0;
    const merged: HistoryEntry[] = [];
    for (const imported of entries) {
      if (!isRecordable(imported.url) || !Number.isFinite(imported.lastVisit) || imported.lastVisit <= 0) continue;
      const existing = this.entries.get(imported.url);
      if (!existing) added++;
      merged.push({
        url: imported.url,
        title: (existing?.title || imported.title || "").slice(0, MAX_TEXT),
        favicon: existing?.favicon ?? null,
        visitCount: Math.max(existing?.visitCount ?? 1, Math.floor(imported.visitCount) || 1),
        lastVisit: Math.max(existing?.lastVisit ?? 0, imported.lastVisit),
      });
    }
    this.upsertMany(merged);
    return added;
  }

  /** Oldest visit first. */
  toJSON(): HistoryEntry[] {
    return [...this.entries.values()];
  }

  private prune(): void {
    let excess = this.entries.size - this.maxEntries;
    for (const url of this.entries.keys()) {
      if (excess-- <= 0) break;
      this.entries.delete(url);
    }
  }
}
