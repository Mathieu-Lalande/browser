import { randomUUID } from "node:crypto";
import { Menu } from "electron";
import { tabsToArchive, type ArchivedTab } from "@shared/archive";
import { favoriteTab, isFavoriteTab, isFavoriteUrl, matchesFavorite } from "@shared/favorites";
import type { FavoriteTile, TabId } from "@shared/types";
import { persistentWindows } from "./private-guards";
import { profile } from "./profile";
import { spaces } from "./spaces";
import type { BrowserController } from "./window";

/**
 * Organisation features of ADR-022 that span windows and spaces: the favorites grid (global,
 * synced) and tab auto-archiving. Folders live in each space's TabManager.
 */

// --- Favorites ---------------------------------------------------------------------------------

/** The grid as one window shows it: a tile is "open" when a tab of this window shows its site. */
export function favoriteTiles(c: BrowserController): FavoriteTile[] {
  const tabs = c.spaces.allTabs().map(({ tab }) => tab);
  return profile()
    .favorites.list()
    .map((favorite) => {
      const tab = favoriteTab(favorite.url, tabs);
      return { url: favorite.url, title: favorite.title, favicon: favorite.favicon ?? tab?.favicon ?? null, open: !!tab };
    });
}

let refresh: () => void = () => {};
/** Re-sends every window's state (set by window.ts, which imports this module). */
export function setFavoritesRefresh(callback: () => void): void {
  refresh = callback;
}

function favoritesChanged(): void {
  profile().saveFavorites();
  refresh();
}

/** Clicking a tile: the favorite's tab (this space first, then the others of the window), else a new tab. */
export function openFavorite(c: BrowserController, url: string, newTab = false): void {
  if (!profile().favorites.has(url)) return;
  const all = c.spaces.allTabs();
  const here = all.filter((entry) => entry.spaceId === c.spaces.activeSpaceId);
  const match = newTab ? undefined : (favoriteTab(url, here.map((entry) => entry.tab)) ?? favoriteTab(url, all.map((entry) => entry.tab)));
  const entry = match && all.find((candidate) => candidate.tab.id === match.id);
  if (entry) c.spaces.showTab(entry.spaceId, entry.tab.id);
  else c.tabs.create(url);
}

/** Adds the page of a tab of this window to the grid (at `index`). Refused from private windows (ADR-014). */
export function addFavoriteFromTab(c: BrowserController, tabId: TabId, index?: number): void {
  if (c.isPrivate) return;
  const tab = c.spaces.allTabs().find((entry) => entry.tab.id === tabId)?.tab;
  if (!tab || !isFavoriteUrl(tab.url)) return;
  if (profile().favorites.add({ url: tab.url, title: tab.title, favicon: tab.favicon }, Date.now(), index)) favoritesChanged();
}

export function removeFavorite(c: BrowserController, url: string): void {
  if (!c.isPrivate && profile().favorites.remove(url)) favoritesChanged();
}

export function moveFavorite(c: BrowserController, url: string, index: number): void {
  if (!c.isPrivate && profile().favorites.move(url, index)) favoritesChanged();
}

/** "Ajouter à / Retirer de la grille des favoris" for a tab: removes every favorite of its site, or adds it. */
export function toggleFavorite(c: BrowserController, tabId: TabId): void {
  if (c.isPrivate) return;
  const tab = c.spaces.allTabs().find((entry) => entry.tab.id === tabId)?.tab;
  if (!tab) return;
  const { favorites } = profile();
  const matching = favorites.list().filter((favorite) => isFavoriteTab(favorite.url, tab.url));
  if (matching.length) {
    for (const favorite of matching) favorites.remove(favorite.url);
    favoritesChanged();
  } else {
    addFavoriteFromTab(c, tabId);
  }
}

/** Remembers the favicon of a favorite's page when it shows up (never synced). */
export function favoriteFavicon(url: string, favicon: string | null | undefined): void {
  if (favicon && profile().favorites.setFavicon(url, favicon)) favoritesChanged();
}

