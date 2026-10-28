import { displayUrl } from "./url";

/**
 * Tab auto-archiving (ADR-022): tabs left alone for a long time (12 h to 30 days, setting
 * "Archiver les onglets inactifs après") are closed and kept in a list (`browser://archive` on
 * the desktop, "Archivés" in the mobile tab overview) to search, restore or delete. Pure: the
 * policy is shared by both apps, the desktop feeds it from its tab-sleeping candidates (ADR-014).
 */

/** What the policy needs to know about a tab. */
export interface ArchiveCandidate {
  id: string;
  url: string;
  /** On screen (active tab or a pane of the visible split) in the shown space. */
  shown: boolean;
  pinned: boolean;
  /** Playing sound (even muted). */
  audible: boolean;
  /** Part of a split view. */
  inSplit: boolean;
  /** Shows the site of one of the favorites. */
  favorite: boolean;
  /** Epoch ms when the tab was last on screen (or created/restored with no better date). */
  lastSeenAt: number;
}

export type ArchiveBlocker = "not-web" | "shown" | "pinned" | "favorite" | "audible" | "split" | "recent";

export interface ArchiveContext {
  now: number;
  /** Idle time before archiving. */
  idleMs: number;
}

/** Why a tab is kept, or null when it may be archived. Start pages and internal pages are never archived. */
export function archiveBlocker(tab: ArchiveCandidate, { now, idleMs }: ArchiveContext): ArchiveBlocker | null {
  if (!/^https?:\/\//i.test(tab.url)) return "not-web";
  if (tab.shown) return "shown";
  if (tab.pinned) return "pinned";
  if (tab.favorite) return "favorite";
  if (tab.audible) return "audible";
  if (tab.inSplit) return "split";
  if (!(tab.lastSeenAt > 0) || now - tab.lastSeenAt < idleMs) return "recent";
  return null;
}

/** Ids of the tabs to archive now, least recently seen first. */
export function tabsToArchive(tabs: readonly ArchiveCandidate[], context: ArchiveContext): string[] {
  return tabs
    .filter((tab) => archiveBlocker(tab, context) === null)
    .sort((a, b) => a.lastSeenAt - b.lastSeenAt)
    .map((tab) => tab.id);
}

/** How often to look for tabs to archive: delays are hours long, a check every 10 minutes is plenty. */
export const ARCHIVE_CHECK_MS = 10 * 60_000;

// --- The archive list --------------------------------------------------------------------------

export interface ArchivedTab {
  id: string;
  url: string;
  title: string;
  /** Small data: URL (desktop), null on mobile. */
  favicon: string | null;
  /** The space it was archived from (restored there when it still exists). */
  spaceId: string | null;
  /** Epoch ms. */
  archivedAt: number;
}

export const MAX_ARCHIVED = 500;
const MAX_TITLE = 512;

export const isArchiveId = (value: unknown): value is string => typeof value === "string" && /^[\w-]{1,64}$/.test(value);

/** Validates a stored archive (newest first, duplicates by URL dropped, at most MAX_ARCHIVED). */
export function sanitizeArchive(value: unknown, favicon: (value: unknown) => string | null = () => null): ArchivedTab[] {
  if (!Array.isArray(value)) return [];
  const list: ArchivedTab[] = [];
  const urls = new Set<string>();
  for (const item of value) {
    if (typeof item !== "object" || item === null) continue;
    const a = item as Record<string, unknown>;
    if (!isArchiveId(a.id) || typeof a.url !== "string" || !/^https?:\/\//i.test(a.url) || a.url.length > 8192 || urls.has(a.url)) continue;
    urls.add(a.url);
    list.push({
      id: a.id,
      url: a.url,
      title: (typeof a.title === "string" ? a.title.slice(0, MAX_TITLE) : "") || displayUrl(a.url),
      favicon: favicon(a.favicon),
      spaceId: typeof a.spaceId === "string" && /^[\w-]{1,64}$/.test(a.spaceId) ? a.spaceId : null,
      archivedAt: typeof a.archivedAt === "number" && Number.isFinite(a.archivedAt) ? a.archivedAt : 0,
    });
  }
  return list.sort((a, b) => b.archivedAt - a.archivedAt).slice(0, MAX_ARCHIVED);
}

/** Adds archived tabs (newest first); an URL archived again replaces its older entry. */
export function addArchived(list: readonly ArchivedTab[], entries: readonly ArchivedTab[]): ArchivedTab[] {
  const urls = new Set(entries.map((entry) => entry.url));
  return [...entries, ...list.filter((entry) => !urls.has(entry.url))].sort((a, b) => b.archivedAt - a.archivedAt).slice(0, MAX_ARCHIVED);
}

export function removeArchived(list: readonly ArchivedTab[], id: string): ArchivedTab[] {
  return list.filter((entry) => entry.id !== id);
}

/** Entries whose title or address contains every word of `query` (case and accents ignored). */
export function searchArchive(list: readonly ArchivedTab[], query: string): ArchivedTab[] {
  const fold = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return [...list];
  return list.filter((entry) => {
    const haystack = fold(`${entry.title} ${entry.url}`);
    return words.every((word) => haystack.includes(word));
  });
}
