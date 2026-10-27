import { storableFavicon } from "./favicon";
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
