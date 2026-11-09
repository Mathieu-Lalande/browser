import { t } from "@shared/i18n";
import { Menu, type MenuItemConstructorOptions } from "electron";
import { folderDepth, type TabFolder } from "@shared/folders";
import { isFavoriteUrl } from "@shared/favorites";
import { MAX_SPLIT_TABS } from "@shared/split";
import type { TabId } from "@shared/types";
import { toggleFavorite } from "./organize";
import { sleepTabNow } from "./sleep";
import { spaces } from "./spaces";
import type { BrowserController } from "./window";

/** Tab context menu actions not already on TabManager, also callable directly (tests…). */
export const tabActions = {
  /** Closes the other unpinned tabs of the space. */
  closeOthers(c: BrowserController, tabId: TabId): void {
    for (const tab of c.tabs.getState().tabs) if (tab.id !== tabId && !tab.isPinned) c.tabs.close(tab.id);
  },
};

/**
 * The tab context menu, as a native menu: unlike the chrome UI, it can draw over the page view.
 * Built on demand from the current state, so its entries always match the tab.
 */
export function buildTabMenu(c: BrowserController, tabId: TabId): Menu | null {
  const { tabs, activeTabId, split, folders = [] } = c.tabs.getState();
  const tab = tabs.find((item) => item.id === tabId);
  if (!tab) return null;
  const inSplit = !!split?.tabIds.includes(tabId);
  const splitVisible = !!activeTabId && !!split?.tabIds.includes(activeTabId);
  // A private window has no other space to move tabs to.
  const others = c.isPrivate ? [] : spaces.list().filter((space) => space.id !== c.spaces.activeSpaceId);
  const canAddToSplit = tabId !== activeTabId && !(splitVisible && split!.tabIds.length >= MAX_SPLIT_TABS);

  const template: MenuItemConstructorOptions[] = [
    { id: "pin", label: tab.isPinned ? t("tabMenu.unpin") : t("tabMenu.pin"), click: () => c.tabs.togglePin(tabId) },
    { id: "duplicate", label: t("tabMenu.duplicate"), click: () => c.tabs.duplicate(tabId) },
    { type: "separator" },
    inSplit && splitVisible
      ? { id: "exit-split", label: t("tabMenu.leaveSplitView"), click: () => c.tabs.exitSplit() }
      : {
          id: "split",
          label: t("tabMenu.openSplitViewActive"),
          enabled: canAddToSplit,
          click: () => c.tabs.openSplit(tabId),
        },
    {
      id: "move",
      label: t("tabMenu.moveSpace"),
      enabled: others.length > 0,
      submenu: others.map((space) => ({
        id: `move-${space.id}`,
        label: space.name,
        click: () => c.spaces.moveTab(tabId, space.id),
      })),
    },
    { type: "separator" },
    {
      // Keyboard alternative to dragging the tab onto a folder (ADR-022).
      id: "move-folder",
      label: t("tabMenu.moveFolder"),
      enabled: !tab.isPinned && (folders.length > 0 || !!tab.folderId),
      submenu: [
        ...(tab.folderId ? [{ id: "folder-none", label: t("tabMenu.noFolder"), click: () => c.tabs.placeTab(tabId, null, null) }, { type: "separator" as const }] : []),
        ...folders.map((folder) => ({
          id: `folder-${folder.id}`,
          label: `${"    ".repeat(folderDepth(folders, folder.id) - 1)}${folder.name}`,
          type: "checkbox" as const,
          checked: folder.id === tab.folderId,
          click: () => c.tabs.placeTab(tabId, folder.id, null),
        })),
      ],
    },
    {
      id: "new-folder",
      label: t("tabMenu.newFolderTab"),
      enabled: !tab.isPinned,
      click: () => c.tabs.createFolder({}, tab.folderId && canNest(folders, tab.folderId) ? tab.folderId : null, [tabId]),
    },
    {
      id: "favorite",
      label: tab.isFavorite ? t("tabMenu.removeFromFavoritesAll") : t("tabMenu.addFavoritesAllSpaces"),
      // The grid is the profile's: read-only from a private window (ADR-014).
      enabled: !c.isPrivate && isFavoriteUrl(tab.url),
      click: () => toggleFavorite(c, tabId),
    },
    { type: "separator" },
    {
      id: "sleep",
      label: t("tabMenu.putSleep"),
      enabled: !tab.isAsleep && c.tabs.pageOf(tabId) !== null,
      click: () => void sleepTabNow(c.tabs, tabId),
    },
    { type: "separator" },
    { id: "close", label: t("tabMenu.close"), click: () => c.tabs.close(tabId) },
    {
      id: "close-others",
      label: t("tabMenu.closeOtherTabs"),
      enabled: tabs.some((other) => other.id !== tabId && !other.isPinned),
      click: () => tabActions.closeOthers(c, tabId),
    },
  ];
  return Menu.buildFromTemplate(template);
}

/** A new folder fits inside `parentId` (nesting limit). */
const canNest = (folders: readonly TabFolder[], parentId: string) => folderDepth(folders, parentId) < 4;

export function showTabMenu(c: BrowserController, tabId: TabId): void {
  buildTabMenu(c, tabId)?.popup({ window: c.window });
}
