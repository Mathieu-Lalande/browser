import type { Session, WebContents, WebContentsView } from "electron";
import { INTERNAL_PAGES, internalPageOf, isInternalUrl } from "@shared/internal";
import type { CloseTabActivates, NewTabPosition } from "@shared/settings";
import type { TabId, TabState } from "@shared/types";
import type { TabTranslation } from "@shared/translate/state";
import { DEFAULT_SEARCH_ENGINE, displayUrl, type SearchEngine } from "@shared/url";
import type { InPageVisits } from "../activation";
import type { PageFind } from "../find";
import type { PageWheelSample } from "../page-swipe-script";
import type { MarkClick } from "../annotations/page";

export const START_TITLE = "Page d'accueil";

/** Closed tabs remembered per tab list for "Rouvrir l'onglet fermé". */
export const MAX_CLOSED_TABS = 25;

export type SleptHistory = { entries: Electron.NavigationEntry[]; index: number };

/** One tab of a TabManager: its UI state plus what main keeps about its page. */
export interface Tab {
  id: TabId;
  /**
   * Created on first load: start-page tabs and restored tabs that were never activated have
   * none. A tab with a URL but no view is "discarded": it loads when activated.
   */
  view: WebContentsView | null;
  state: TabState;
  /** Last URL reported to `onVisit`, to ignore in-page navigations that only change the hash. */
  lastVisit?: string;
  /** Set while a discarded tab loads its saved URL: reopening a tab is not a new visit. */
  waking?: string;
  /** Find in page, created with the view. */
  finder?: PageFind;
  /** Removes the listeners `TabEvents.wire` added (the tab moves to another TabManager). */
  unwire?: () => void;
  /** Epoch ms when the tab was last on screen (or created): its idle time for tab sleeping. */
  lastSeenAt: number;
  /** Back/forward entries of a tab put to sleep, restored when it wakes. */
  sleptHistory?: SleptHistory;
  /**
   * The start page or internal page the user left with Back to the live page kept below it:
   * Forward shows it again (until the page goes elsewhere).
   */
  forwardTo?: string;
  /** Favicon of the page kept below the start page or an internal page, for when Back shows it again. */
  parkedFavicon?: string | null;
  /** Rate limit of the in-page visits (pushState) recorded in the history. */
  inPageVisits: InPageVisits;
  /** Page + favicon candidates last fetched, so repeated `page-favicon-updated` events fetch nothing. */
  faviconKey?: string;
  /** Bumped on each favicon fetch and navigation: a late answer for an older page is dropped. */
  faviconSeq: number;
}

/** What a tab carries along to another TabManager, beyond its state and page. */
export type TabMemory = Pick<Tab, "lastVisit" | "waking" | "sleptHistory" | "forwardTo" | "parkedFavicon">;

/** A tab taken out of a TabManager (`release`) to be adopted by another one, live page included. */
export interface ReleasedTab {
  readonly state: TabState;
  readonly view: WebContentsView | null;
  readonly memory: TabMemory;
}

export interface TabManagerOptions {
  /** Session of the tabs' pages (default: the default session). Must be hardened (`hardenSession`). */
  session?: Session;
  /** A hidden manager (space not shown) attaches no view and loads nothing until shown. */
  visible?: boolean;
}

