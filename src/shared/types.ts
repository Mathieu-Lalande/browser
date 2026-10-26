export type TabId = string;

export interface TabState {
  id: TabId;
  /** Empty string means the built-in start page. */
  url: string;
  title: string;
  favicon: string | null;
  isLoading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  isPinned: boolean;
  /** Whether `url` is in the bookmarks. */
  isBookmarked: boolean;
  /** Epoch milliseconds of the last activation (0: never active since the app started). */
  lastActiveAt: number;
}

export interface BrowserState {
  tabs: TabState[];
  activeTabId: TabId | null;
}

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Commands triggered by main (menus, shortcuts) that the chrome UI must handle. */
export type UiCommand = "focus-address" | "toggle-sidebar";

/** Floating UI shown in the overlay layer, above the page (see `src/main/overlay.ts`). */
export type OverlayKind = "palette";

export interface OverlayRequest {
  kind: OverlayKind;
}

/**
 * A downscaled snapshot of what is below the overlay (chrome UI, then the active page at its
 * bounds), which the overlay blurs: CSS cannot blur native views behind a transparent page.
 */
export interface OverlayBackdrop {
  layers: { image: string; bounds: Bounds }[];
}

/** One history row per URL (visits are aggregated, not stored individually). */
export interface HistoryEntry {
  url: string;
  /** Empty until the page reports a title. */
  title: string;
  favicon: string | null;
  visitCount: number;
  /** Epoch milliseconds. */
  lastVisit: number;
}

export interface Bookmark {
  id: string;
  url: string;
  title: string;
  favicon: string | null;
  /** Epoch milliseconds. */
  createdAt: number;
  folderId?: string;
}

export interface BookmarkInput {
  url: string;
  title?: string;
  favicon?: string | null;
  folderId?: string;
}
