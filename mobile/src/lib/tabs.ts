import { addSpace, DEFAULT_SPACE, isSpaceId, neighborSpace, removeSpace, sanitizeSpace, updateSpace } from "@shared/spaces";
import type { CloseTabActivates } from "@shared/settings";
import type { SpaceId, SpaceInfo, SpaceInput, TabInterstitial, TabState } from "@shared/types";
import { isNavigableUrl } from "@shared/url";

/**
 * Tabs and spaces of the mobile app, as a pure reducer (no React, no I/O): the store wires it to
 * React and persistence. A tab keeps its URL/title even when its WebView is unmounted (see
 * `liveTabIds`), like the desktop's lazily restored tabs.
 */

export type TabId = string;

/** Pseudo space holding private tabs: never persisted, never in history. */
export const PRIVATE_SPACE_ID = "private";

export interface MobileTab {
  id: TabId;
  /** Current URL; empty string is the start page. */
  url: string;
  title: string;
  /** A space id, or PRIVATE_SPACE_ID. */
  spaceId: SpaceId;
  isPinned: boolean;
  isLoading: boolean;
  /** 0…1 */
  progress: number;
  canGoBack: boolean;
  canGoForward: boolean;
  /** Epoch ms of the last activation. */
  lastActiveAt: number;
  /**
   * What the WebView must load. It only changes on explicit loads (address bar, link opened in a
   * new tab, HTTPS upgrade), never when the page navigates by itself, so the WebView's `source`
   * prop stays stable. `seq` makes reloading the same URL a distinct request.
   */
  load: { url: string; seq: number };
  /** Built-in page shown instead of the web page (HTTPS-Only failure). */
  interstitial: TabInterstitial | null;
  /** While an HTTPS-Only upgraded load is in flight: the original http:// URL. */
  upgradedFrom: string | null;
  /** Folder of the tab overview (ADR-022), in the tab's space; null when loose. */
  folderId: string | null;
}

/**
 * A folder of the tab overview (ADR-022): the phone's simple version of the desktop's sidebar
 * folders, one level, per space, grouping cards under a collapsible header.
 */
export interface MobileFolder {
  id: string;
  spaceId: SpaceId;
  name: string;
  collapsed: boolean;
}

export const MAX_MOBILE_FOLDERS = 32;
const MAX_FOLDER_NAME = 40;
const cleanFolderName = (name: string) => name.replace(/[\p{Cc}\s]+/gu, " ").trim().slice(0, MAX_FOLDER_NAME);

export interface TabsModel {
  tabs: MobileTab[];
  spaces: SpaceInfo[];
  /** The space shown (or PRIVATE_SPACE_ID). */
  activeSpaceId: SpaceId;
  /** Active tab of each space (and of the private group). */
  activeTabs: Record<SpaceId, TabId | null>;
  /** Counter for `MobileTab.load.seq`. */
  seq: number;
  /** Folders of the tab overview, every space (private tabs have none). */
  folders: MobileFolder[];
}

export const isPrivateTab = (tab: Pick<MobileTab, "spaceId">) => tab.spaceId === PRIVATE_SPACE_ID;

export function initialTabsModel(): TabsModel {
  return { tabs: [], spaces: [{ ...DEFAULT_SPACE }], activeSpaceId: DEFAULT_SPACE.id, activeTabs: {}, seq: 0, folders: [] };
}

