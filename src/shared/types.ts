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
