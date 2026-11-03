import type { BrowserWindow, WebContents } from "electron";
import type { Bounds, OverlayRequest, TabId, TabState, TabsState } from "@shared/types";
import type { SessionWindow } from "./storage/session";

/**
 * Narrow views of a browser window (`BrowserController`) and its tabs (`TabManager`), listing only
 * what the services held by `AppServices` (boosts, captures, sync…) use. They are injected instead
 * of importing `window.ts`, so these modules stay out of its import graph (no cycle) and are
 * testable with fakes. `BrowserController` satisfies `WindowPort` structurally.
 */

/** The tabs of the space on screen. */
export interface TabPort {
  readonly activeTabId: TabId | null;
  /** Where the active page is drawn, in window coordinates. */
  readonly viewBounds: Bounds;
  getState(): TabsState;
  /** The page of a tab, null while it sleeps (or for an internal page). */
  pageOf(id: TabId): WebContents | null;
  create(input?: string, options?: { activate?: boolean }): TabId;
  activate(id: TabId): void;
}

/** The floating UI above the pages (popovers). */
export interface OverlayPort {
  open(request: OverlayRequest): void;
  close(): void;
}

/** Every space of a window. */
export interface SpacesPort {
  /** Re-sends the window's state to its UIs. */
  refresh(): void;
  allTabs(): { manager: Pick<TabPort, "pageOf">; tab: TabState }[];
  snapshot(): SessionWindow;
}

/** One browser window. */
export interface WindowPort {
  readonly isPrivate: boolean;
  readonly window: BrowserWindow;
  readonly tabs: TabPort;
  readonly overlay: OverlayPort;
  readonly spaces: SpacesPort;
  /** Pushes a message to the window's browser UIs (chrome and overlay). */
  send(channel: string, ...args: unknown[]): void;
}

/** The open windows (`BrowserController`'s registry). */
export interface WindowDirectory {
  all(): WindowPort[];
  focused(): WindowPort | undefined;
  /** Window of a chrome UI webContents (not the overlay). */
  fromChrome(contents: WebContents): WindowPort | undefined;
  /** Re-sends every window's state (bookmarks, favorites… changed). */
  refreshAll(): void;
}