export type TabsAction =
  | {
      type: "open";
      id: TabId;
      url: string;
      now: number;
      spaceId?: SpaceId;
      background?: boolean;
      afterId?: TabId;
      title?: string;
      upgradedFrom?: string | null;
    }
  | { type: "close"; id: TabId; activates: CloseTabActivates; now: number }
  | { type: "close-many"; ids: TabId[]; now: number }
  | { type: "activate"; id: TabId; now: number }
  | { type: "load"; id: TabId; url: string; upgradedFrom?: string | null }
  | {
      type: "navigation";
      id: TabId;
      url: string;
      title: string;
      isLoading: boolean;
      canGoBack: boolean;
      canGoForward: boolean;
    }
  | { type: "progress"; id: TabId; progress: number }
  | { type: "interstitial"; id: TabId; interstitial: TabInterstitial | null }
  | { type: "pin"; id: TabId; pinned: boolean }
  | { type: "duplicate"; id: TabId; newId: TabId; now: number }
  | { type: "move-to-space"; id: TabId; spaceId: SpaceId; now: number }
  | { type: "show-space"; spaceId: SpaceId }
  | { type: "add-space"; id: SpaceId; input?: SpaceInput }
  | { type: "update-space"; id: SpaceId; input: SpaceInput }
  | { type: "remove-space"; id: SpaceId }
  | { type: "restore"; model: TabsModel }
  /** Space list merged from another device (sync, ADR-019): removed spaces close their tabs. */
  | { type: "sync-spaces"; spaces: SpaceInfo[] }
  /** Folders (ADR-022): a new folder in a space, optionally with a tab moved into it. */
  | { type: "add-folder"; id: string; spaceId: SpaceId; name: string; tabId?: TabId }
  | { type: "rename-folder"; id: string; name: string }
  | { type: "toggle-folder"; id: string }
  /** Deletes a folder; its tabs become loose (or are closed with `closeTabs`). */
  | { type: "remove-folder"; id: string; closeTabs?: boolean; now: number }
  /** Files a tab in a folder of its space, or takes it out (null). */
  | { type: "set-tab-folder"; id: TabId; folderId: string | null };

// --- Selectors --------------------------------------------------------------------------------

export function tabsInSpace(model: TabsModel, spaceId: SpaceId = model.activeSpaceId): MobileTab[] {
  return model.tabs.filter((tab) => tab.spaceId === spaceId);
}

export function activeTab(model: TabsModel): MobileTab | null {
  const id = model.activeTabs[model.activeSpaceId];
  return model.tabs.find((tab) => tab.id === id && tab.spaceId === model.activeSpaceId) ?? null;
}

/** Tabs of a space in display order: pinned first, then the others, each in opening order. */
export function orderedTabs(model: TabsModel, spaceId: SpaceId = model.activeSpaceId): MobileTab[] {
  const tabs = tabsInSpace(model, spaceId);
  return [...tabs.filter((tab) => tab.isPinned), ...tabs.filter((tab) => !tab.isPinned)];
}

export interface OverviewGroups {
  /** Unfiled cards, first. */
  loose: MobileTab[];
  /** Then each folder of the space with its cards (empty folders too). */
  folders: { folder: MobileFolder; tabs: MobileTab[] }[];
}

/** The overview's cards of a space (pinned tabs excluded: they have their own row), grouped by folder. */
export function overviewGroups(model: TabsModel, spaceId: SpaceId = model.activeSpaceId): OverviewGroups {
  const tabs = orderedTabs(model, spaceId).filter((tab) => !tab.isPinned);
  const folders = model.folders.filter((folder) => folder.spaceId === spaceId);
  const ids = new Set(folders.map((folder) => folder.id));
  return {
    loose: tabs.filter((tab) => !tab.folderId || !ids.has(tab.folderId)),
    folders: folders.map((folder) => ({ folder, tabs: tabs.filter((tab) => tab.folderId === folder.id) })),
  };
}

/** "Dossier", then "Dossier 2"… within a space. */
export function nextMobileFolderName(model: TabsModel, spaceId: SpaceId): string {
  const names = new Set(model.folders.filter((folder) => folder.spaceId === spaceId).map((folder) => folder.name));
  if (!names.has("Dossier")) return "Dossier";
  let n = 2;
  while (names.has(`Dossier ${n}`)) n++;
  return `Dossier ${n}`;
}

export type SwipeTarget = { kind: "tab"; id: TabId } | { kind: "new" } | null;