/** Optional integrations (history, bookmarks); TabManager itself does no persistence. */
export interface TabManagerHooks {
  /** A page was committed in a tab (full navigation, or an in-page one to a new URL). */
  onVisit?(url: string): void;
  /** The committed page reported its title or favicon. */
  onPageInfo?(url: string, info: { title?: string; favicon?: string | null }): void;
  isBookmarked?(url: string): boolean;
  /** Whether the URL is the site of one of the favorites (ADR-022). */
  isFavorite?(url: string): boolean;
  /** The user right-clicked the tab's page (native context menu, ADR-021). */
  contextMenu?(tabId: TabId, params: Electron.ContextMenuParams): void;
  /** A new document of the tab's page is ready (dom-ready): password form watching, ADR-025. */
  pageReady?(tabId: TabId, contents: WebContents): void;
  /** A new document is ready (dom-ready), private windows included: web notifications relay (ADR-041). */
  notifyPage?(tabId: TabId, contents: WebContents): void;
  /** A new document is ready (dom-ready), private windows included: boosts (ADR-029). */
  boostPage?(contents: WebContents): void;
  /** Saved passwords exist for the URL's origin (reading only: also in private windows). */
  hasPasswords?(url: string): boolean;
  /** A Shift+click on a link of the tab's page: preview it in the link peek (ADR-027). */
  peekLink?(tabId: TabId, url: string): void;
  /** A new document is ready (dom-ready): the page swipe's wheel watcher goes in (ADR-033). */
  gesturePage?(contents: WebContents): void;
  /** The page's wheel watcher reported a horizontal swipe event (ADR-033). */
  pageWheel?(tabId: TabId, sample: PageWheelSample): void;
  /** Ctrl+wheel or a pinch asks to zoom the page (paced by the window, ADR-033). */
  pageZoom?(tabId: TabId, direction: 1 | -1): void;
  /** A new document is ready (dom-ready): page translation reads its language (ADR-036). */
  translatePage?(tabId: TabId, contents: WebContents): void;
  /** What the UIs show about the tab's translation (ADR-036). */
  translation?(tabId: TabId): TabTranslation | null;
  /** A new document is ready (dom-ready): its highlights are drawn (ADR-037). */
  annotatePage?(tabId: TabId, contents: WebContents): void;
  /** A highlight of the page was clicked (reported by the annotator's isolated world, ADR-037). */
  annotationClick?(tabId: TabId, click: MarkClick): void;
  /** The page started or stopped playing media: the window's media hub follows it (ADR-035). */
  media?(tabId: TabId, contents: WebContents, playing: boolean): void;
}

/** User preferences TabManager follows (see `configure`). */
export interface TabOptions {
  searchEngine: SearchEngine;
  newTabPosition: NewTabPosition;
  closeTabActivates: CloseTabActivates;
  /** Corner radius of the page views, in px. */
  pageRadius: number;
  /** Zoom factor of sites never zoomed by hand. */
  defaultZoom: number;
}

export const DEFAULT_TAB_OPTIONS: TabOptions = {
  searchEngine: DEFAULT_SEARCH_ENGINE,
  newTabPosition: "end",
  closeTabActivates: "next",
  pageRadius: 10,
  defaultZoom: 1,
};

/** Whether a tab URL is a web page (vs the start page or an internal page drawn by the chrome UI). */
export const showsWebPage = (url: string) => url !== "" && !isInternalUrl(url);
/** A tab with a web address but no page: put to sleep, or restored and never shown yet. */
export const isDiscarded = (tab: Tab) => !tab.view && showsWebPage(tab.state.url);
export const withoutHash = (url: string) => url.split("#", 1)[0];

/** Title of a tab before its page reports one. */
export function defaultTitle(url: string): string {
  const page = internalPageOf(url);
  if (page) return INTERNAL_PAGES[page].title;
  return url ? displayUrl(url) : START_TITLE;
}

/**
 * The tab's page, unless it is gone: a page can close itself (`window.close()`), and a destroyed
 * webContents throws on any use. Such a tab is being removed (see `TabEvents`).
 */
export function liveContents(tab: Tab): WebContents | null {
  const contents = tab.view?.webContents;
  return contents && !contents.isDestroyed() ? contents : null;
}

/** The back/forward list of a tab's live web page, to bring it back later (sleep, duplicate, move). */
export function historyOf(tab: Tab): SleptHistory | undefined {
  const contents = liveContents(tab);
  if (!contents || !showsWebPage(tab.state.url) || tab.state.interstitial) return undefined;
  const history = contents.navigationHistory;
  return history.length() > 0 ? { entries: history.getAllEntries(), index: history.getActiveIndex() } : undefined;
}

/** Stops listening to a tab's page (it closes, sleeps or moves to another manager). */
export function unwire(tab: Tab): void {
  tab.unwire?.();
  tab.unwire = undefined;
}
