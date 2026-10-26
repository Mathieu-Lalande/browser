import type { TabManager } from "./tabs";

/**
 * Split view shortcut: leaves the split when one is on screen; otherwise shows the active tab
 * side by side with the next tab of the space (a new start-page tab when it is alone).
 */
export function toggleSplit(tabs: TabManager): void {
  if (tabs.splitVisible) return tabs.exitSplit();
  const { tabs: list, activeTabId } = tabs.getState();
  const index = list.findIndex((tab) => tab.id === activeTabId);
  if (index === -1) return;
  const other = list.length > 1 ? list[(index + 1) % list.length].id : tabs.create("", { activate: false, index: index + 1 });
  tabs.openSplit(other);
}
