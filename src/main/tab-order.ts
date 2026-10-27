/**
 * Pinned tabs always sit before unpinned ones. Where a tab may go in a list, whatever index was
 * asked for: within the pinned group for a pinned tab, after it for an unpinned one.
 * `tabs` is the list without the tab being placed.
 */
export function tabSlot(tabs: readonly { pinned: boolean }[], pinned: boolean, index: number): number {
  const pinnedCount = tabs.filter((tab) => tab.pinned).length;
  const [min, max] = pinned ? [0, pinnedCount] : [pinnedCount, tabs.length];
  return Math.max(min, Math.min(Number.isFinite(index) ? Math.trunc(index) : max, max));
}
