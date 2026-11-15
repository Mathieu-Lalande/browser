/**
 * Synced site icons (ADR-057), pure: collection `favicons`, one record per origin of a bookmark or
 * a favorite, holding a small PNG (`data:image/png;base64,…`, 4 KB at most once decoded). Each
 * device keeps a local store of them (`SiteIcons`) — the source of truth of the collection, fed by
 * its own bookmarks' and favorites' icons (never overwriting one it already has, so two devices
 * with different icons do not ping-pong) and by other devices' records — and fills the bookmarks
 * and favorites that have no icon. Nothing from a private window: only the profile's bookmarks and
 * favorites feed it.
 */

export const MAX_SYNCED_FAVICON_BYTES = 4096;
/** Site icons kept (and synced) at most; the least recently seen go first. */
export const MAX_SITE_ICONS = 500;

export interface SyncedFavicon {
  /** `data:image/png;base64,…` (PNG signature checked, ≤ 4 KB decoded). */
  icon: string;
}

/** One site icon of the local store: the icon and when it was last seen or received (epoch ms). */
export interface SiteIcon {
  icon: string;
  at: number;
}

/** Origin → its icon. */
export type SiteIcons = Record<string, SiteIcon>;

const PNG_PREFIX = "data:image/png;base64,";
/** Base64 of the PNG signature's first bytes (89 50 4E 47 0D 0A 1A 0A). */
const PNG_SIGNATURE = "iVBORw0KGgo";

/** The http(s) origin of a page (the record's id), or null. */
export function faviconOrigin(url: string): string | null {
  if (!/^https?:\/\//i.test(url) || url.length > 4096) return null;
  try {
    const { origin } = new URL(url);
    return origin !== "null" && /^https?:\/\/[^/\s]+$/i.test(origin) ? origin : null;
  } catch {
    return null;
  }
}

/** Decoded size of a base64 payload (padding counted out). */
const base64Bytes = (payload: string) => Math.floor((payload.length * 3) / 4) - (payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0);

/** Whether an icon may travel: a PNG data URL of 4 KB at most. */
export function isSyncableFavicon(value: unknown): value is string {
  if (typeof value !== "string" || !value.startsWith(PNG_PREFIX)) return false;
  const payload = value.slice(PNG_PREFIX.length);
  if (!payload.startsWith(PNG_SIGNATURE) || !/^[A-Za-z0-9+/]+={0,2}$/.test(payload)) return false;
  return base64Bytes(payload) <= MAX_SYNCED_FAVICON_BYTES;
}

export function sanitizeSyncedFavicon(value: unknown, localId: string): SyncedFavicon | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const icon = (value as Record<string, unknown>).icon;
  if (!isSyncableFavicon(icon) || faviconOrigin(localId) !== localId) return null;
  return { icon };
}

/** Validates a stored store (bad entries dropped, the most recent `MAX_SITE_ICONS` kept). */
export function sanitizeSiteIcons(value: unknown): SiteIcons {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const entries: [string, SiteIcon][] = [];
  for (const [origin, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry !== "object" || entry === null) continue;
    const { icon, at } = entry as Record<string, unknown>;
    if (faviconOrigin(origin) !== origin || !isSyncableFavicon(icon)) continue;
    entries.push([origin, { icon, at: typeof at === "number" && Number.isFinite(at) && at >= 0 ? Math.floor(at) : 0 }]);
  }
  return capped(entries);
}

function capped(entries: [string, SiteIcon][]): SiteIcons {
  return Object.fromEntries(entries.sort((a, b) => b[1].at - a[1].at || (a[0] < b[0] ? -1 : 1)).slice(0, MAX_SITE_ICONS));
}

/**
 * The store after looking at the device's own bookmarks and favorites: an origin it does not have
 * yet takes the first syncable icon found (`normalize` may turn another image into a small PNG,
 * or refuse it); one it has keeps its icon. Unchanged store (same object) when nothing is new.
 */
export function collectSiteIcons(store: SiteIcons, items: Iterable<{ url: string; favicon: string | null }>, now: number, normalize: (icon: string) => string | null = (icon) => (isSyncableFavicon(icon) ? icon : null)): SiteIcons {
  let next: SiteIcons | null = null;
  for (const { url, favicon } of items) {
    if (!favicon) continue;
    const origin = faviconOrigin(url);
    if (!origin || (next ?? store)[origin]) continue;
    const icon = normalize(favicon);
    if (!icon || !isSyncableFavicon(icon)) continue;
    next ??= { ...store };
    next[origin] = { icon, at: now };
  }
  return next ? capped(Object.entries(next)) : store;
}

/** The collection's records: one per origin, sorted (a deterministic snapshot). */
export function siteIconRecords(store: SiteIcons): Map<string, SyncedFavicon> {
  return new Map(
    Object.keys(store)
      .sort()
      .map((origin) => [origin, { icon: store[origin]!.icon }] as const),
  );
}

/** Other devices' icons into the store (their icon replaces ours: the record won), deletions removed. */
export function applySiteIcons(store: SiteIcons, upserts: readonly { id: string; data: SyncedFavicon }[], deletes: readonly string[], now: number): SiteIcons {
  const next: SiteIcons = { ...store };
  for (const id of deletes) delete next[id];
  for (const { id, data } of upserts) if (faviconOrigin(id) === id && isSyncableFavicon(data.icon)) next[id] = { icon: data.icon, at: now };
  return capped(Object.entries(next));
}

/** The icon of a page's origin in the store, or null. */
export function siteIconFor(store: SiteIcons, url: string): string | null {
  const origin = faviconOrigin(url);
  return (origin && store[origin]?.icon) || null;
}

/**
 * Bookmarks or favorites with the store's icons where they have none, or where their icon is the
 * one another device replaced (`replaced`: origin → the icon it had before). The same array when
 * nothing changes.
 */
export function fillFavicons<T extends { url: string; favicon: string | null }>(list: readonly T[], store: SiteIcons, replaced: ReadonlyMap<string, string> = new Map()): T[] {
  let changed = false;
  const next = list.map((item) => {
    const origin = faviconOrigin(item.url);
    const icon = origin ? store[origin]?.icon : undefined;
    if (!origin || !icon || item.favicon === icon) return item;
    if (item.favicon && replaced.get(origin) !== item.favicon) return item;
    changed = true;
    return { ...item, favicon: icon };
  });
  return changed ? next : (list as T[]);
}
