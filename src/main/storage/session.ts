import { isFolderId, sanitizeFolders, type FolderId, type TabFolder } from "@shared/folders";
import { internalPageOf, internalUrl } from "@shared/internal";
import type { SpaceId, SpaceInfo } from "@shared/types";
import { DEFAULT_SPACE, isSpaceId, sanitizeSpace } from "@shared/spaces";
import { MAX_SPLIT_TABS, clampRatio } from "@shared/split";
import { storableFavicon } from "@shared/favicon";
import { isNavigableUrl } from "@shared/url";

/**
 * v1: `{ windows: [{ tabs, activeIndex }] }`.
 * v2: spaces — `{ spaces, windows: [{ activeSpaceId, spaces: [{ spaceId, tabs, activeIndex, split }] }] }`.
 * v3: folders (ADR-022) — each space's tab list gains `folders`, its tabs `folderId` and
 *     `lastSeenAt` (for auto-archiving). A v2 session is read as a v3 one without folders.
 */
export const SESSION_VERSION = 3;

/** What is needed to bring a tab back without loading it. */
export interface SessionTab {
  /** Empty string means the start page; `browser://…` an internal page. */
  url: string;
  title: string;
  favicon: string | null;
  pinned: boolean;
  /** Sidebar folder (v3); absent at the root. */
  folderId?: FolderId;
  /** Epoch ms when the tab was last on screen (v3), for auto-archiving. */
  lastSeenAt?: number;
}

/** Tabs shown side by side, by index in their tab list. */
export interface SessionSplit {
  tabIndexes: number[];
  ratioX: number;
  ratioY: number;
}

/** The tabs of one space in one window (what a TabManager saves and restores). */
export interface SessionTabList {
  tabs: SessionTab[];
  activeIndex: number;
  split?: SessionSplit | null;
  /** Sidebar folders of the space (v3); absent when there are none. */
  folders?: TabFolder[];
}

export interface SessionSpaceTabs extends SessionTabList {
  spaceId: SpaceId;
}

export interface SessionWindow {
  activeSpaceId: SpaceId;
  spaces: SessionSpaceTabs[];
}

export interface Session {
  /** Space definitions, shared by every window. Never empty. */
  spaces: SpaceInfo[];
  windows: SessionWindow[];
}

const MAX_TEXT = 2048;

function sanitizeTab(value: unknown): SessionTab | null {
  if (typeof value !== "object" || value === null) return null;
  const t = value as Record<string, unknown>;
  if (typeof t.url !== "string") return null;
  // Never restore something a tab could not have loaded in the first place (file:, javascript:…).
  const internal = internalPageOf(t.url);
  if (t.url !== "" && !internal && !isNavigableUrl(t.url)) return null;
  const tab: SessionTab = {
    url: internal ? internalUrl(internal) : t.url,
    title: typeof t.title === "string" ? t.title.slice(0, MAX_TEXT) : "",
    // Small data: favicons only (ADR-018): the UI never fetches a remote favicon itself.
    favicon: storableFavicon(t.favicon),
    pinned: t.pinned === true,
  };
  // Pinned tabs are never filed in a folder.
  if (!tab.pinned && isFolderId(t.folderId)) tab.folderId = t.folderId;
  if (typeof t.lastSeenAt === "number" && Number.isFinite(t.lastSeenAt) && t.lastSeenAt > 0) tab.lastSeenAt = Math.floor(t.lastSeenAt);
  return tab;
}

/** Validates a tab list; indexes (active tab, split) follow the tabs through drops and reordering. */
function sanitizeTabList(value: unknown): SessionTabList | null {
  if (typeof value !== "object" || value === null) return null;
  const w = value as Record<string, unknown>;
  if (!Array.isArray(w.tabs)) return null;
  const valid = w.tabs.map((tab, index) => ({ tab: sanitizeTab(tab), index }));
  const kept = valid.filter((item): item is { tab: SessionTab; index: number } => item.tab !== null);
  if (kept.length === 0) return null;
  // Pinned tabs always lead, as in the live TabManager (stable sort keeps the rest in order).
  kept.sort((a, b) => Number(b.tab.pinned) - Number(a.tab.pinned));
  const newIndex = (original: unknown) => (typeof original === "number" ? kept.findIndex((item) => item.index === original) : -1);
  const list: SessionTabList = { tabs: kept.map((item) => item.tab), activeIndex: Math.max(0, newIndex(w.activeIndex)) };
  const split = sanitizeSplit(w.split, newIndex);
  if (split) list.split = split;
  // A tab whose folder is gone goes back to the root.
  const folders = sanitizeFolders(w.folders);
  const folderIds = new Set(folders.map((folder) => folder.id));
  for (const tab of list.tabs) if (tab.folderId && !folderIds.has(tab.folderId)) delete tab.folderId;
  if (folders.length) list.folders = folders;
  return list;
}

