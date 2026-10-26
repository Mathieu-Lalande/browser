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
  /** Epoch milliseconds of the last activation (0: never active since the app started). */
  lastActiveAt: number;
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

/** The tabs of one space (what a TabManager owns). */
export interface TabsState {
  tabs: TabState[];
  activeTabId: TabId | null;
  /** Tabs shown side by side; visible while the active tab is one of them. */
  split: SplitState | null;
}

export interface BrowserState extends TabsState {
  /** Every space (shared by all windows); the window shows the tabs of `activeSpaceId`. */
  spaces: SpaceInfo[];
  activeSpaceId: SpaceId;
}

export type SpaceId = string;

/** A workspace: its own tabs, accent color and, when isolated, its own cookies and storage. */
export interface SpaceInfo {
  id: SpaceId;
  name: string;
  /** An emoji (or a short symbol). */
  icon: string;
  /** `#rrggbb` accent used while the space is shown; null keeps the theme accent. */
  color: string | null;
  /** Own session partition (separate logins, like containers) instead of the shared default one. */
  isolated: boolean;
}

/** Fields the chrome UI may set when creating or editing a space. */
export type SpaceInput = Partial<Omit<SpaceInfo, "id">>;

/**
 * 2 to 4 tabs shown side by side. Layout: two columns split at `ratioX`; with 3 tabs the right
 * column is split at `ratioY`, with 4 both columns are (2×2 grid).
 */
export interface SplitState {
  tabIds: TabId[];
  ratioX: number;
  ratioY: number;
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
