import { tabsToArchive, type ArchivedTab } from "@shared/archive";
import { matchesFavorite, type Favorite } from "@shared/favorites";
import { activeTab, isPrivateTab, type MobileTab, type TabsModel } from "./tabs";

/**
 * Phone side of ADR-022 that is not the reducer: auto-archiving of tabs (shared policy) and what
 * the overview pager needs. Pure.
 */

export const FAVORITES_VERSION = 1;
export const ARCHIVE_VERSION = 1;

/**
 * The tabs to archive now: never private tabs, the tab on screen, pinned tabs or favorites. The
 * phone does not know which page plays sound, and has no split view. A tab never activated since
 * it was opened in the background has no date (0) and is kept.
 */
export function mobileTabsToArchive(model: TabsModel, favorites: readonly Favorite[], idleMs: number, now: number): MobileTab[] {
  const shown = activeTab(model)?.id;
  const candidates = model.tabs
    .filter((tab) => !isPrivateTab(tab))
    .map((tab) => ({
      id: tab.id,
      url: tab.url,
      shown: tab.id === shown,
      pinned: tab.isPinned,
      audible: false,
      inSplit: false,
      favorite: matchesFavorite(favorites, tab.url),
      lastSeenAt: tab.lastActiveAt,
    }));
  const ids = new Set(tabsToArchive(candidates, { now, idleMs }));
  return model.tabs.filter((tab) => ids.has(tab.id));
}

/** Archive entries for tabs being closed. */
export function archiveEntries(tabs: readonly MobileTab[], now: number, newId: () => string): ArchivedTab[] {
  return tabs.map((tab) => ({ id: newId(), url: tab.url, title: tab.title, favicon: null, spaceId: tab.spaceId, archivedAt: now }));
}

/** Pages of the overview pager, in chip order: the private tabs first, then each space. */
export function pagerPages(model: TabsModel, privateId: string): string[] {
  return [privateId, ...model.spaces.map((space) => space.id)];
}
