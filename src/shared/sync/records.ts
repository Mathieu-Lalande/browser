import { sanitizeSettings, type Settings, type SettingsPatch } from "../settings";
import { isSpaceId, sanitizeSpace } from "../spaces";
import type { Bookmark, HistoryEntry, SpaceInfo } from "../types";
import { isNavigableUrl } from "../url";

/**
 * What is synced, as plain data shared by the desktop and mobile adapters (ADR-019). Each
 * collection maps a *local id* (never sent in clear) to a JSON value; validators run on every
 * value decrypted from another device.
 */

export const COLLECTIONS = ["settings", "spaces", "bookmarks", "history", "clients"] as const;
export type CollectionName = (typeof COLLECTIONS)[number];

const MAX_TEXT = 512;
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown, max = MAX_TEXT) => (typeof value === "string" ? value.slice(0, max) : "");
const time = (value: unknown) => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0);
const isWebUrl = (value: unknown): value is string => typeof value === "string" && value.length <= 4096 && /^https?:\/\//i.test(value) && isNavigableUrl(value);

// --- Settings ----------------------------------------------------------------------------------

/** The single settings record. Window/layout, desktop-only and mobile-only preferences stay local. */
export const SETTINGS_RECORD = "prefs";

export interface SyncedSettings {
  mode: Settings["appearance"]["mode"];
  accent: string;
  accent2: string;
  engine: string;
  startPage: Settings["startPage"];
}

export function pickSyncedSettings(settings: Settings): SyncedSettings {
  const { mode, accent, accent2 } = settings.appearance;
  return { mode, accent, accent2, engine: settings.search.engine, startPage: { ...settings.startPage } };
}

export function syncedSettingsPatch(synced: SyncedSettings): SettingsPatch {
  return {
    appearance: { mode: synced.mode, accent: synced.accent, accent2: synced.accent2 },
    search: { engine: synced.engine },
    startPage: { ...synced.startPage },
  };
}

/** Validates through the settings model itself: unknown or invalid fields fall back to defaults. */
export function sanitizeSyncedSettings(value: unknown): SyncedSettings | null {
  if (!isRecord(value)) return null;
  const startPage = isRecord(value.startPage) ? value.startPage : {};
  const settings = sanitizeSettings({
    appearance: { mode: value.mode, accent: value.accent, accent2: value.accent2 },
    search: { engine: value.engine },
    startPage,
  });
  return pickSyncedSettings(settings);
}

// --- Spaces ------------------------------------------------------------------------------------

/** A space's definition (never its tabs). `icon` is an opaque short string (emoji or icon name). */
export interface SyncedSpace {
  name: string;
  icon: string;
  color: string | null;
  isolated: boolean;
  /** Position in the space list. */
  position: number;
}

export function spaceRecord(space: SpaceInfo, position: number): SyncedSpace {
  return { name: space.name, icon: space.icon, color: space.color, isolated: space.isolated, position };
}

export function sanitizeSyncedSpace(value: unknown): SyncedSpace | null {
  if (!isRecord(value)) return null;
  const space = sanitizeSpace({ id: "x", name: value.name, icon: value.icon, color: value.color, isolated: value.isolated });
  if (!space) return null;
  return { name: space.name, icon: space.icon, color: space.color, isolated: space.isolated, position: Math.min(time(value.position), 1000) };
}

export function spaceFromRecord(id: string, record: SyncedSpace): SpaceInfo | null {
  if (!isSpaceId(id)) return null;
  return sanitizeSpace({ id, name: record.name, icon: record.icon, color: record.color, isolated: record.isolated });
}

/**
 * Merges synced space definitions into a local list: updates and additions applied, deletions
 * removed (never the last space), order by synced position. Pure: both apps use it.
 */
export function mergeSpaces(
  local: readonly SpaceInfo[],
  upserts: readonly [string, SyncedSpace][],
  deletes: readonly string[],
  maxSpaces: number,
): SpaceInfo[] {
  const positions = new Map(local.map((space, index) => [space.id, index]));
  let spaces = local.filter((space) => !deletes.includes(space.id));
  for (const [id, record] of upserts) {
    const space = spaceFromRecord(id, record);
    if (!space) continue;
    positions.set(id, record.position);
    const index = spaces.findIndex((candidate) => candidate.id === id);
    if (index !== -1) spaces[index] = space;
    else if (spaces.length < maxSpaces) spaces.push(space);
  }
  if (spaces.length === 0) spaces = local.slice(0, 1);
  return spaces
    .map((space, index) => ({ space, index }))
    .sort((a, b) => (positions.get(a.space.id) ?? a.index) - (positions.get(b.space.id) ?? b.index) || a.index - b.index)
    .map(({ space }) => space);
}

// --- Bookmarks ---------------------------------------------------------------------------------

/** Bookmarks are keyed by URL: the same page saved on two devices is one bookmark. */
export const bookmarkLocalId = (url: string) => `b:${url}`;
export const folderLocalId = (id: string) => `f:${id}`;

export type SyncedBookmark =
  | { kind: "bookmark"; url: string; title: string; createdAt: number; folderId?: string }
  | { kind: "folder"; name: string; createdAt: number };

