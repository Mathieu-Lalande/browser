import { randomUUID } from "node:crypto";
import { powerMonitor } from "electron";
import {
  NO_FOCUS,
  SITE_TIME_VERSION,
  addSiteTime,
  focusBlocks,
  sanitizeSiteTime,
  startFocus,
  summarizeSiteTime,
  type FocusState,
  type SiteTime,
  type SiteTimeSummary,
} from "@shared/focus";
import {
  SAVED_SESSIONS_VERSION,
  addSavedSession,
  createSavedSession,
  removeSavedSession,
  sanitizeSavedSessions,
  summarizeSession,
  type SavedSession,
  type SavedSessionSummary,
} from "@shared/saved-sessions";
import type { WindowDirectory, WindowPort } from "./ports";
import { settings } from "./settings";
import { ProfileDoc } from "./storage/profile-doc";

/**
 * "Concentration" (ADR-059): focus sessions (held sites show an interstitial in their tab), the
 * local time per site, and named sessions. Focus state lives in memory (a quit ends the session).
 * Time per site counts the active tab of the focused normal window, every `TICK_MS`, when the
 * system is not idle; nothing for private windows; `site-time.json`, 30 days.
 */

const TICK_MS = 15_000;
const IDLE_SECONDS = 120;

let focus: FocusState = NO_FOCUS;
let focusTimer: ReturnType<typeof setTimeout> | null = null;
let directory: WindowDirectory | null = null;

const siteTime = new ProfileDoc<SiteTime>("site-time.json", SITE_TIME_VERSION, sanitizeSiteTime, () => ({}));
const sessions = new ProfileDoc<SavedSession[]>("sessions.json", SAVED_SESSIONS_VERSION, sanitizeSavedSessions, () => []);

export const focusState = (): FocusState => (focus.until && focus.until > Date.now() ? focus : NO_FOCUS);

/** Whether a tab navigation to `url` is held by the focus session. */
export const focusHolds = (url: string): boolean => focusBlocks(focus, settings().focus.sites, url, Date.now());

export function setFocus(minutes: number | null): FocusState {
  if (focusTimer) clearTimeout(focusTimer);
  focusTimer = null;
  focus = minutes ? startFocus(minutes, Date.now()) : NO_FOCUS;
  if (focus.until) focusTimer = setTimeout(() => setFocus(null), focus.until - Date.now());
  directory?.refreshAll();
  return focus;
}

// --- Time per site --------------------------------------------------------------------------

let last = 0;

function tick(): void {
  const now = Date.now();
  const elapsed = last ? now - last : 0;
  last = now;
  if (!elapsed || powerMonitor.getSystemIdleTime() > IDLE_SECONDS) return;
  const window = directory?.focused();
  if (!window || window.isPrivate || !window.window.isFocused()) return;
  const tab = window.tabs.getState().tabs.find((entry) => entry.id === window.tabs.activeTabId);
  if (!tab) return;
  try {
    const { protocol, hostname } = new URL(tab.url);
    if (protocol === "http:" || protocol === "https:") siteTime.set(addSiteTime(siteTime.get(), hostname, elapsed, now));
  } catch {
    // The start page or an internal page: not a site.
  }
}

export const siteTimeSummary = (days = 7): SiteTimeSummary => summarizeSiteTime(siteTime.get(), Date.now(), days);

export function clearSiteTime(): void {
  siteTime.set({});
}

// --- Named sessions -------------------------------------------------------------------------

export const listSessions = (): SavedSessionSummary[] => sessions.get().map(summarizeSession);

/** Keeps the web pages of the window's space shown under `name`; null in a private window or with nothing to keep. */
export function saveSession(window: WindowPort, name: string): SavedSessionSummary[] | null {
  if (window.isPrivate) return null;
  const tabs = window.tabs.getState().tabs.map(({ url, title }) => ({ url, title }));
  const session = createSavedSession(randomUUID().slice(0, 12), name, tabs, Date.now());
  if (!session) return null;
  sessions.set(addSavedSession(sessions.get(), session));
  return listSessions();
}

export const removeSession = (id: string): SavedSessionSummary[] => {
  sessions.set(removeSavedSession(sessions.get(), id));
  return listSessions();
};

export const sessionTabs = (id: string) => sessions.get().find((session) => session.id === id) ?? null;

/** Starts the time-per-site ticker (once, at startup). */
export function startWellbeing(windows: WindowDirectory): void {
  if (directory) return;
  directory = windows;
  setInterval(tick, TICK_MS).unref?.();
}
