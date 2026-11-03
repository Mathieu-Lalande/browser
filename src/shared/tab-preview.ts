import type { Bounds, TabId } from "./types";

/**
 * Tab hover preview (ADR-038): pure parts shared by main (thumbnail cache, card geometry) and the
 * chrome UI (hover intent). No Electron, no DOM.
 */

export const TAB_PREVIEW = {
  /** Hover time before the first card shows. */
  delayMs: 400,
  /** While a card is shown, or this long after it hid, the next row shows at once (no re-delay). */
  warmMs: 300,
  /** A thumbnail older than this is captured again when its tab is on screen. */
  ttlMs: 30_000,
  /** Thumbnails kept per window (least recently stored dropped first). */
  maxEntries: 40,
  /** Card size, px (the thumbnail is 16:10, the header holds title, host and badges). */
  width: 280,
  thumbnailHeight: 175,
  headerHeight: 64,
  /** Space between the hovered row and the card, and between the card and the window edges. */
  gap: 8,
  /** Transparent margin around the card inside the overlay view, for its shadow. */
  margin: 12,
} as const;

/** What the preview card shows (sent to the overlay; the thumbnail is always a `data:` URL). */
export interface TabPreview {
  /** null: a favorite with no open tab. */
  tabId: TabId | null;
  title: string;
  url: string;
  /** Host shown under the title ("" for internal or start pages). */
  host: string;
  favicon: string | null;
  /** `data:image/jpeg;base64,…`, or null (sleeping tab never captured, internal page…). */
  thumbnail: string | null;
  asleep: boolean;
  audible: boolean;
  muted: boolean;
}

/** Only `data:image/…` URLs reach the overlay as thumbnails (CSP `img-src 'self' data:`). */
export const isThumbnailUrl = (value: unknown): value is string => typeof value === "string" && /^data:image\/(jpeg|png|webp);base64,/.test(value);

/** The URL a thumbnail belongs to: an in-page change (hash) keeps it, any other navigation does not. */
export function thumbnailKey(url: string): string {
  const hash = url.indexOf("#");
  return hash < 0 ? url : url.slice(0, hash);
}

interface Entry {
  key: string;
  image: string;
  at: number;
}

/**
 * Last thumbnail of each tab, in memory only (never written, private windows included). An entry
 * belongs to one page: once its tab shows another one, it is dropped rather than shown wrong.
 * Expired entries are still shown (a sleeping tab cannot be captured again); they are only due for
 * a new capture when the tab is on screen.
 */
export class ThumbnailCache {
  private readonly entries = new Map<TabId, Entry>();

  constructor(private readonly options: { ttlMs: number; maxEntries: number } = TAB_PREVIEW) {}

  get size(): number {
    return this.entries.size;
  }

  /** The thumbnail of `tabId` for `url`, however old; null when none or of another page. */
  get(tabId: TabId, url: string): string | null {
    const entry = this.entries.get(tabId);
    return entry && entry.key === thumbnailKey(url) ? entry.image : null;
  }

  /** Whether a (visible) tab should be captured again: no thumbnail of this page, or too old. */
  needsCapture(tabId: TabId, url: string, now: number): boolean {
    const entry = this.entries.get(tabId);
    return !entry || entry.key !== thumbnailKey(url) || now - entry.at >= this.options.ttlMs;
  }

  put(tabId: TabId, url: string, image: string, now: number): void {
    if (!isThumbnailUrl(image)) return;
    this.entries.delete(tabId);
    this.entries.set(tabId, { key: thumbnailKey(url), image, at: now });
    while (this.entries.size > this.options.maxEntries) this.entries.delete(this.entries.keys().next().value!);
  }

  /** The tab now shows `url`: its thumbnail goes if it was of another page. */
  navigated(tabId: TabId, url: string): void {
    const entry = this.entries.get(tabId);
    if (entry && entry.key !== thumbnailKey(url)) this.entries.delete(tabId);
  }

  /** Keeps only the tabs still open. */
  retain(open: ReadonlySet<TabId>): void {
    for (const id of [...this.entries.keys()]) if (!open.has(id)) this.entries.delete(id);
  }

  clear(): void {
    this.entries.clear();
  }
}

/**
 * Where the card goes, in window coordinates: beside `anchor` (the hovered row), on the side with
 * room (right of a left sidebar, left of a right one), its top level with the row, kept inside
 * `area` (the window's content size). Returns the card's own bounds (no margin).
 */
export function previewCardBounds(anchor: Bounds, area: { width: number; height: number }, withThumbnail: boolean): Bounds {
  const { width, gap } = TAB_PREVIEW;
  const height = TAB_PREVIEW.headerHeight + (withThumbnail ? TAB_PREVIEW.thumbnailHeight : 0);
  const right = anchor.x + anchor.width + gap;
  const left = anchor.x - gap - width;
  const fitsRight = right + width + gap <= area.width;
  const preferLeft = anchor.x + anchor.width / 2 > area.width / 2;
  const x = (preferLeft && left >= gap) || !fitsRight ? Math.max(gap, left) : right;
  const y = Math.max(gap, Math.min(anchor.y, area.height - height - gap));
  return { x: Math.round(x), y: Math.round(y), width, height };
}

/** The overlay view's bounds for a card: the card plus its shadow margin. */
export function previewViewBounds(card: Bounds): Bounds {
  const m = TAB_PREVIEW.margin;
  return { x: card.x - m, y: card.y - m, width: card.width + 2 * m, height: card.height + 2 * m };
}

/**
 * Hover intent of the preview: the first card waits `delayMs`; while one is shown (or just
 * hid, `warmMs`) moving to another row shows it at once. Time is passed in (testable).
 */
export class HoverIntent {
  private shownSince: number | null = null;
  private hiddenAt = Number.NEGATIVE_INFINITY;

  constructor(private readonly options: { delayMs: number; warmMs: number } = TAB_PREVIEW) {}

  /** How long to wait before showing the row just entered. */
  delayFor(now: number): number {
    return this.shownSince !== null || now - this.hiddenAt < this.options.warmMs ? 0 : this.options.delayMs;
  }

  shown(now: number): void {
    this.shownSince ??= now;
  }

  /** The card hid. `cold`: hidden by a scroll, drag, key or click: the next one waits again. */
  hidden(now: number, cold = false): void {
    if (this.shownSince !== null && !cold) this.hiddenAt = now;
    if (cold) this.hiddenAt = Number.NEGATIVE_INFINITY;
    this.shownSince = null;
  }

  get isShown(): boolean {
    return this.shownSince !== null;
  }
}