/**
 * Where swiping the address bar leads: the neighbor tab in display order. Swiping past the last
 * tab opens a new one (like Safari); there is nothing before the first.
 */
export function swipeTarget(model: TabsModel, direction: 1 | -1): SwipeTarget {
  const tabs = orderedTabs(model);
  const current = activeTab(model);
  const index = current ? tabs.findIndex((tab) => tab.id === current.id) : -1;
  const target = tabs[index + direction];
  if (target) return { kind: "tab", id: target.id };
  if (direction === 1 && current && current.url !== "") return { kind: "new" };
  return null;
}

/**
 * Tabs whose WebView stays mounted: the active tab of the shown space plus the most recently
 * used others, up to `max`. Unmounted tabs keep their URL and title and reload when shown.
 * Start-page tabs have no WebView at all. With `keepPrivate`, private tabs are never unmounted:
 * their cookies live in the WebView itself (iOS non-persistent data store) and would be lost.
 */
export function liveTabIds(model: TabsModel, max: number, keepPrivate = false): TabId[] {
  const active = activeTab(model);
  const live: TabId[] = [];
  if (active && active.url) live.push(active.id);
  const others = model.tabs
    .filter((tab) => tab.id !== active?.id && tab.url !== "" && (tab.lastActiveAt > 0 || (keepPrivate && isPrivateTab(tab))))
    .sort((a, b) => b.lastActiveAt - a.lastActiveAt);
  let regular = live.length;
  for (const tab of others) {
    if (keepPrivate && isPrivateTab(tab)) live.push(tab.id);
    else if (regular < max) {
      live.push(tab.id);
      regular++;
    }
  }
  return live;
}

/**
 * Where a newly created WebView for the tab starts: its current page. `load` is only what was
 * last asked for explicitly (it must not change while the page navigates, or a mounted WebView
 * would reload); a tab whose WebView was unmounted (evicted from `liveTabIds`) or died comes back
 * where it was, not on the first page of that load.
 */
export function mountUrl(tab: Pick<MobileTab, "url" | "load">): string {
  return tab.url || tab.load.url;
}

/** The shape the shared palette/commands code expects. */
export function toTabState(tab: MobileTab, bookmarked: boolean): TabState {
  return {
    id: tab.id,
    url: tab.url,
    title: tab.title || tab.url,
    favicon: null,
    isLoading: tab.isLoading,
    canGoBack: tab.canGoBack,
    canGoForward: tab.canGoForward,
    isPinned: tab.isPinned,
    isBookmarked: bookmarked,
    blockedCount: 0,
    shieldsEnabled: true,
    permissionRequest: null,
    interstitial: tab.interstitial,
    lastActiveAt: tab.lastActiveAt,
    isAudible: false,
    isMuted: false,
    zoom: 100,
    find: null,
    blockedPopup: null,
  };
}

// --- Reducer ----------------------------------------------------------------------------------

const MAX_TITLE = 512;
const MAX_URL = 8192;

function newTab(id: TabId, url: string, spaceId: SpaceId, seq: number, title = ""): MobileTab {
  return {
    id,
    url,
    title: title.slice(0, MAX_TITLE),
    spaceId,
    isPinned: false,
    isLoading: url !== "",
    progress: 0,
    canGoBack: false,
    canGoForward: false,
    lastActiveAt: 0,
    load: { url, seq },
    interstitial: null,
    upgradedFrom: null,
    folderId: null,
  };
}

const spaceExists = (model: TabsModel, spaceId: SpaceId) =>
  spaceId === PRIVATE_SPACE_ID || model.spaces.some((space) => space.id === spaceId);

