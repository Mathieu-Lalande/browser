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
  /** Requests blocked by the content blocker since the last main-frame navigation. */
  blockedCount: number;
  /** False when the user turned protections off for this site. */
  shieldsEnabled: boolean;
  /** The permission request waiting for an answer in this tab (oldest first), if any. */
  permissionRequest: PermissionPrompt | null;
  /** A built-in page the chrome UI renders instead of the web page (the view is detached). */
  interstitial: TabInterstitial | null;
}

/** Permissions a site can ask for; each one is decided (and remembered) separately per origin. */
export type PermissionKind =
  | "camera"
  | "microphone"
  | "geolocation"
  | "notifications"
  | "midi"
  | "midi-sysex"
  | "clipboard-read"
  | "display-capture"
  | "idle-detection"
  | "window-management"
  | "storage-access"
  | "local-fonts";

export interface PermissionPrompt {
  id: string;
  /** Origin asking, e.g. `https://meet.example.com`. */
  origin: string;
  kinds: PermissionKind[];
}

/** HTTPS-Only: the upgraded connection failed; `url` is the original http:// address. */
export interface TabInterstitial {
  kind: "https-only";
  url: string;
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