export function bookmarkRecord(bookmark: Bookmark): SyncedBookmark {
  return {
    kind: "bookmark",
    url: bookmark.url,
    title: bookmark.title.slice(0, MAX_TEXT),
    createdAt: bookmark.createdAt,
    ...(bookmark.folderId ? { folderId: bookmark.folderId } : {}),
  };
}

export function sanitizeSyncedBookmark(value: unknown, localId: string): SyncedBookmark | null {
  if (!isRecord(value)) return null;
  if (value.kind === "folder") {
    if (!localId.startsWith("f:") || localId.length > 80) return null;
    return { kind: "folder", name: text(value.name, 128) || "Dossier", createdAt: time(value.createdAt) };
  }
  if (value.kind !== "bookmark" || !isWebUrl(value.url) || localId !== bookmarkLocalId(value.url)) return null;
  const folderId = typeof value.folderId === "string" && /^[\w-]{1,64}$/.test(value.folderId) ? value.folderId : undefined;
  return { kind: "bookmark", url: value.url, title: text(value.title), createdAt: time(value.createdAt), ...(folderId ? { folderId } : {}) };
}

// --- History -----------------------------------------------------------------------------------

/** Synced history is bounded: the last 90 days, at most 5 000 pages (the most recent). */
export const HISTORY_SYNC_DAYS = 90;
export const HISTORY_SYNC_MAX = 5000;

export interface SyncedHistory {
  url: string;
  title: string;
  visitCount: number;
  lastVisit: number;
}

export function historyRecord(entry: HistoryEntry): SyncedHistory {
  return { url: entry.url, title: entry.title.slice(0, MAX_TEXT), visitCount: entry.visitCount, lastVisit: entry.lastVisit };
}

/** The entries in the sync window, most recent first. */
export function historyInScope(entries: Iterable<HistoryEntry>, now: number): HistoryEntry[] {
  const since = now - HISTORY_SYNC_DAYS * 24 * 60 * 60 * 1000;
  return [...entries]
    .filter((entry) => entry.lastVisit >= since && isWebUrl(entry.url))
    .sort((a, b) => b.lastVisit - a.lastVisit)
    .slice(0, HISTORY_SYNC_MAX);
}

export function sanitizeSyncedHistory(value: unknown, localId: string): SyncedHistory | null {
  if (!isRecord(value) || !isWebUrl(value.url) || value.url !== localId) return null;
  const visitCount = typeof value.visitCount === "number" && value.visitCount >= 1 ? Math.min(Math.floor(value.visitCount), 1_000_000) : 1;
  return { url: value.url, title: text(value.title), visitCount, lastVisit: time(value.lastVisit) };
}

/** History from two devices: the most recent visit and title, the larger visit count. */
export function mergeHistoryEntry(local: HistoryEntry | undefined, remote: SyncedHistory): HistoryEntry {
  if (!local) return { url: remote.url, title: remote.title, favicon: null, visitCount: remote.visitCount, lastVisit: remote.lastVisit };
  const newer = remote.lastVisit > local.lastVisit;
  return {
    url: local.url,
    title: (newer ? remote.title : local.title) || local.title || remote.title,
    favicon: local.favicon,
    visitCount: Math.max(local.visitCount, remote.visitCount),
    lastVisit: Math.max(local.lastVisit, remote.lastVisit),
  };
}

// --- Devices and their open tabs ---------------------------------------------------------------

export const MAX_SYNCED_TABS = 100;

export interface SyncedTab {
  url: string;
  title: string;
}

/** One record per device: its name and open tabs (never private ones). */
export interface SyncedClient {
  name: string;
  kind: "desktop" | "mobile";
  tabs: SyncedTab[];
}

export function clientRecord(name: string, kind: SyncedClient["kind"], tabs: Iterable<SyncedTab>): SyncedClient {
  const seen = new Set<string>();
  const list: SyncedTab[] = [];
  for (const tab of tabs) {
    if (!isWebUrl(tab.url) || seen.has(tab.url)) continue;
    seen.add(tab.url);
    list.push({ url: tab.url, title: tab.title.slice(0, MAX_TEXT) });
    if (list.length >= MAX_SYNCED_TABS) break;
  }
  return { name: name.slice(0, 64), kind, tabs: list };
}

export function sanitizeSyncedClient(value: unknown): SyncedClient | null {
  if (!isRecord(value) || !Array.isArray(value.tabs)) return null;
  const tabs = value.tabs.filter(isRecord).map((tab) => ({ url: tab.url, title: text(tab.title) }));
  const kind = value.kind === "mobile" ? "mobile" : "desktop";
  return clientRecord(text(value.name, 64) || "Appareil", kind, tabs.filter((tab): tab is SyncedTab => isWebUrl(tab.url)));
}

/** Another device's tabs, as shown in "Onglets de mes autres appareils". */
export interface RemoteDevice {
  id: string;
  name: string;
  kind: SyncedClient["kind"];
  /** When this device last updated its tabs (epoch ms). */
  updatedAt: number;
  tabs: SyncedTab[];
}
