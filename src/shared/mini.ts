import type { Settings } from "./settings";
import type { ResolvedMode } from "./theme";
import type { Bounds } from "./types";

/**
 * Mini window (ADR-048): a link from another app shows in a small frameless window (its bar on
 * top, the page below) until the user moves it into a tab, or closes it (the page is discarded).
 * Pure layout and state, unit-tested.
 */

export const MINI_SIZE = { width: 900, height: 700, minWidth: 420, minHeight: 320 } as const;
/** Height of the mini window's bar (site, title, actions). */
export const MINI_BAR_HEIGHT = 40;
/** Margin around the page below the bar, and the page's corner radius. */
export const MINI_GUTTER = 6;
export const MINI_PAGE_RADIUS = 8;

export const MINI_ACTIONS = ["copy", "promote", "close", "pin", "reload"] as const;
export type MiniAction = (typeof MINI_ACTIONS)[number];

/** What the mini window's bar draws, pushed by main. */
export interface MiniState {
  url: string;
  title: string;
  /** The site's host name (what the bar shows first). */
  host: string;
  secure: boolean;
  isLoading: boolean;
  /** "Toujours au premier plan". */
  alwaysOnTop: boolean;
  /** The theme of the browser UIs. */
  settings: Settings;
  mode: ResolvedMode;
}

/** Where the bar and the page go in a window of `width` × `height` (content size). */
export function miniLayout(width: number, height: number): { bar: Bounds; page: Bounds } {
  const w = Math.max(0, Math.round(width));
  const h = Math.max(0, Math.round(height));
  return {
    bar: { x: 0, y: 0, width: w, height: Math.min(h, MINI_BAR_HEIGHT) },
    page: {
      x: MINI_GUTTER,
      y: MINI_BAR_HEIGHT,
      width: Math.max(0, w - 2 * MINI_GUTTER),
      height: Math.max(0, h - MINI_BAR_HEIGHT - MINI_GUTTER),
    },
  };
}

/** Whether links handed over by the OS open in a mini window: one web link, with the setting on. */
export function opensInMiniWindow(urls: readonly string[], enabled: boolean): boolean {
  return enabled && urls.length === 1 && /^https?:/i.test(urls[0]);
}

/** Mini window shortcuts: Ctrl+O (⌘O) moves the page into a tab, Ctrl+W (⌘W) closes. */
export function miniShortcut(input: { type: string; key: string; control: boolean; meta: boolean; alt: boolean; shift: boolean }, isMac: boolean): MiniAction | null {
  const primary = isMac ? input.meta && !input.control : input.control && !input.meta;
  if (input.type !== "keyDown" || !primary || input.alt || input.shift) return null;
  const key = input.key.toLowerCase();
  return key === "o" ? "promote" : key === "w" ? "close" : null;
}
