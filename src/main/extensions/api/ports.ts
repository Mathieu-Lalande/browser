import type { Rectangle, Session, WebContents } from "electron";
import type { ActionState } from "@shared/extension-api";
import type { TabId } from "@shared/types";

/**
 * What the extension API bridge (ADR-053) needs from the browser windows: implemented over
 * `BrowserController` by `./browser.ts` and plugged in at startup, so that this service stays out
 * of `window.ts`'s import graph (CLAUDE.md: services get narrow ports). Normal windows only:
 * extensions never run in a private one (ADR-024, ADR-049).
 */
export interface BrowserTab {
  key: TabId;
  windowId: number;
  /** Position among the window's tabs (every space). */
  index: number;
  active: boolean;
  pinned: boolean;
  /** "" for the start page. */
  url: string;
  title: string;
  favicon: string | null;
  loading: boolean;
  /** Asleep (no page). */
  discarded: boolean;
  /** The live page, if any. */
  contents: WebContents | null;
  /** The session its pages use (where an extension may or may not be loaded). */
  session: Session;
}

export interface BrowserWindowInfo {
  id: number;
  focused: boolean;
  bounds: Rectangle;
  state: "normal" | "minimized" | "maximized" | "fullscreen";
}

export interface ExtensionBrowser {
  windows(): BrowserWindowInfo[];
  tabs(): BrowserTab[];
  /** The normal window used last. */
  lastFocusedWindow(): number | null;
  /** The window a context belongs to: a tab's page or a popup. */
  windowOf(contents: WebContents): number | null;
  /** The tab whose page `contents` is. */
  tabOf(contents: WebContents): TabId | null;
  /** `url` was checked by the caller; `extensionPage`: a `chrome-extension://` page of the calling extension. */
  createTab(windowId: number | null, url: string, options: { active: boolean; index?: number; extensionPage: boolean }): TabId | null;
  closeTab(key: TabId): void;
  navigateTab(key: TabId, url: string, extensionPage: boolean): void;
  activateTab(key: TabId): void;
  createWindow(url: string | null, extensionPage: boolean, focused: boolean): number | null;
  focusWindow(id: number): void;
  closeWindow(id: number): void;
  /** Tabs or windows changed (debounced by the caller). */
  onChange(listener: () => void): () => void;
  /** The toolbar buttons' states changed: every window's UI gets them. */
  pushActionStates(states: Record<string, ActionState>): void;
}