/** Right-click on a tile. */
export function showFavoriteMenu(c: BrowserController, url: string): void {
  if (!profile().favorites.has(url)) return;
  Menu.buildFromTemplate([
    { id: "open", label: "Ouvrir", click: () => openFavorite(c, url) },
    { id: "open-new", label: "Ouvrir dans un nouvel onglet", click: () => openFavorite(c, url, true) },
    { type: "separator" },
    // A private window reads the grid but never edits it.
    { id: "remove", label: "Retirer de la grille des favoris", enabled: !c.isPrivate, click: () => removeFavorite(c, url) },
  ]).popup({ window: c.window });
}

// --- Auto-archiving ----------------------------------------------------------------------------

let notifyArchive: () => void = () => {};
/** Tells the browser UIs that the archive changed (set by window.ts). */
export function setArchiveNotifier(callback: () => void): void {
  notifyArchive = callback;
}

function archiveChanged(): void {
  profile().saveArchive();
  notifyArchive();
}

/**
 * Closes the tabs idle for longer than `idleMs` in the normal windows (never private ones) and
 * keeps them in the archive. Returns how many were archived.
 */
export function archiveIdleTabs(windows: readonly BrowserController[], idleMs: number, now = Date.now()): number {
  const favorites = profile().favorites.list();
  const archived: ArchivedTab[] = [];
  for (const c of persistentWindows(windows)) {
    for (const [spaceId, manager] of c.spaces.managerEntries()) {
      const candidates = manager.sleepCandidates(now).map((tab) => ({
        id: tab.id,
        url: tab.url ?? "",
        shown: tab.shown,
        pinned: tab.pinned,
        audible: tab.audible,
        inSplit: !!tab.inSplit,
        favorite: matchesFavorite(favorites, tab.url ?? ""),
        lastSeenAt: tab.lastSeenAt,
      }));
      const ids = tabsToArchive(candidates, { now, idleMs });
      if (!ids.length) continue;
      const { tabs } = manager.getState();
      for (const id of ids) {
        const tab = tabs.find((candidate) => candidate.id === id);
        if (!tab) continue;
        archived.push({ id: randomUUID(), url: tab.url, title: tab.title, favicon: tab.favicon, spaceId, archivedAt: now });
        manager.close(id);
      }
    }
  }
  if (archived.length) {
    profile().archive.add(archived);
    archiveChanged();
  }
  return archived.length;
}

/** Periodic archiving; the delay is read at each check (settings apply live). The timer never keeps the app alive. */
export function startTabArchiver(options: { windows(): BrowserController[]; idleMs(): number | null; checkMs: number }): () => void {
  const timer = setInterval(() => {
    const idleMs = options.idleMs();
    if (idleMs !== null) archiveIdleTabs(options.windows(), idleMs);
  }, options.checkMs);
  timer.unref();
  return () => clearInterval(timer);
}

/**
 * Restores an archived tab: in its space when this window has it, else in the space shown. A
 * private window opens it without touching the archive.
 */
export function restoreArchived(c: BrowserController, id: string): void {
  const entry = profile().archive.get(id);
  if (!entry) return;
  if (c.isPrivate) {
    c.tabs.create(entry.url);
    return;
  }
  if (entry.spaceId && entry.spaceId !== c.spaces.activeSpaceId && spaces.get(entry.spaceId)) c.spaces.openInSpace(entry.spaceId, entry.url);
  else c.tabs.create(entry.url);
  profile().archive.remove(id);
  archiveChanged();
}

export function removeArchived(c: BrowserController, id: string): void {
  if (!c.isPrivate && profile().archive.remove(id)) archiveChanged();
}

export function clearArchive(c: BrowserController): void {
  if (c.isPrivate) return;
  profile().archive.clear();
  archiveChanged();
}
