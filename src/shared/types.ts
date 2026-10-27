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
  /**
   * The tab's page is unloaded (put to sleep, or restored and not yet shown): it keeps its
   * url/title/favicon and reloads when activated (ADR-014).
   */
  isAsleep?: boolean;
  /** The page is playing sound (even if muted). */
  isAudible: boolean;
  isMuted: boolean;
  /** Page zoom in % (the site's remembered zoom, or the default zoom). */
  zoom: number;
  /** Find in page: null until the find bar was first opened in this tab (the query is kept per tab). */
  find: FindState | null;
  /**
   * The last popup the page tried to open without a user gesture (popup blocker, ADR-017), with
   * how many were blocked since the page loaded; null when none.
   */
  blockedPopup: { url: string; count: number } | null;
}

export interface FindState {
  /** The find bar is shown. */
  open: boolean;
  query: string;
  matchCase: boolean;
  /** Number of matches (0 when none, or before the first result). */
  matches: number;
  /** 1-based ordinal of the highlighted match, 0 when none. */
  activeMatch: number;
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
  /**
   * The tab's top-level origin, when the request comes from a frame of another origin: the bar
   * says "X (intégré dans Y)", and the decision only holds for X inside Y (ADR-017).
   */
  topOrigin?: string;
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
  /** A private window: one ephemeral space, in-memory session, nothing written to disk (ADR-014). */
  isPrivate?: boolean;
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
export type UiCommand = "focus-address" | "toggle-sidebar" | "focus-find";

/** Floating UI shown in the overlay layer, above the page (see `src/main/overlay.ts`). */
export type OverlayKind = "palette" | "downloads";

export interface OverlayRequest {
  kind: OverlayKind;
  /** Popovers: the chrome UI element they hang from, in window coordinates. */
  anchor?: Bounds;
}

/** Popovers stay light: no dimmed, blurred backdrop behind them (the palette has one). */
export const isPopover = (kind: OverlayKind) => kind === "downloads";

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
