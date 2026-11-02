import type { CloseTabActivates } from "./settings";

/**
 * Tab order rules shared by the desktop TabManager and the phone's tab model.
 *
 * Pinned tabs always sit before unpinned ones. Where a tab may go in a list, whatever index was
 * asked for: within the pinned group for a pinned tab, after it for an unpinned one.
 * `tabs` is the list without the tab being placed.
 */
export function tabSlot(tabs: readonly { pinned: boolean }[], pinned: boolean, index: number): number {
  const pinnedCount = tabs.filter((tab) => tab.pinned).length;
  const [min, max] = pinned ? [0, pinnedCount] : [pinnedCount, tabs.length];
  return Math.max(min, Math.min(Number.isFinite(index) ? Math.trunc(index) : max, max));
}

/** `tabs` in display order: pinned tabs first, then the others, each group in its own order. */
export function pinnedFirst<T>(tabs: readonly T[], isPinned: (tab: T) => boolean): T[] {
  return [...tabs.filter(isPinned), ...tabs.filter((tab) => !isPinned(tab))];
}

/**
 * The tab to activate once the active tab, formerly at `index`, is closed. `remaining` is the
 * list without it. "recent" asks `recent` first (the most recently used of `remaining`) and falls
 * back to "next": the tab that took its place, else the one before it.
 */
export function closeSuccessor<T>(
  remaining: readonly T[],
  index: number,
  activates: CloseTabActivates,
  recent?: (remaining: readonly T[]) => T | undefined,
): T | undefined {
  if (activates === "recent") {
    const found = recent?.(remaining);
    if (found) return found;
  }
  if (activates === "previous" && index > 0) return remaining[index - 1];
  return remaining[Math.min(index, remaining.length - 1)];
}
