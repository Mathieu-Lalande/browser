import type { WebContents } from "electron";
import type { TabId } from "@shared/types";

/**
 * Tab sleeping (ADR-014): background tabs idle for a while lose their page (WebContentsView
 * destroyed) and keep url/title/favicon, like tabs restored from the session; they reload when
 * activated. This file holds the policy (pure, tested) and the scheduler; TabManager does the
 * discarding itself. No Electron import at runtime: it stays unit-testable.
 */

/** What the policy needs to know about a tab (see `TabManager.sleepCandidates`). */
export interface SleepCandidate {
  id: TabId;
  /** The tab has a live page (a view). Without one there is nothing to unload. */
  hasView: boolean;
  /** On screen: the active tab, or one of the tabs of a visible split, in the shown space. */
  shown: boolean;
  /** The page is playing sound. */
  audible: boolean;
  /** A permission prompt is waiting for the user in this tab. */
  permissionPending: boolean;
  /** DevTools are open on the page. */
  devTools: boolean;
  /** Epoch ms when the tab was last on screen (or created). */
  lastSeenAt: number;
  /** Pinned tabs may sleep too: they keep their place, only their page is unloaded. */
  pinned: boolean;
  /** The tab's address (auto-archiving, ADR-022). */
  url?: string;
  /** Part of a split view (never archived). */
  inSplit?: boolean;
}

export type SleepBlocker = "no-page" | "shown" | "audible" | "permission" | "devtools" | "recent";

export interface SleepContext {
  now: number;
  /** Idle time required before sleeping; null for a manual request (the user asked, no wait). */
  idleMs: number | null;
}

/** Why a tab must stay awake, or null when it may sleep. Unsaved form input is checked apart (async). */
export function sleepBlocker(tab: SleepCandidate, { now, idleMs }: SleepContext): SleepBlocker | null {
  if (!tab.hasView) return "no-page";
  if (tab.shown) return "shown";
  if (tab.audible) return "audible";
  if (tab.permissionPending) return "permission";
  if (tab.devTools) return "devtools";
  if (idleMs !== null && now - tab.lastSeenAt < idleMs) return "recent";
  return null;
}

/** Ids of the tabs that may sleep now, least recently seen first. */
export function tabsToSleep(tabs: readonly SleepCandidate[], context: SleepContext): TabId[] {
  return tabs
    .filter((tab) => sleepBlocker(tab, context) === null)
    .sort((a, b) => a.lastSeenAt - b.lastSeenAt)
    .map((tab) => tab.id);
}

/** How often the scheduler looks for idle tabs: a quarter of the delay, between 250 ms and a minute. */
export function sleepCheckInterval(idleMs: number): number {
  return Math.min(60_000, Math.max(250, Math.round(idleMs / 4)));
}

/** Isolated world of the unsaved-input check: the page can neither see nor tamper with it. */
const FORM_WORLD_ID = 1002;

/**
 * Read-only check, run once in an isolated world (no preload, nothing stays in the page, ADR-003):
 * does a field of the main document differ from its initial value, or is an editable area focused?
 * Frames are not inspected. Native DOM properties are the same in every world, so `value` and
 * `defaultValue` are the page's real ones.
 */
export const UNSAVED_INPUT_SCRIPT = `(() => {
  const skipped = new Set(["hidden", "submit", "button", "reset", "image", "file", "range", "color"]);
  for (const el of document.querySelectorAll("input, textarea, select")) {
    if (el.disabled || el.readOnly) continue;
    if (el instanceof HTMLSelectElement) {
      for (const option of el.options) if (option.selected !== option.defaultSelected) return true;
    } else if (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio")) {
      if (el.checked !== el.defaultChecked) return true;
    } else if (!(el instanceof HTMLInputElement && skipped.has(el.type)) && el.value !== el.defaultValue) {
      return true;
    }
  }
  return !!document.activeElement && document.activeElement.isContentEditable;
})()`;

const FORM_CHECK_TIMEOUT = 2_000;

/**
 * Whether the page holds input the user would lose. Errors and pages that do not answer in time
 * count as "yes": when in doubt, the tab stays awake.
 */
export async function hasUnsavedInput(contents: WebContents): Promise<boolean> {
  if (contents.isDestroyed()) return false;
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<boolean>((resolve) => (timer = setTimeout(() => resolve(true), FORM_CHECK_TIMEOUT)));
  try {
    const check = contents
      .executeJavaScriptInIsolatedWorld(FORM_WORLD_ID, [{ code: UNSAVED_INPUT_SCRIPT }])
      .then((result: unknown) => result !== false);
    return await Promise.race([check, timeout]);
  } catch {
    return true;
  } finally {
    clearTimeout(timer);
  }
}

/** The part of TabManager the sleeper drives. */
export interface SleepTarget {
  sleepCandidates(now: number): SleepCandidate[];
  pageOf(id: TabId): WebContents | null;
  discard(id: TabId): boolean;
  /** Shows another tab instead of `id` (false when there is none). */
  activateOther(id: TabId): boolean;
}

/**
 * "Mettre l'onglet en veille": the user asks for one tab, possibly the one on screen, which then
 * gives way to the most recently used other tab. Audio, a pending permission prompt, DevTools and
 * unsaved input still keep it awake. Resolves to whether the tab went to sleep.
 */
export async function sleepTabNow(target: SleepTarget, id: TabId): Promise<boolean> {
  const tab = target.sleepCandidates(Date.now()).find((candidate) => candidate.id === id);
  if (!tab || sleepBlocker({ ...tab, shown: false }, { now: Date.now(), idleMs: null })) return false;
  const page = target.pageOf(id);
  if (!page || (await hasUnsavedInput(page))) return false;
  const stillShown = target.sleepCandidates(Date.now()).find((candidate) => candidate.id === id)?.shown;
  if (stillShown && !target.activateOther(id)) return false;
  return target.discard(id);
}

/**
 * Puts tabs to sleep after checking each one for unsaved input. Returns the ids actually discarded.
 * `idleMs` null: a manual request, only the time condition is waived.
 */
export async function sleepTabs(target: SleepTarget, ids: readonly TabId[] | null, idleMs: number | null): Promise<TabId[]> {
  const now = Date.now();
  const candidates = target.sleepCandidates(now).filter((tab) => !ids || ids.includes(tab.id));
  const slept: TabId[] = [];
  for (const id of tabsToSleep(candidates, { now, idleMs })) {
    const page = target.pageOf(id);
    if (!page || (await hasUnsavedInput(page))) continue;
    // The tab may have been shown (or closed) while the check ran: `discard` checks again.
    if (target.discard(id)) slept.push(id);
  }
  return slept;
}

export interface SleeperOptions {
  /** Every tab list of every window (all spaces, shown or not). */
  targets(): SleepTarget[];
  /** Current idle delay, null when sleeping is off. */
  idleMs(): number | null;
}

/**
 * Periodic check, re-armed after each run with the current delay (settings apply live). The timer
 * never keeps the app alive.
 */
export function startTabSleeper(options: SleeperOptions): () => void {
  let timer: NodeJS.Timeout | undefined;
  let stopped = false;
  const arm = () => {
    if (stopped) return;
    const idleMs = options.idleMs();
    timer = setTimeout(() => void tick(), sleepCheckInterval(idleMs ?? 60_000));
    timer.unref();
  };
  const tick = async () => {
    const idleMs = options.idleMs();
    if (idleMs !== null) {
      for (const target of options.targets()) await sleepTabs(target, null, idleMs).catch(() => []);
    }
    arm();
  };
  arm();
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}