function patchTab(model: TabsModel, id: TabId, patch: (tab: MobileTab) => Partial<MobileTab> | null): TabsModel {
  let changed = false;
  const tabs = model.tabs.map((tab) => {
    if (tab.id !== id) return tab;
    const update = patch(tab);
    if (!update) return tab;
    const keys = Object.keys(update) as (keyof MobileTab)[];
    if (keys.every((key) => tab[key] === update[key])) return tab;
    changed = true;
    return { ...tab, ...update };
  });
  return changed ? { ...model, tabs } : model;
}

function activate(model: TabsModel, id: TabId, now: number): TabsModel {
  const tab = model.tabs.find((candidate) => candidate.id === id);
  if (!tab) return model;
  return {
    ...model,
    activeSpaceId: tab.spaceId,
    activeTabs: { ...model.activeTabs, [tab.spaceId]: id },
    tabs: model.tabs.map((candidate) => (candidate.id === id ? { ...candidate, lastActiveAt: now } : candidate)),
  };
}

/** Which tab of the same space becomes active when `closing` goes away: its neighbor in display order. */
function successor(model: TabsModel, closing: MobileTab, activates: CloseTabActivates): MobileTab | null {
  const siblings = orderedTabs(model, closing.spaceId);
  const index = siblings.findIndex((tab) => tab.id === closing.id);
  const rest = siblings.filter((tab) => tab.id !== closing.id);
  if (rest.length === 0) return null;
  if (activates === "recent") return [...rest].sort((a, b) => b.lastActiveAt - a.lastActiveAt)[0];
  if (activates === "previous") return siblings[index - 1] ?? siblings[index + 1] ?? null;
  return siblings[index + 1] ?? siblings[index - 1] ?? null;
}

function closeTabs(model: TabsModel, ids: ReadonlySet<TabId>, activates: CloseTabActivates, now: number): TabsModel {
  let next = model;
  for (const id of ids) {
    const closing = next.tabs.find((tab) => tab.id === id);
    if (!closing) continue;
    const wasActive = next.activeTabs[closing.spaceId] === id;
    const heir = wasActive ? successor({ ...next, tabs: next.tabs.filter((tab) => tab.id === id || !ids.has(tab.id)) }, closing, activates) : null;
    next = { ...next, tabs: next.tabs.filter((tab) => tab.id !== id) };
    if (wasActive) {
      next = { ...next, activeTabs: { ...next.activeTabs, [closing.spaceId]: heir?.id ?? null } };
      if (heir && next.activeSpaceId === closing.spaceId) next = activate(next, heir.id, now);
    }
  }
  return next;
}

