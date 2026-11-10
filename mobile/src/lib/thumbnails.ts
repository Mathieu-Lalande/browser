/**
 * Tab thumbnails of the overview grid (ADR-055). A capture (small JPEG, `react-native-view-shot`)
 * is taken of the tab on screen when the user leaves it (tab overview, swipe to another tab) and
 * after a page settles; never of a private tab, the start page or an interstitial. Two LRU levels:
 * recent captures as `data:` URIs in memory (shown at once), every capture as a file in the cache
 * folder (`thumbnails/<tabId>-<version>.jpg`, survives restarts). Closed tabs lose theirs.
 */

/** Captures kept in memory (data: URIs of ~10-20 KB each). */
export const MEMORY_THUMBNAILS = 12;
/** Capture files kept in the cache folder. */
export const FILE_THUMBNAILS = 60;
/** Width of a capture, in pixels (cards are ~170 pt wide; 2x density). */
export const THUMBNAIL_WIDTH = 360;
export const THUMBNAIL_QUALITY = 0.55;
/** Wait after a load before capturing (layout, fonts, first images). */
export const SETTLE_MS = 900;

/** A small LRU map: `get` refreshes, `set` returns the evicted entries. */
export class LruMap<V> {
  private readonly entries = new Map<string, V>();

  constructor(readonly capacity: number) {}

  get size(): number {
    return this.entries.size;
  }

  get(key: string): V | undefined {
    const value = this.entries.get(key);
    if (value === undefined) return undefined;
    this.entries.delete(key);
    this.entries.set(key, value);
    return value;
  }

  /** Reads without refreshing. */
  peek(key: string): V | undefined {
    return this.entries.get(key);
  }

  set(key: string, value: V): [string, V][] {
    this.entries.delete(key);
    this.entries.set(key, value);
    const evicted: [string, V][] = [];
    for (const [oldKey, oldValue] of this.entries) {
      if (this.entries.size - evicted.length <= this.capacity) break;
      evicted.push([oldKey, oldValue]);
    }
    for (const [oldKey] of evicted) this.entries.delete(oldKey);
    return evicted;
  }

  delete(key: string): V | undefined {
    const value = this.entries.get(key);
    this.entries.delete(key);
    return value;
  }

  /** Removes every key not in `keep`; returns what was removed. */
  retain(keep: ReadonlySet<string>): [string, V][] {
    const removed = [...this.entries].filter(([key]) => !keep.has(key));
    for (const [key] of removed) this.entries.delete(key);
    return removed;
  }

  keys(): string[] {
    return [...this.entries.keys()];
  }
}

/** File name of a capture; the version changes the URI so images are not served stale. */
export const thumbnailFileName = (tabId: string, version: number): string => `${tabId}-${version}.jpg`;

/** The tab id and version of a capture file, or null for anything else in the folder. */
export function parseThumbnailFileName(name: string): { tabId: string; version: number } | null {
  const match = /^([A-Za-z0-9_-]{1,80})-(\d{1,15})\.jpg$/.exec(name);
  return match ? { tabId: match[1]!, version: Number(match[2]) } : null;
}

/** Whether the tab on screen may be captured now. */
export function canCaptureTab(tab: { url: string; interstitial?: unknown; isLoading?: boolean } | null | undefined, isPrivate: boolean): boolean {
  if (!tab || isPrivate || tab.interstitial || tab.isLoading) return false;
  return /^https?:/i.test(tab.url);
}

/**
 * Index of the capture files found at start-up: newest version per tab, oldest files first (so
 * the LRU keeps the most recent); stale versions and unknown files are returned for deletion.
 */
export function indexThumbnailFiles(files: readonly { name: string; modified: number }[]): { keep: { tabId: string; name: string; version: number }[]; remove: string[] } {
  const newest = new Map<string, { name: string; version: number; modified: number }>();
  const remove: string[] = [];
  for (const file of files) {
    const parsed = parseThumbnailFileName(file.name);
    if (!parsed) {
      remove.push(file.name);
      continue;
    }
    const current = newest.get(parsed.tabId);
    if (current && current.version >= parsed.version) remove.push(file.name);
    else {
      if (current) remove.push(current.name);
      newest.set(parsed.tabId, { name: file.name, version: parsed.version, modified: file.modified });
    }
  }
  const keep = [...newest].sort((a, b) => a[1].modified - b[1].modified).map(([tabId, value]) => ({ tabId, name: value.name, version: value.version }));
  return { keep, remove };
}
