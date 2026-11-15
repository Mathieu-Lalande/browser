/**
 * Smart preloading of sleeping tabs (ADR-057), pure: which sleeping tab is likely to be shown
 * next, and whether waking it in the background is worth it now. A tab asleep (ADR-014) reloads
 * when shown; waking the likely one a moment before (hovered in the sidebar, the next stop of
 * Ctrl+Tab, the tab the user keeps going back to) hides that reload. Bounded: one wake-up at a
 * time, never while saving energy or when memory is short, and a tab woken for nothing sleeps
 * again soon.
 */

/** Hovering a sleeping tab this long wakes it (shorter than the hover card's delay). */
export const PREWARM_HOVER_MS = 350;
/** After switching tabs, the likely next one waits this long (the user may keep switching). */
export const PREWARM_SETTLE_MS = 1_500;
/** A tab woken in the background and still not shown this long after goes back to sleep. */
export const PREWARM_TTL_MS = 2 * 60_000;
/** At most this many tabs load in the background at once. */
export const MAX_CONCURRENT_PREWARMS = 1;
/** A wake-up counts as "in flight" at most this long (a page that never stops loading). */
export const PREWARM_FLIGHT_MS = 15_000;
/** Memory is short when less than this share of the system's memory is free… */
export const LOW_MEMORY_RATIO = 0.1;
/** …or less than this much (KiB) in absolute terms. */
export const LOW_MEMORY_KB = 512 * 1024;

export type PrewarmReason = "hover" | "cycle" | "predicted";

/** What the policy knows about a tab of one tab list (a space of a window). */
export interface PrewarmTab {
  id: string;
  /** Asleep: a web page without a live view (only those are woken). */
  sleeping: boolean;
  /** On screen now. */
  shown: boolean;
  pinned: boolean;
  /** Epoch ms of its last activation (0: never). */
  lastActiveAt: number;
  /** How many times it was activated in this run. */
  activations: number;
}

export interface PrewarmConditions {
  /** "Précharger les onglets en veille" (settings). */
  enabled: boolean;
  /** Tabs sleep at all (a wake-up would otherwise never be undone). */
  sleeping: boolean;
  /** Energy saver on (ADR-048). */
  energySaver: boolean;
  /** System memory (KiB), when known. */
  memory: { freeKb: number; totalKb: number } | null;
  /** Wake-ups still loading. */
  inFlight: number;
}

export type PrewarmBlocker = "disabled" | "no-sleep" | "energy-saver" | "low-memory" | "busy";

/** Why nothing may be woken now, or null when one tab may. */
export function prewarmBlocker(conditions: PrewarmConditions): PrewarmBlocker | null {
  if (!conditions.enabled) return "disabled";
  if (!conditions.sleeping) return "no-sleep";
  if (conditions.energySaver) return "energy-saver";
  if (isMemoryLow(conditions.memory)) return "low-memory";
  if (conditions.inFlight >= MAX_CONCURRENT_PREWARMS) return "busy";
  return null;
}

export function isMemoryLow(memory: PrewarmConditions["memory"]): boolean {
  if (!memory || !(memory.totalKb > 0) || !Number.isFinite(memory.freeKb)) return false;
  return memory.freeKb < LOW_MEMORY_KB || memory.freeKb / memory.totalKb < LOW_MEMORY_RATIO;
}

/** The stop after the current one when cycling with Ctrl+Tab (`direction` 1) or Ctrl+Shift+Tab (-1), in sidebar order. */
export function nextInCycle(order: readonly string[], current: string | null, direction: 1 | -1): string | null {
  if (order.length < 2 || current === null) return null;
  const index = order.indexOf(current);
  if (index < 0) return null;
  return order[(index + direction + order.length) % order.length] ?? null;
}

/**
 * The tabs likely to be shown after `activeId`, most likely first (the active one excluded):
 * the one used just before (the user alternates between two tabs), the neighbours in the sidebar
 * (below first), then pinned and frequently used tabs. Scores add up; ties keep sidebar order.
 */
export function predictNextTabs(tabs: readonly PrewarmTab[], activeId: string | null, limit = 3): string[] {
  const index = tabs.findIndex((tab) => tab.id === activeId);
  const others = tabs.filter((tab) => tab.id !== activeId);
  if (!others.length) return [];
  const recent = [...others].sort((a, b) => b.lastActiveAt - a.lastActiveAt);
  const previous = recent[0]?.lastActiveAt ? recent[0].id : null;
  const maxActivations = Math.max(1, ...others.map((tab) => tab.activations));
  const score = (tab: PrewarmTab, position: number): number => {
    let value = 0;
    if (tab.id === previous) value += 3;
    if (index >= 0) {
      if (position === index + 1) value += 2;
      else if (position === index - 1) value += 1.5;
    }
    if (tab.pinned) value += 1;
    value += tab.activations / maxActivations;
    return value;
  };
  return tabs
    .map((tab, position) => ({ tab, position, value: tab.id === activeId ? -1 : score(tab, position) }))
    .filter((entry) => entry.value > 0)
    .sort((a, b) => b.value - a.value || a.position - b.position)
    .slice(0, limit)
    .map((entry) => entry.tab.id);
}

/** The first of `ids` worth waking: asleep and not on screen. */
export function prewarmTarget(tabs: readonly PrewarmTab[], ids: readonly string[]): string | null {
  for (const id of ids) {
    const tab = tabs.find((candidate) => candidate.id === id);
    if (tab?.sleeping && !tab.shown) return id;
  }
  return null;
}

/** Whether a tab woken at `wokenAt` and not shown since (`lastSeenAt`) should sleep again now. */
export const prewarmExpired = (wokenAt: number, lastSeenAt: number, shown: boolean, now: number, ttlMs = PREWARM_TTL_MS): boolean =>
  !shown && lastSeenAt <= wokenAt && now - wokenAt >= ttlMs;
