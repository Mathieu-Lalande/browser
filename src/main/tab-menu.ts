import { Menu, type MenuItemConstructorOptions } from "electron";
import { MAX_SPLIT_TABS } from "@shared/split";
import type { TabId } from "@shared/types";
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
  const { tabs, activeTabId, split } = c.tabs.getState();
  const tab = tabs.find((item) => item.id === tabId);
  if (!tab) return null;
  const inSplit = !!split?.tabIds.includes(tabId);
  const splitVisible = !!activeTabId && !!split?.tabIds.includes(activeTabId);
  // A private window has no other space to move tabs to.
  const others = c.isPrivate ? [] : spaces.list().filter((space) => space.id !== c.spaces.activeSpaceId);
  const canAddToSplit = tabId !== activeTabId && !(splitVisible && split!.tabIds.length >= MAX_SPLIT_TABS);

  const template: MenuItemConstructorOptions[] = [
    { id: "pin", label: tab.isPinned ? "Désépingler" : "Épingler", click: () => c.tabs.togglePin(tabId) },
    { id: "duplicate", label: "Dupliquer", click: () => c.tabs.duplicate(tabId) },
    { type: "separator" },
    inSplit && splitVisible
      ? { id: "exit-split", label: "Quitter la vue scindée", click: () => c.tabs.exitSplit() }
      : {
          id: "split",
          label: "Ouvrir en vue scindée avec l'onglet actif",
          enabled: canAddToSplit,
          click: () => c.tabs.openSplit(tabId),
        },
    {
      id: "move",
      label: "Déplacer vers l'espace",
      enabled: others.length > 0,
      submenu: others.map((space) => ({
        id: `move-${space.id}`,
        label: space.name,
        click: () => c.spaces.moveTab(tabId, space.id),
      })),
    },
    {
      id: "sleep",
      label: "Mettre en veille",
      enabled: !tab.isAsleep && c.tabs.pageOf(tabId) !== null,
      click: () => void sleepTabNow(c.tabs, tabId),
    },
    { type: "separator" },
    { id: "close", label: "Fermer", click: () => c.tabs.close(tabId) },
    {
      id: "close-others",
      label: "Fermer les autres onglets",
      enabled: tabs.some((other) => other.id !== tabId && !other.isPinned),
      click: () => tabActions.closeOthers(c, tabId),
    },
  ];
  return Menu.buildFromTemplate(template);
}

export function showTabMenu(c: BrowserController, tabId: TabId): void {
  buildTabMenu(c, tabId)?.popup({ window: c.window });
}