export function tabsReducer(model: TabsModel, action: TabsAction): TabsModel {
  switch (action.type) {
    case "open": {
      if (model.tabs.some((tab) => tab.id === action.id)) return model;
      const spaceId = action.spaceId && spaceExists(model, action.spaceId) ? action.spaceId : model.activeSpaceId;
      const url = action.url.slice(0, MAX_URL);
      const tab = { ...newTab(action.id, url, spaceId, model.seq + 1, action.title), upgradedFrom: action.upgradedFrom ?? null };
      const after = action.afterId ? model.tabs.findIndex((candidate) => candidate.id === action.afterId) : -1;
      const tabs = after === -1 ? [...model.tabs, tab] : [...model.tabs.slice(0, after + 1), tab, ...model.tabs.slice(after + 1)];
      const next = { ...model, tabs, seq: model.seq + 1 };
      return action.background ? next : activate(next, tab.id, action.now);
    }
    case "close":
      return closeTabs(model, new Set([action.id]), action.activates, action.now);
    case "close-many":
      return closeTabs(model, new Set(action.ids), "next", action.now);
    case "activate":
      return activate(model, action.id, action.now);
    case "load": {
      if (!model.tabs.some((tab) => tab.id === action.id)) return model;
      const url = action.url.slice(0, MAX_URL);
      const seq = model.seq + 1;
      const tabs = model.tabs.map((tab) =>
        tab.id === action.id
          ? {
              ...tab,
              url,
              load: { url, seq },
              isLoading: url !== "",
              progress: 0,
              interstitial: null,
              upgradedFrom: action.upgradedFrom ?? null,
              ...(url === "" ? { title: "", canGoBack: false, canGoForward: false } : {}),
            }
          : tab,
      );
      return { ...model, tabs, seq };
    }
    case "navigation":
      return patchTab(model, action.id, (tab) => {
        // Pages report about:blank while starting up; keep showing what we know.
        if (!isNavigableUrl(action.url) || action.url === "about:blank") return { isLoading: action.isLoading };
        return {
          url: action.url.slice(0, MAX_URL),
          title: (action.title && action.title !== action.url ? action.title : tab.url === action.url ? tab.title : "").slice(0, MAX_TITLE),
          isLoading: action.isLoading,
          canGoBack: action.canGoBack,
          canGoForward: action.canGoForward,
          ...(action.isLoading ? {} : { progress: 1 }),
          // A successful https load ends the upgrade; a later failure is a normal error.
          ...(!action.isLoading && action.url.startsWith("https:") ? { upgradedFrom: null } : {}),
        };
      });
    case "progress":
      return patchTab(model, action.id, () => ({ progress: Math.min(1, Math.max(0, action.progress)) }));
    case "interstitial":
      return patchTab(model, action.id, () => ({ interstitial: action.interstitial, isLoading: false, upgradedFrom: null }));
    case "pin":
      return patchTab(model, action.id, () => ({ isPinned: action.pinned }));
    case "duplicate": {
      const source = model.tabs.find((tab) => tab.id === action.id);
      if (!source || model.tabs.some((tab) => tab.id === action.newId)) return model;
      return tabsReducer(model, { type: "open", id: action.newId, url: source.url, title: source.title, spaceId: source.spaceId, afterId: source.id, now: action.now });
    }
    case "move-to-space": {
      const tab = model.tabs.find((candidate) => candidate.id === action.id);
      // Private tabs stay private: their pages were never meant to be kept.
      if (!tab || tab.spaceId === action.spaceId || isPrivateTab(tab) || action.spaceId === PRIVATE_SPACE_ID) return model;
      if (!spaceExists(model, action.spaceId)) return model;
      const closed = closeTabs(model, new Set([tab.id]), "next", action.now);
      // Folders belong to a space: the tab arrives loose.
      const moved = { ...tab, spaceId: action.spaceId, folderId: null };
      return {
        ...closed,
        tabs: [...closed.tabs, moved],
        activeTabs: closed.activeTabs[action.spaceId] ? closed.activeTabs : { ...closed.activeTabs, [action.spaceId]: moved.id },
      };
    }
    case "show-space":
      return spaceExists(model, action.spaceId) && model.activeSpaceId !== action.spaceId ? { ...model, activeSpaceId: action.spaceId } : model;
    case "add-space": {
      if (!isSpaceId(action.id) || action.id === PRIVATE_SPACE_ID) return model;
      const spaces = addSpace(model.spaces, action.id, action.input);
      return spaces ? { ...model, spaces, activeSpaceId: action.id } : model;
    }
    case "update-space":
      return { ...model, spaces: updateSpace(model.spaces, action.id, action.input) };
    case "remove-space": {
      if (model.spaces.length <= 1 || !model.spaces.some((space) => space.id === action.id)) return model;
      const heir = neighborSpace(model.spaces, action.id) ?? DEFAULT_SPACE.id;
      const { [action.id]: _removed, ...activeTabs } = model.activeTabs;
      return {
        ...model,
        spaces: removeSpace(model.spaces, action.id),
        tabs: model.tabs.filter((tab) => tab.spaceId !== action.id),
        folders: model.folders.filter((folder) => folder.spaceId !== action.id),
        activeTabs,
        activeSpaceId: model.activeSpaceId === action.id ? heir : model.activeSpaceId,
      };
    }
    case "restore":
      return action.model;
    case "sync-spaces": {
      const spaces = action.spaces.map(sanitizeSpace).filter((space): space is SpaceInfo => space !== null && space.id !== PRIVATE_SPACE_ID);
      if (spaces.length === 0) return model;
      const kept = new Set(spaces.map((space) => space.id));
      const activeTabs = Object.fromEntries(Object.entries(model.activeTabs).filter(([id]) => id === PRIVATE_SPACE_ID || kept.has(id)));
      return {
        ...model,
        spaces,
        tabs: model.tabs.filter((tab) => tab.spaceId === PRIVATE_SPACE_ID || kept.has(tab.spaceId)),
        folders: model.folders.filter((folder) => kept.has(folder.spaceId)),
        activeTabs,
        activeSpaceId: model.activeSpaceId === PRIVATE_SPACE_ID || kept.has(model.activeSpaceId) ? model.activeSpaceId : spaces[0].id,
      };
    }
    case "add-folder": {
      // Private tabs are never filed: nothing about them is kept.
      if (!isTabId(action.id) || action.spaceId === PRIVATE_SPACE_ID || !model.spaces.some((space) => space.id === action.spaceId)) return model;
      if (model.folders.length >= MAX_MOBILE_FOLDERS || model.folders.some((folder) => folder.id === action.id)) return model;
      const folder: MobileFolder = { id: action.id, spaceId: action.spaceId, name: cleanFolderName(action.name) || nextMobileFolderName(model, action.spaceId), collapsed: false };
      const next = { ...model, folders: [...model.folders, folder] };
      return action.tabId ? tabsReducer(next, { type: "set-tab-folder", id: action.tabId, folderId: folder.id }) : next;
    }
    case "rename-folder": {
      const name = cleanFolderName(action.name);
      if (!name) return model;
      return { ...model, folders: model.folders.map((folder) => (folder.id === action.id ? { ...folder, name } : folder)) };
    }
    case "toggle-folder":
      return { ...model, folders: model.folders.map((folder) => (folder.id === action.id ? { ...folder, collapsed: !folder.collapsed } : folder)) };
    case "remove-folder": {
      if (!model.folders.some((folder) => folder.id === action.id)) return model;
      const filed = model.tabs.filter((tab) => tab.folderId === action.id).map((tab) => tab.id);
      const next: TabsModel = {
        ...model,
        folders: model.folders.filter((folder) => folder.id !== action.id),
        tabs: model.tabs.map((tab) => (tab.folderId === action.id ? { ...tab, folderId: null } : tab)),
      };
      return action.closeTabs ? closeTabs(next, new Set(filed), "next", action.now) : next;
    }
    case "set-tab-folder": {
      const tab = model.tabs.find((candidate) => candidate.id === action.id);
      if (!tab || isPrivateTab(tab)) return model;
      if (action.folderId !== null && !model.folders.some((folder) => folder.id === action.folderId && folder.spaceId === tab.spaceId)) return model;
      return patchTab(model, action.id, () => ({ folderId: action.folderId }));
    }
  }
}

