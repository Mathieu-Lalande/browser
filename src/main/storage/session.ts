import { internalPageOf, internalUrl } from "@shared/internal";
import { isNavigableUrl } from "@shared/url";

export const SESSION_VERSION = 1;

/** What is needed to bring a tab back without loading it. */
export interface SessionTab {
  /** Empty string means the start page; `browser://…` an internal page. */
  url: string;
  title: string;
  favicon: string | null;
  pinned: boolean;
}

export interface SessionWindow {
  tabs: SessionTab[];
  activeIndex: number;
}

export interface Session {
  windows: SessionWindow[];
}

const MAX_TEXT = 2048;

function sanitizeTab(value: unknown): SessionTab | null {
  if (typeof value !== "object" || value === null) return null;
  const t = value as Record<string, unknown>;
  if (typeof t.url !== "string") return null;
  // Never restore something a tab could not have loaded in the first place (file:, javascript:…).
  const internal = internalPageOf(t.url);
  if (t.url !== "" && !internal && !isNavigableUrl(t.url)) return null;
  return {
    url: internal ? internalUrl(internal) : t.url,
    title: typeof t.title === "string" ? t.title.slice(0, MAX_TEXT) : "",
    favicon: typeof t.favicon === "string" && isNavigableUrl(t.favicon) ? t.favicon : null,
    pinned: t.pinned === true,
  };
}

function sanitizeWindow(value: unknown): SessionWindow | null {
  if (typeof value !== "object" || value === null) return null;
  const w = value as Record<string, unknown>;
  if (!Array.isArray(w.tabs)) return null;
  const valid = w.tabs.map((tab) => ({ tab: sanitizeTab(tab), original: tab }));
  const activeOriginal = typeof w.activeIndex === "number" ? w.tabs[w.activeIndex] : undefined;
  const kept = valid.filter((item): item is { tab: SessionTab; original: unknown } => item.tab !== null);
  if (kept.length === 0) return null;
  // Pinned tabs always lead, as in the live TabManager (stable sort keeps the rest in order).
  kept.sort((a, b) => Number(b.tab.pinned) - Number(a.tab.pinned));
  const activeIndex = Math.max(
    0,
    kept.findIndex((item) => item.original === activeOriginal),
  );
  return { tabs: kept.map((item) => item.tab), activeIndex };
}

/** Validates a stored session; unusable windows/tabs are dropped, a malformed root is corrupt. */
export function parseSession(data: unknown): Session | null {
  if (typeof data !== "object" || data === null) return null;
  const windows = (data as Record<string, unknown>).windows;
  if (!Array.isArray(windows)) return null;
  return { windows: windows.map(sanitizeWindow).filter((window) => window !== null) };
}