function sanitizeSplit(value: unknown, newIndex: (original: unknown) => number): SessionSplit | null {
  if (typeof value !== "object" || value === null) return null;
  const s = value as Record<string, unknown>;
  if (!Array.isArray(s.tabIndexes)) return null;
  const indexes = [...new Set(s.tabIndexes.map(newIndex).filter((index) => index !== -1))].slice(0, MAX_SPLIT_TABS);
  if (indexes.length < 2) return null;
  const ratio = (r: unknown) => clampRatio(typeof r === "number" ? r : 0.5);
  return { tabIndexes: indexes, ratioX: ratio(s.ratioX), ratioY: ratio(s.ratioY) };
}

function sanitizeWindow(value: unknown, spaceIds: ReadonlySet<SpaceId>): SessionWindow | null {
  if (typeof value !== "object" || value === null) return null;
  const w = value as Record<string, unknown>;
  if (!Array.isArray(w.spaces)) return null;
  const seen = new Set<SpaceId>();
  const spaces: SessionSpaceTabs[] = [];
  for (const entry of w.spaces) {
    const spaceId = (entry as Record<string, unknown> | null)?.spaceId;
    if (!isSpaceId(spaceId) || !spaceIds.has(spaceId) || seen.has(spaceId)) continue;
    const list = sanitizeTabList(entry);
    if (!list) continue;
    seen.add(spaceId);
    spaces.push({ spaceId, ...list });
  }
  if (spaces.length === 0) return null;
  const activeSpaceId = isSpaceId(w.activeSpaceId) && spaceIds.has(w.activeSpaceId) ? w.activeSpaceId : spaces[0].spaceId;
  return { activeSpaceId, spaces };
}

/** v2 and v3 share their shape (v3 only adds optional fields): a v2 session is migrated as is. */
function parseSpaces(data: Record<string, unknown>): Session | null {
  if (!Array.isArray(data.spaces) || !Array.isArray(data.windows)) return null;
  const spaces: SpaceInfo[] = [];
  for (const value of data.spaces) {
    const space = sanitizeSpace(value);
    if (space && !spaces.some((other) => other.id === space.id)) spaces.push(space);
  }
  if (spaces.length === 0) spaces.push({ ...DEFAULT_SPACE });
  const ids = new Set(spaces.map((space) => space.id));
  return { spaces, windows: data.windows.map((window) => sanitizeWindow(window, ids)).filter((window) => window !== null) };
}

/** v1 had no spaces: every window's tabs move into the default space ("Personnel"). */
function migrateV1(data: Record<string, unknown>): Session | null {
  if (!Array.isArray(data.windows)) return null;
  const space = { ...DEFAULT_SPACE };
  const windows = data.windows
    .map(sanitizeTabList)
    .filter((list) => list !== null)
    .map((list): SessionWindow => ({ activeSpaceId: space.id, spaces: [{ spaceId: space.id, ...list }] }));
  return { spaces: [space], windows };
}

/** Validates (and migrates) a stored session; unusable windows/tabs are dropped, a malformed root is corrupt. */
export function parseSession(data: unknown, version = SESSION_VERSION): Session | null {
  if (typeof data !== "object" || data === null) return null;
  const root = data as Record<string, unknown>;
  return version < 2 ? migrateV1(root) : parseSpaces(root);
}

/** The session of a first launch: one empty window in the default space. */
export const emptySession = (): Session => ({ spaces: [{ ...DEFAULT_SPACE }], windows: [] });