// --- Persistence ------------------------------------------------------------------------------

/** v2 (ADR-022): overview folders and each tab's `folderId`; a v1 session loads without folders. */
export const SESSION_VERSION = 2;

interface StoredTab {
  id: string;
  url: string;
  title: string;
  spaceId: string;
  isPinned: boolean;
  lastActiveAt: number;
  folderId?: string;
}

export interface StoredSession {
  tabs: StoredTab[];
  spaces: SpaceInfo[];
  activeSpaceId: SpaceId;
  activeTabs: Record<SpaceId, TabId | null>;
  folders?: MobileFolder[];
}

/** What is written to storage: everything but private tabs and transient page state. */
export function serializeSession(model: TabsModel): StoredSession {
  const tabs = model.tabs
    .filter((tab) => !isPrivateTab(tab))
    .map((tab) => ({
      id: tab.id,
      url: tab.url,
      title: tab.title,
      spaceId: tab.spaceId,
      isPinned: tab.isPinned,
      lastActiveAt: tab.lastActiveAt,
      ...(tab.folderId ? { folderId: tab.folderId } : {}),
    }));
  const { [PRIVATE_SPACE_ID]: _private, ...activeTabs } = model.activeTabs;
  return {
    tabs,
    spaces: model.spaces,
    activeSpaceId: model.activeSpaceId === PRIVATE_SPACE_ID ? (model.spaces[0]?.id ?? DEFAULT_SPACE.id) : model.activeSpaceId,
    activeTabs,
    folders: model.folders,
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isTabId = (value: unknown): value is TabId => typeof value === "string" && /^[\w-]{1,64}$/.test(value);

/** Validates stored data into a model; anything unusable is dropped. Null if not a session at all. */
export function parseSession(data: unknown): TabsModel | null {
  if (!isRecord(data) || !Array.isArray(data.tabs) || !Array.isArray(data.spaces)) return null;
  const spaces = data.spaces.map(sanitizeSpace).filter((space): space is SpaceInfo => space !== null && space.id !== PRIVATE_SPACE_ID);
  const uniqueSpaces = spaces.filter((space, index) => spaces.findIndex((other) => other.id === space.id) === index);
  if (uniqueSpaces.length === 0) uniqueSpaces.push({ ...DEFAULT_SPACE });
  const spaceIds = new Set(uniqueSpaces.map((space) => space.id));
  const folders: MobileFolder[] = [];
  for (const value of Array.isArray(data.folders) ? data.folders : []) {
    if (!isRecord(value) || !isTabId(value.id) || typeof value.spaceId !== "string" || !spaceIds.has(value.spaceId)) continue;
    if (folders.length >= MAX_MOBILE_FOLDERS || folders.some((folder) => folder.id === value.id)) continue;
    const name = typeof value.name === "string" ? cleanFolderName(value.name) : "";
    folders.push({ id: value.id, spaceId: value.spaceId, name: name || "Dossier", collapsed: value.collapsed === true });
  }
  let seq = 0;
  const seen = new Set<string>();
  const tabs: MobileTab[] = [];
  for (const value of data.tabs) {
    if (!isRecord(value) || !isTabId(value.id) || seen.has(value.id)) continue;
    const url = typeof value.url === "string" && (value.url === "" || isNavigableUrl(value.url)) ? value.url.slice(0, MAX_URL) : null;
    if (url === null) continue;
    const spaceId = typeof value.spaceId === "string" && spaceIds.has(value.spaceId) ? value.spaceId : uniqueSpaces[0].id;
    seen.add(value.id);
    const tab = newTab(value.id, url, spaceId, ++seq, typeof value.title === "string" ? value.title : "");
    tab.isPinned = value.isPinned === true;
    tab.isLoading = false;
    tab.lastActiveAt = typeof value.lastActiveAt === "number" && Number.isFinite(value.lastActiveAt) ? value.lastActiveAt : 0;
    // Only into a folder of the tab's own space.
    tab.folderId = folders.some((folder) => folder.id === value.folderId && folder.spaceId === spaceId) ? (value.folderId as string) : null;
    tabs.push(tab);
  }
  const activeTabs: Record<SpaceId, TabId | null> = {};
  const storedActive = isRecord(data.activeTabs) ? data.activeTabs : {};
  for (const space of uniqueSpaces) {
    const id = storedActive[space.id];
    const owned = tabs.filter((tab) => tab.spaceId === space.id);
    activeTabs[space.id] = owned.find((tab) => tab.id === id)?.id ?? owned.at(-1)?.id ?? null;
  }
  const activeSpaceId = typeof data.activeSpaceId === "string" && spaceIds.has(data.activeSpaceId) ? data.activeSpaceId : uniqueSpaces[0].id;
  return { tabs, spaces: uniqueSpaces, activeSpaceId, activeTabs, seq, folders };
}
