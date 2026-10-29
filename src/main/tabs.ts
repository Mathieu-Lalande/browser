import { randomUUID } from "node:crypto";
import { WebContentsView, session as electronSession, type BaseWindow, type Session, type WebContents } from "electron";
import {
  addFolder,
  moveFolder,
  placeTab,
  removeFolder,
  updateFolder,
  visualOrder,
  type FolderId,
  type FolderInput,
  type TabFolder,
} from "@shared/folders";
import { INTERNAL_PAGES, internalPageOf, internalUrl, isInternalUrl, type InternalPage } from "@shared/internal";
import type { CloseTabActivates, NewTabPosition } from "@shared/settings";
import { clampRatio, splitLayout, splitWith, splitWithout } from "@shared/split";
import type { Bounds, SplitState, TabId, TabState, TabsState } from "@shared/types";
import { storableFavicon } from "@shared/favicon";
import { DEFAULT_SEARCH_ENGINE, displayUrl, isPageOpenableUrl, normalizeInput, type SearchEngine } from "@shared/url";
import { InPageVisits } from "./activation";
import { loadFavicon } from "./favicons";
import {
  allowHttp,
  attachTabPrivacy,
  httpsFallbackFor,
  onShieldsChange,
  respondPermission,
  setShieldsEnabled,
  shieldsEnabledFor,
} from "./privacy";
import { PageFind } from "./find";
import { mobileUserAgent } from "./fingerprint";
import { isPageReaderable } from "./reader/page";
import { togglePictureInPicture } from "./media";
import { webHostname } from "@shared/hosts";
import { hardenWebContents } from "./security";
import type { SleepCandidate } from "./sleep";
import type { SessionTab, SessionTabList } from "./storage/session";
import { tabSlot } from "./tab-order";
import { onSiteZoomChange, rememberSiteZoom, siteZoomFactor } from "./zoom";
import { nextZoomFactor, sameFactor } from "./zoom/levels";

const START_TITLE = "Page d'accueil";

interface Tab {
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
  /** Removes the listeners `wire` added (the tab moves to another TabManager). */
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

type SleptHistory = { entries: Electron.NavigationEntry[]; index: number };

/** What a tab carries along to another TabManager, beyond its state and page. */
type TabMemory = Pick<Tab, "lastVisit" | "waking" | "sleptHistory" | "forwardTo" | "parkedFavicon">;

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
  /** A new document is ready (dom-ready), private windows included: boosts (ADR-029). */
  boostPage?(contents: WebContents): void;
  /** Saved passwords exist for the URL's origin (reading only: also in private windows). */
  hasPasswords?(url: string): boolean;
  /** A Shift+click on a link of the tab's page: preview it in the link peek (ADR-027). */
  peekLink?(tabId: TabId, url: string): void;
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

const DEFAULT_TAB_OPTIONS: TabOptions = {
  searchEngine: DEFAULT_SEARCH_ENGINE,
  newTabPosition: "end",
  closeTabActivates: "next",
  pageRadius: 10,
  defaultZoom: 1,
};

/** Whether a tab URL is a web page (vs the start page or an internal page drawn by the chrome UI). */
const showsWebPage = (url: string) => url !== "" && !isInternalUrl(url);
const isDiscarded = (tab: Tab) => !tab.view && showsWebPage(tab.state.url);
const withoutHash = (url: string) => url.split("#", 1)[0];

/**
 * The tab's page, unless it is gone: a page can close itself (`window.close()`), and a destroyed
 * webContents throws on any use. Such a tab is being removed (see `wire`).
 */
function liveContents(tab: Tab): WebContents | null {
  const contents = tab.view?.webContents;
  return contents && !contents.isDestroyed() ? contents : null;
}

/** The back/forward list of a tab's live web page, to bring it back later (sleep, duplicate, move). */
function historyOf(tab: Tab): SleptHistory | undefined {
  const contents = liveContents(tab);
  if (!contents || !showsWebPage(tab.state.url) || tab.state.interstitial) return undefined;
  const history = contents.navigationHistory;
  return history.length() > 0 ? { entries: history.getAllEntries(), index: history.getActiveIndex() } : undefined;
}

/** Pinned flags of a tab list, for `tabSlot`. */
const pinnedFlags = (tabs: readonly Tab[]) => tabs.map((tab) => ({ pinned: tab.state.isPinned }));

/**
 * Owns the web pages of one space of one window: each tab is a sandboxed WebContentsView that is
 * attached to the window only while it is the active tab (or one of the tabs of a visible split).
 */
export class TabManager {
  private tabs: Tab[] = [];
  private activeId: TabId | null = null;
  private bounds: Bounds = { x: 0, y: 0, width: 0, height: 0 };
  private attached = new Set<WebContentsView>();
  private split: SplitState | null = null;
  /** Sidebar folders of this space (ADR-022); tabs point to them with `state.folderId`. */
  private folders: TabFolder[] = [];
  private visible: boolean;
  private session: Session | undefined;
  private emitScheduled = false;
  private readonly unsubscribeShields: () => void;
  private readonly unsubscribeZoom: () => void;
  private options: TabOptions = { ...DEFAULT_TAB_OPTIONS };
  /** Tab ids, least recently activated first (for "close → back to the last used tab"). */
  private recent: TabId[] = [];

  constructor(
    private readonly window: BaseWindow,
    private readonly onChange: (state: TabsState) => void,
    private readonly hooks: TabManagerHooks = {},
    options: TabManagerOptions = {},
  ) {
    this.session = options.session;
    this.visible = options.visible ?? true;
    // Shields toggled for a site (from any window) apply to every tab showing it.
    this.unsubscribeShields = onShieldsChange(() => {
      for (const tab of this.tabs) tab.state.shieldsEnabled = shieldsEnabledFor(tab.state.url, this.session);
      this.emit();
    });
    // A site zoomed (from any window): its other tabs follow.
    this.unsubscribeZoom = onSiteZoomChange((host) => {
      for (const tab of this.tabs) if (webHostname(liveContents(tab)?.getURL() ?? "") === host) this.applyZoom(tab);
    });
  }

  getState(): TabsState {
    return {
      tabs: this.tabs.map((tab) => ({
        ...tab.state,
        isBookmarked: this.isBookmarked(tab.state.url),
        isFavorite: tab.state.url !== "" && (this.hooks.isFavorite?.(tab.state.url) ?? false),
        isAsleep: isDiscarded(tab),
        hasPasswords: showsWebPage(tab.state.url) && (this.hooks.hasPasswords?.(tab.state.url) ?? false),
        reader: this.showsReader(tab),
      })),
      activeTabId: this.activeId,
      split: this.split && { ...this.split, tabIds: [...this.split.tabIds] },
      folders: this.folders.map((folder) => ({ ...folder })),
    };
  }

  /** Updates preferences; already open page views pick up the new radius right away. */
  configure(options: Partial<TabOptions>): void {
    const radiusChanged = options.pageRadius !== undefined && options.pageRadius !== this.options.pageRadius;
    const zoomChanged = options.defaultZoom !== undefined && !sameFactor(options.defaultZoom, this.options.defaultZoom);
    this.options = { ...this.options, ...options };
    if (radiusChanged) for (const tab of this.tabs) tab.view?.setBorderRadius(this.options.pageRadius);
    if (zoomChanged) for (const tab of this.tabs) this.applyZoom(tab);
  }

  create(input = "", options: { activate?: boolean; index?: number; folderId?: FolderId | null } = {}): TabId {
    const folderId = options.folderId && this.folders.some((folder) => folder.id === options.folderId) ? options.folderId : undefined;
    const tab = this.insert({ url: "", title: START_TITLE, favicon: null, pinned: false, folderId }, options.index ?? this.newTabIndex());
    if (folderId) this.reorder();
    if (options.activate ?? true) this.activate(tab.id);
    this.navigate(tab.id, input);
    this.emit();
    return tab.id;
  }

  /**
   * Brings back a saved window. Tabs are restored discarded (url, title and favicon only):
   * just the active one loads now, the others on first activation.
   */
  restore(saved: SessionTabList): void {
    this.folders = (saved.folders ?? []).map((folder) => ({ ...folder }));
    const restored = saved.tabs.map((entry) => this.insert(entry, this.tabs.length));
    if (saved.split) {
      const tabIds = saved.split.tabIndexes.map((index) => restored[index]?.id).filter((id) => id !== undefined);
      if (tabIds.length >= 2) this.split = { tabIds, ratioX: clampRatio(saved.split.ratioX), ratioY: clampRatio(saved.split.ratioY) };
    }
    // Pinned tabs always sit before unpinned ones.
    this.tabs.sort((a, b) => Number(b.state.isPinned) - Number(a.state.isPinned));
    const active = this.tabs[saved.activeIndex] ?? this.tabs[0];
    this.reorder();
    if (active) this.activate(active.id);
    else this.create();
  }

  /** What to save to restore this window later. */
  snapshot(): SessionTabList {
    const indexOf = (id: TabId) => this.tabs.findIndex((tab) => tab.id === id);
    return {
      // Only small data: favicons go to session.json (ADR-018).
      tabs: this.tabs.map(({ state, lastSeenAt }) => {
        const tab: SessionTab = { url: state.url, title: state.title, favicon: storableFavicon(state.favicon), pinned: state.isPinned };
        if (state.folderId) tab.folderId = state.folderId;
        // Tabs on screen are being seen right now (auto-archiving counts from when they left it).
        tab.lastSeenAt = this.visible && this.shownTabs().some((shown) => shown.state.id === state.id) ? Date.now() : lastSeenAt;
        return tab;
      }),
      activeIndex: Math.max(0, indexOf(this.activeId ?? "")),
      split: this.split && { tabIndexes: this.split.tabIds.map(indexOf), ratioX: this.split.ratioX, ratioY: this.split.ratioY },
      ...(this.folders.length ? { folders: this.folders.map((folder) => ({ ...folder })) } : {}),
    };
  }

  // --- Folders (ADR-022, model in @shared/folders) --------------------------------------------

  /**
   * Creates a folder (in `parentId`, or at the root), optionally moving tabs into it. Returns its
   * id, or null at the limit / too deep.
   */
  createFolder(input: FolderInput = {}, parentId: FolderId | null = null, tabIds: readonly TabId[] = []): FolderId | null {
    const id = randomUUID();
    const next = addFolder(this.folders, id, parentId, input);
    if (!next) return null;
    this.folders = next;
    for (const tabId of tabIds) this.placeTab(tabId, id, null);
    this.reorder();
    this.emit();
    return id;
  }

  updateFolder(id: FolderId, input: FolderInput): void {
    if (!this.folders.some((folder) => folder.id === id)) return;
    this.folders = updateFolder(this.folders, id, input);
    this.emit();
  }

  /** Deletes a folder and its sub-folders; their tabs are closed, or go back to the parent container. */
  removeFolder(id: FolderId, closeTabs: boolean): void {
    const parentId = this.folders.find((folder) => folder.id === id)?.parentId ?? null;
    const { folders, removed } = removeFolder(this.folders, id);
    if (!removed.size) return;
    this.folders = folders;
    const filed = this.tabs.filter((tab) => tab.state.folderId && removed.has(tab.state.folderId));
    for (const tab of filed) tab.state.folderId = parentId;
    this.reorder();
    if (closeTabs) for (const tab of filed) this.close(tab.id);
    this.emit();
  }

  moveFolder(id: FolderId, parentId: FolderId | null, index: number): void {
    this.folders = moveFolder(this.folders, id, parentId, index);
    this.reorder();
    this.emit();
  }

  /** Moves a tab into a folder (null: the root), before `beforeId` or at the end of it. */
  placeTab(tabId: TabId, folderId: FolderId | null, beforeId: TabId | null): void {
    const items = this.tabs.map((tab) => ({ id: tab.id, pinned: tab.state.isPinned, folderId: tab.state.folderId ?? null }));
    const placed = placeTab(items, this.folders, tabId, folderId, beforeId);
    const byId = new Map(this.tabs.map((tab) => [tab.id, tab]));
    this.tabs = placed.map((item) => {
      const tab = byId.get(item.id)!;
      tab.state.folderId = item.folderId;
      return tab;
    });
    this.emit();
  }

  /** Keeps the flat list in the order the sidebar shows (Ctrl+Tab follows the screen). */
  private reorder(): void {
    const items = this.tabs.map((tab) => ({ id: tab.id, pinned: tab.state.isPinned, folderId: tab.state.folderId ?? null }));
    const byId = new Map(this.tabs.map((tab) => [tab.id, tab]));
    this.tabs = visualOrder(items, this.folders).map((item) => byId.get(item.id)!);
  }

  /** Re-sends the state, e.g. after a bookmark change that affects `isBookmarked`. */
  refresh(): void {
    this.emit();
  }

  close(id: TabId): void {
    const tab = this.remove(id);
    if (!tab) return;
    tab.unwire?.();
    tab.unwire = undefined;
    liveContents(tab)?.close();
  }

  /**
   * Takes a tab out of this manager without closing its page, for `adopt` by another manager
   * (moving a tab to another space).
   */
  release(id: TabId): ReleasedTab | null {
    const tab = this.remove(id);
    if (!tab) return null;
    tab.unwire?.();
    tab.unwire = undefined;
    const { lastVisit, waking, sleptHistory, forwardTo, parkedFavicon } = tab;
    return { state: tab.state, view: liveContents(tab) ? tab.view : null, memory: { lastVisit, waking, sleptHistory, forwardTo, parkedFavicon } };
  }

  /**
   * Adds a tab released by another manager. Its live page is kept when it already uses this
   * manager's session; otherwise it is closed and the tab comes back discarded (reloads here).
   */
  adopt(released: ReleasedTab, options: { activate?: boolean; index?: number } = {}): TabId {
    const { state } = released;
    const tab: Tab = {
      ...released.memory,
      id: state.id,
      view: released.view,
      // Folders belong to a space: the tab arrives at the root.
      state: { ...state, folderId: null },
      lastSeenAt: Date.now(),
      inPageVisits: new InPageVisits(),
      faviconSeq: 0,
    };
    const contents = liveContents(tab);
    if (contents && contents.session !== this.sessionOf()) {
      // The page reloads in this manager's session, with its back/forward list (like a sleeping tab).
      tab.sleptHistory = historyOf(tab) ?? tab.sleptHistory;
      contents.close();
      tab.view = null;
    }
    const { view } = tab;
    if (!view) {
      tab.forwardTo = undefined;
      Object.assign(tab.state, { isLoading: false, canGoBack: false, canGoForward: false, blockedCount: 0, permissionRequest: null, interstitial: null, loadError: null });
    } else {
      view.setBorderRadius(this.options.pageRadius);
    }
    this.tabs.splice(tabSlot(pinnedFlags(this.tabs), state.isPinned, options.index ?? this.tabs.length), 0, tab);
    if (view) this.wire(tab, view.webContents);
    // A manager always has an active tab once it has tabs.
    if (options.activate || !this.activeId) this.activate(tab.id);
    this.emit();
    return tab.id;
  }

  activate(id: TabId): void {
    const tab = this.find(id);
    if (!tab) return;
    this.markSeen();
    this.activeId = id;
    tab.state.lastActiveAt = Date.now();
    this.recent = [...this.recent.filter((recentId) => recentId !== id), id];
    if (this.visible) for (const shown of this.shownTabs()) this.wake(shown);
    this.syncAttachment();
    this.emit();
  }

  /** Shows (space switched to) or hides this manager's pages. Showing loads the active tab if needed. */
  setVisible(visible: boolean): void {
    if (this.visible === visible) return;
    this.markSeen();
    this.visible = visible;
    if (visible && this.activeId) this.activate(this.activeId);
    else this.syncAttachment();
  }

  /**
   * Moves every tab to another session (a space became isolated or shared again): pages are closed
   * and reload in the new session, the visible ones right away, the others when activated.
   */
  setSession(session: Session | undefined): void {
    if (session === this.session) return;
    this.session = session;
    this.detach();
    for (const tab of this.tabs) {
      if (!tab.view) continue;
      tab.unwire?.();
      tab.unwire = undefined;
      liveContents(tab)?.close();
      tab.view = null;
      tab.forwardTo = undefined;
      Object.assign(tab.state, { isLoading: false, canGoBack: false, canGoForward: false, blockedCount: 0, permissionRequest: null });
    }
    if (this.activeId) this.activate(this.activeId);
  }

  /** "Ouvrir en vue scindée avec l'onglet actif": shows `id` next to the active tab (or adds it to its split). */
  openSplit(id: TabId): boolean {
    if (!this.find(id)) return false;
    const split = splitWith(this.split, this.activeId, id);
    if (!split) return false;
    this.split = split;
    if (this.activeId) this.activate(this.activeId);
    return true;
  }

  /** Leaves split view: the active tab stays, alone. */
  exitSplit(): void {
    if (!this.split) return;
    this.markSeen();
    this.split = null;
    this.syncAttachment();
    this.emit();
  }

  /** Divider positions (from the chrome UI's drag), 0…1 each, clamped. */
  setSplitRatios(ratioX: number, ratioY: number): void {
    if (!this.split) return;
    this.split = { ...this.split, ratioX: clampRatio(ratioX), ratioY: clampRatio(ratioY) };
    this.layout();
    this.emit();
  }

  /** Whether the split is on screen (the active tab is one of its tabs). */
  get splitVisible(): boolean {
    return !!this.activeId && !!this.split?.tabIds.includes(this.activeId);
  }

  navigate(id: TabId, input: string): void {
    const tab = this.find(id);
    if (!tab) return;
    const url = normalizeInput(input, this.options.searchEngine);
    const wasWebPage = showsWebPage(tab.state.url);
    tab.state.url = url;
    tab.state.interstitial = null;
    tab.state.loadError = null;
    tab.state.shieldsEnabled = shieldsEnabledFor(url, this.session);
    tab.forwardTo = undefined;
    if (!showsWebPage(url)) {
      // Start page or internal page: drawn by the chrome UI. The page view (if any) is parked:
      // detached but kept with its history, so that Back shows it again as it was.
      const page = internalPageOf(url);
      if (wasWebPage) tab.parkedFavicon = tab.state.favicon;
      tab.state.title = page ? INTERNAL_PAGES[page].title : START_TITLE;
      tab.state.favicon = null;
      tab.state.isLoading = false;
      liveContents(tab)?.stop();
    } else {
      tab.state.title = displayUrl(url);
      this.ensureView(tab).webContents.loadURL(url).catch(() => {
        // Load failures are reported through did-fail-load.
      });
    }
    this.updateHistory(tab);
    this.syncAttachment();
    this.emit();
  }

  /** Back: in the page's history, or from the start page / an internal page to the page parked below it. */
  back(id: TabId): void {
    const tab = this.find(id);
    const contents = tab && liveContents(tab);
    if (!tab || !contents) return;
    if (showsWebPage(tab.state.url)) contents.navigationHistory.goBack();
    else if (contents.getURL()) this.unpark(tab, contents);
  }

  /** Forward: to the start page / internal page left with Back, else in the page's history. */
  forward(id: TabId): void {
    const tab = this.find(id);
    if (!tab) return;
    if (tab.forwardTo !== undefined && showsWebPage(tab.state.url)) this.navigate(id, tab.forwardTo);
    else liveContents(tab)?.navigationHistory.goForward();
  }

  reload(id: TabId): void {
    const tab = this.find(id);
    if (!tab || !showsWebPage(tab.state.url)) return;
    const contents = liveContents(tab);
    if (contents) contents.reload();
    else this.wake(tab);
  }

  stop(id: TabId): void {
    const tab = this.find(id);
    if (tab) liveContents(tab)?.stop();
  }

  togglePin(id: TabId): void {
    const tab = this.find(id);
    if (!tab) return;
    tab.state.isPinned = !tab.state.isPinned;
    // A pinned tab leaves its folder.
    if (tab.state.isPinned) tab.state.folderId = null;
    // Pinned tabs always sit before unpinned ones: the tab joins the end of its new group.
    const index = this.tabs.indexOf(tab);
    this.tabs.splice(index, 1);
    this.tabs.splice(tabSlot(pinnedFlags(this.tabs), tab.state.isPinned, tab.state.isPinned ? this.tabs.length : 0), 0, tab);
    this.reorder();
    this.emit();
  }

  /**
   * Opens a copy of a tab right after it (after the pinned tabs, as copies are not pinned),
   * with its back/forward history, and activates it.
   */
  duplicate(id: TabId): TabId | undefined {
    const source = this.find(id);
    if (!source) return undefined;
    const { url, title, favicon } = source.state;
    const copy = this.insert({ url, title, favicon, pinned: false, folderId: source.state.folderId ?? undefined }, this.tabs.indexOf(source) + 1);
    const history = historyOf(source);
    if (history) {
      const view = this.ensureView(copy);
      // Like waking a restored tab: reopening a page is not a new visit.
      copy.waking = url;
      view.webContents.navigationHistory.restore(history).catch(() => view.webContents.loadURL(url).catch(() => {}));
    } else if (isDiscarded(source) && source.sleptHistory) {
      // A sleeping source: the copy sleeps too, with the same back/forward list.
      copy.sleptHistory = { entries: [...source.sleptHistory.entries], index: source.sleptHistory.index };
    }
    // Without a live source page (start page, discarded tab) the copy loads on activation, like a restored tab.
    this.activate(copy.id);
    return copy.id;
  }

  /**
   * Zooms the tab's page one step in (1) or out (-1), or back to the default zoom (0). The level
   * is remembered for the site (every tab on it follows), except for pages without a web host.
   */
  zoom(id: TabId, direction: 1 | -1 | 0): void {
    const tab = this.find(id);
    const contents = tab && liveContents(tab);
    if (!tab || !contents || !showsWebPage(tab.state.url)) return;
    const next = nextZoomFactor(contents.getZoomFactor(), direction, this.options.defaultZoom);
    if (next === undefined) return;
    if (webHostname(contents.getURL())) rememberSiteZoom(contents.getURL(), next, this.options.defaultZoom, this.session);
    else contents.setZoomFactor(next);
    this.applyZoom(tab);
  }

  toggleMute(id: TabId): void {
    const tab = this.find(id);
    const contents = tab && liveContents(tab);
    if (!tab || !contents) return;
    contents.setAudioMuted(!contents.isAudioMuted());
    tab.state.isMuted = contents.isAudioMuted();
    this.emit();
  }

  /** Opens the find bar on the tab's page; false (no-op) on the start page and internal pages. */
  openFind(id: TabId): boolean {
    const tab = this.find(id);
    if (!tab?.finder || !showsWebPage(tab.state.url) || tab.state.interstitial) return false;
    tab.finder.open();
    return true;
  }

  findQuery(id: TabId, query: string, matchCase: boolean): void {
    const tab = this.find(id);
    if (tab && showsWebPage(tab.state.url)) tab.finder?.search(query, matchCase);
  }

  findStep(id: TabId, forward: boolean): void {
    const tab = this.find(id);
    if (tab && showsWebPage(tab.state.url) && !tab.state.interstitial) tab.finder?.step(forward);
  }

  /** Closes the find bar; the page gets the focus back when it is the active tab. */
  closeFind(id: TabId): void {
    const tab = this.find(id);
    if (!tab?.finder) return;
    tab.finder.close();
    if (id === this.activeId && tab.view && this.attached.has(tab.view)) liveContents(tab)?.focus();
  }

  /** Picture-in-picture on the page's main video (or back from it). */
  pictureInPicture(id: TabId): void {
    const tab = this.find(id);
    const contents = tab && liveContents(tab);
    if (contents && showsWebPage(tab.state.url)) void togglePictureInPicture(contents);
  }

  move(id: TabId, toIndex: number): void {
    const from = this.tabs.findIndex((tab) => tab.id === id);
    if (from === -1) return;
    const [tab] = this.tabs.splice(from, 1);
    this.tabs.splice(tabSlot(pinnedFlags(this.tabs), tab.state.isPinned, toIndex), 0, tab);
    this.reorder();
    this.emit();
  }

  /** Turn content blocking off (or back on) for the tab's site, then reload to apply it. */
  toggleShields(id: TabId): void {
    const tab = this.find(id);
    if (!tab?.state.url || tab.state.interstitial) return;
    setShieldsEnabled(tab.state.url, !tab.state.shieldsEnabled, this.session);
    this.reload(id);
  }

  /** HTTPS-Only interstitial: the user accepts plain http for this host (until the browser quits). */
  proceedHttp(id: TabId): void {
    const url = this.find(id)?.state.interstitial?.url;
    if (!url) return;
    allowHttp(url);
    this.navigate(id, url);
  }

  /** The user opens the popup the blocker stopped ("Ouvrir" in the notice), next to its tab. */
  openBlockedPopup(id: TabId): void {
    const tab = this.find(id);
    const url = tab?.state.blockedPopup?.url;
    if (!tab || !url) return;
    tab.state.blockedPopup = null;
    this.create(url, { index: this.tabs.indexOf(tab) + 1 });
  }

  dismissBlockedPopup(id: TabId): void {
    const tab = this.find(id);
    if (!tab?.state.blockedPopup) return;
    tab.state.blockedPopup = null;
    this.emit();
  }

  respondPermission(id: TabId, promptId: string, allow: boolean, remember: boolean): void {
    const tab = this.find(id);
    const contents = tab && liveContents(tab);
    if (contents) respondPermission(contents.id, promptId, allow, remember);
  }

  /** Cycle through tabs in sidebar order (Ctrl+Tab / Ctrl+Shift+Tab). */
  cycle(direction: 1 | -1): void {
    if (this.tabs.length < 2 || !this.activeId) return;
    const index = this.tabs.findIndex((tab) => tab.id === this.activeId);
    const next = this.tabs[(index + direction + this.tabs.length) % this.tabs.length];
    this.activate(next.id);
  }

  activateIndex(index: number): void {
    const tab = index < 0 ? this.tabs.at(-1) : this.tabs[index];
    if (tab) this.activate(tab.id);
  }

  get activeTabId(): TabId | null {
    return this.activeId;
  }

  activeWebContents(): WebContents | null {
    const tab = this.activeId ? this.find(this.activeId) : undefined;
    return tab && showsWebPage(tab.state.url) ? liveContents(tab) : null;
  }

  /** Shows an internal page: switches to its tab if one is open, else opens it in a new tab. */
  openInternal(page: InternalPage): void {
    const url = internalUrl(page);
    const existing = this.tabs.find((tab) => tab.state.url === url);
    if (existing) this.activate(existing.id);
    else this.create(url, { index: this.indexAfterActive() });
  }

  /**
   * Makes a live page (the link peek's, ADR-027) a tab, without reloading it: it must use this
   * manager's session. Returns null (the caller reopens the URL instead) when it does not, or when
   * the page has no committed web address yet.
   */
  adoptPage(view: WebContentsView, options: { activate?: boolean; index?: number; favicons?: string[] } = {}): TabId | null {
    const contents = view.webContents;
    const url = contents.isDestroyed() ? "" : contents.getURL();
    if (!showsWebPage(url) || contents.session !== this.sessionOf()) return null;
    const tab = this.insert({ url, title: contents.getTitle(), favicon: null, pinned: false }, options.index ?? this.newTabIndex());
    tab.view = view;
    view.setBorderRadius(this.options.pageRadius);
    tab.state.isLoading = contents.isLoading();
    this.wire(tab, contents);
    this.visit(tab, url, false);
    this.updateHistory(tab);
    this.applyZoom(tab);
    if (options.favicons?.length) {
      const seq = ++tab.faviconSeq;
      void loadFavicon(contents, options.favicons, url).then((favicon) => {
        if (seq !== tab.faviconSeq || contents.isDestroyed() || !showsWebPage(tab.state.url)) return;
        tab.state.favicon = favicon;
        if (favicon) this.hooks.onPageInfo?.(url, { favicon });
        this.emit();
      });
    }
    if (options.activate ?? true) this.activate(tab.id);
    this.emit();
    return tab.id;
  }

  /** Position of a tab in the list (-1 if unknown). */
  indexOf(id: TabId): number {
    return this.tabs.findIndex((tab) => tab.id === id);
  }

  /** The whole page area (every pane of a split), in window content coordinates. */
  get area(): Bounds {
    return { ...this.bounds };
  }

  /** Where the active page is drawn, in window content coordinates (its pane in a split). */
  get viewBounds(): Bounds {
    const shown = this.shownTabs();
    const index = shown.findIndex((tab) => tab.id === this.activeId);
    if (shown.length < 2 || index === -1) return { ...this.bounds };
    return splitLayout(this.bounds, shown.length, this.split?.ratioX, this.split?.ratioY).panes[index];
  }

  setBounds(bounds: Bounds): void {
    this.bounds = {
      x: Math.round(bounds.x),
      y: Math.round(bounds.y),
      width: Math.max(0, Math.round(bounds.width)),
      height: Math.max(0, Math.round(bounds.height)),
    };
    this.layout();
  }

  destroy(): void {
    this.unsubscribeShields();
    this.unsubscribeZoom();
    // The window is closing: its views go with it (removing them from a destroyed window hangs).
    this.attached.clear();
    const tabs = this.tabs;
    this.tabs = [];
    for (const tab of tabs) {
      tab.unwire?.();
      tab.unwire = undefined;
      // A page that already closed itself is skipped (closing it again would throw).
      liveContents(tab)?.close();
    }
  }

  /** Removes a tab from the list (active tab and split follow); its page is left to the caller. */
  private remove(id: TabId): Tab | undefined {
    const index = this.tabs.findIndex((tab) => tab.id === id);
    if (index === -1) return undefined;
    const [tab] = this.tabs.splice(index, 1);
    this.recent = this.recent.filter((recentId) => recentId !== id);
    this.split = splitWithout(this.split, id);
    if (tab.view && this.attached.has(tab.view)) {
      this.window.contentView.removeChildView(tab.view);
      this.attached.delete(tab.view);
    }
    if (this.activeId === id) {
      const next = this.nextAfterClose(index);
      this.activeId = null;
      if (next) this.activate(next.id);
      else this.detach();
    } else {
      this.syncAttachment();
    }
    if (this.tabs.length === 0) this.create();
    this.emit();
    return tab;
  }

  /** The tabs on screen: the split's when it is visible, else the active one. */
  private shownTabs(): Tab[] {
    if (this.splitVisible) return this.split!.tabIds.map((id) => this.find(id)).filter((tab) => tab !== undefined);
    const active = this.activeId ? this.find(this.activeId) : undefined;
    return active ? [active] : [];
  }

  private sessionOf(): Session {
    return this.session ?? electronSession.defaultSession;
  }

  /** Where a new tab goes: at the end, or right after the active tab (never among pinned tabs). */
  private newTabIndex(): number {
    return this.options.newTabPosition === "next" ? this.indexAfterActive() : this.tabs.length;
  }

  private indexAfterActive(): number {
    const active = this.tabs.findIndex((tab) => tab.id === this.activeId);
    const pinned = this.tabs.filter((tab) => tab.state.isPinned).length;
    return active === -1 ? this.tabs.length : Math.max(active + 1, pinned);
  }

  /** The tab to activate once the active tab, formerly at `index`, is removed. */
  private nextAfterClose(index: number): Tab | undefined {
    const behavior = this.options.closeTabActivates;
    if (behavior === "recent") {
      const recentId = this.recent.at(-1);
      const recent = recentId ? this.find(recentId) : undefined;
      if (recent) return recent;
    }
    if (behavior === "previous" && index > 0) return this.tabs[index - 1];
    return this.tabs[Math.min(index, this.tabs.length - 1)];
  }

  private insert(entry: SessionTab, index: number): Tab {
    const id = randomUUID();
    const tab: Tab = {
      id,
      view: null,
      state: {
        id,
        url: entry.url,
        title: entry.title || this.defaultTitle(entry.url),
        favicon: entry.favicon,
        isLoading: false,
        canGoBack: false,
        canGoForward: false,
        isPinned: entry.pinned,
        folderId: entry.pinned ? null : (entry.folderId ?? null),
        isBookmarked: false,
        blockedCount: 0,
        shieldsEnabled: shieldsEnabledFor(entry.url, this.session),
        permissionRequest: null,
        interstitial: null,
        lastActiveAt: 0,
        isAudible: false,
        isMuted: false,
        zoom: Math.round(this.options.defaultZoom * 100),
        find: null,
        blockedPopup: null,
      },
      // A restored tab keeps when it was last seen (auto-archiving, ADR-022).
      lastSeenAt: entry.lastSeenAt ?? Date.now(),
      inPageVisits: new InPageVisits(),
      faviconSeq: 0,
    };
    this.tabs.splice(tabSlot(pinnedFlags(this.tabs), entry.pinned, index), 0, tab);
    return tab;
  }

  private defaultTitle(url: string): string {
    const page = internalPageOf(url);
    if (page) return INTERNAL_PAGES[page].title;
    return url ? displayUrl(url) : START_TITLE;
  }

  private ensureView(tab: Tab): WebContentsView {
    if (tab.view && liveContents(tab)) return tab.view;
    const view = new WebContentsView({
      webPreferences: {
        ...(this.session ? { session: this.session } : {}),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        allowRunningInsecureContent: false,
        spellcheck: true,
      },
    });
    view.setBorderRadius(this.options.pageRadius);
    view.setBackgroundColor("#ffffff");
    tab.view = view;
    this.wire(tab, view.webContents);
    if (tab.state.mobileSite) this.applyUserAgent(tab, view.webContents);
    return view;
  }

  /** Loads the URL a discarded tab kept from the saved session. */
  private wake(tab: Tab): void {
    if (!isDiscarded(tab)) return;
    tab.waking = tab.state.url;
    const contents = this.ensureView(tab).webContents;
    const load = () => contents.loadURL(tab.state.url).catch(() => {
      // Load failures are reported through did-fail-load.
    });
    // A tab put to sleep gets its back/forward list back (a restored tab has none).
    const history = tab.sleptHistory;
    tab.sleptHistory = undefined;
    if (history?.entries[history.index]?.url === tab.state.url) contents.navigationHistory.restore(history).catch(load);
    else void load();
  }

  // --- Tab sleeping (ADR-014, policy and scheduler in ./sleep.ts) ---------------------------

  /** What the sleep policy needs to know about each tab; tabs on screen are marked seen now. */
  sleepCandidates(now = Date.now()): SleepCandidate[] {
    this.markSeen(now);
    const shown = new Set(this.visible ? this.shownTabs() : []);
    return this.tabs.map((tab) => {
      const contents = liveContents(tab);
      return {
        id: tab.id,
        hasView: !!contents,
        shown: shown.has(tab),
        // Muted tabs still count: the user may unmute them at any time.
        audible: tab.state.isAudible || (contents?.isCurrentlyAudible() ?? false),
        permissionPending: tab.state.permissionRequest !== null,
        devTools: contents?.isDevToolsOpened() ?? false,
        lastSeenAt: tab.lastSeenAt,
        pinned: tab.state.isPinned,
        url: tab.state.url,
        inSplit: !!this.split?.tabIds.includes(tab.id),
      };
    });
  }

  /** The live page of a tab (null when it has none: start page, discarded…). */
  pageOf(id: TabId): WebContents | null {
    const tab = this.find(id);
    return tab ? liveContents(tab) : null;
  }

  /**
   * Puts a background tab to sleep: its page is destroyed, url/title/favicon (and the back/forward
   * list) are kept, and it loads again when activated, like a tab restored from the session.
   * Refused for tabs on screen. The caller checks the policy (`./sleep.ts`) first.
   */
  discard(id: TabId): boolean {
    const tab = this.find(id);
    if (!tab?.view || (this.visible && this.shownTabs().includes(tab))) return false;
    const { view } = tab;
    if (this.attached.has(view)) {
      this.window.contentView.removeChildView(view);
      this.attached.delete(view);
    }
    tab.sleptHistory = historyOf(tab) ?? tab.sleptHistory;
    const contents = liveContents(tab);
    tab.unwire?.();
    tab.unwire = undefined;
    tab.view = null;
    contents?.close();
    Object.assign(tab.state, { isLoading: false, blockedCount: 0, permissionRequest: null });
    // A page parked below the start page or an internal page is gone: nothing left to go back to.
    if (!showsWebPage(tab.state.url)) this.updateHistory(tab);
    this.emit();
    return true;
  }

  /** Makes another tab active (the most recently used one), so that `id` can sleep. */
  activateOther(id: TabId): boolean {
    const others = this.recent.filter((recentId) => recentId !== id && this.find(recentId));
    const next = others.at(-1) ?? this.tabs.find((tab) => tab.id !== id)?.id;
    if (!next) return false;
    if (this.split?.tabIds.includes(id)) this.exitSplit();
    this.activate(next);
    return true;
  }

  /** Tabs on screen were seen now (their idle time starts when they leave the screen). */
  private markSeen(now = Date.now()): void {
    if (!this.visible) return;
    for (const tab of this.shownTabs()) tab.lastSeenAt = now;
  }

  private find(id: TabId): Tab | undefined {
    return this.tabs.find((tab) => tab.id === id);
  }

  /**
   * The shown tabs' views are attached (laid out side by side in a split), except where the chrome
   * UI renders in their place (start page, internal page, interstitial), and none while hidden.
   */
  private syncAttachment(): void {
    const wanted = new Set(this.visible ? this.paneViews().filter((view) => view !== null) : []);
    for (const view of this.attached) if (!wanted.has(view)) this.window.contentView.removeChildView(view);
    for (const view of wanted) if (!this.attached.has(view)) this.window.contentView.addChildView(view);
    this.attached = wanted;
    this.layout();
  }

  /** One entry per pane on screen: the view to show there, or null when the chrome UI draws it. */
  private paneViews(): (WebContentsView | null)[] {
    const shown = this.shownTabs();
    return shown.map((tab) =>
      showsWebPage(tab.state.url) && !tab.state.interstitial && !tab.state.loadError && !(shown.length === 1 && this.showsReader(tab)) ? tab.view : null,
    );
  }

  /** Reader mode (ADR-026) is drawn by the chrome UI over a web page, outside split view only. */
  private showsReader(tab: Tab): boolean {
    return !!tab.state.reader && showsWebPage(tab.state.url) && !tab.state.interstitial && !tab.state.loadError && !(this.splitVisible && this.split?.tabIds.includes(tab.id));
  }

  /**
   * Turns reader mode on (main extracted the article of `url`) or off. Refused when the tab moved
   * on to another page meanwhile.
   */
  setReader(id: TabId, on: boolean, url?: string): boolean {
    const tab = this.find(id);
    const contents = tab && liveContents(tab);
    if (!tab || (on && (!contents || contents.getURL() !== url || !showsWebPage(tab.state.url)))) return false;
    if (!!tab.state.reader === on) return true;
    tab.state.reader = on;
    this.syncAttachment();
    this.emit();
    return true;
  }

  /** "Demander la version mobile" (ADR-026): a mobile user agent for this tab's page, then a reload. */
  toggleMobileSite(id: TabId): void {
    const tab = this.find(id);
    const contents = tab && liveContents(tab);
    if (!tab || !contents || !showsWebPage(tab.state.url)) return;
    tab.state.mobileSite = !tab.state.mobileSite;
    this.applyUserAgent(tab, contents);
    contents.reload();
    this.emit();
  }

  private applyUserAgent(tab: Tab, contents: WebContents): void {
    const base = contents.session.getUserAgent();
    contents.setUserAgent(tab.state.mobileSite ? mobileUserAgent(base) : base);
  }

  /** Readability's quick check, after each load: the address bar shows the reader button. */
  private async checkReaderable(tab: Tab, contents: WebContents): Promise<void> {
    if (!showsWebPage(tab.state.url)) return;
    const url = contents.getURL();
    const readerable = await isPageReaderable(contents);
    if (contents.isDestroyed() || contents.getURL() !== url || readerable === !!tab.state.readerable) return;
    tab.state.readerable = readerable;
    this.emit();
  }

  /** Bounds of the attached views: the whole viewport, or the split's panes. */
  private layout(): void {
    if (!this.attached.size) return;
    const panes = this.paneViews();
    const { panes: rects } = splitLayout(this.bounds, panes.length, this.split?.ratioX, this.split?.ratioY);
    panes.forEach((view, index) => {
      if (view && this.attached.has(view)) view.setBounds(rects[index]);
    });
  }

  private detach(): void {
    for (const view of this.attached) this.window.contentView.removeChildView(view);
    this.attached.clear();
  }

  /** Gives the page its site's zoom (or the default zoom), and mirrors it in the tab state. */
  private applyZoom(tab: Tab): void {
    const contents = liveContents(tab);
    if (!contents) return;
    const factor = siteZoomFactor(contents.getURL(), this.options.defaultZoom, this.session);
    if (factor !== undefined && !sameFactor(contents.getZoomFactor(), factor)) contents.setZoomFactor(factor);
    const zoom = Math.round((factor ?? contents.getZoomFactor()) * 100);
    if (zoom === tab.state.zoom) return;
    tab.state.zoom = zoom;
    this.emit();
  }

  private isBookmarked(url: string): boolean {
    return url !== "" && (this.hooks.isBookmarked?.(url) ?? false);
  }

  private visit(tab: Tab, url: string, inPage: boolean): void {
    // Hash-only changes (anchors, old-style routers) are not new visits.
    if (inPage && tab.lastVisit && withoutHash(tab.lastVisit) === withoutHash(url)) return;
    // pushState storms must not flood the history: one in-page visit per second at most (ADR-018).
    if (!inPage) tab.inPageVisits.reset(url);
    else if (!tab.inPageVisits.accept(url, Date.now())) return;
    tab.lastVisit = url;
    this.hooks.onVisit?.(url);
  }

  /**
   * Back from the start page or an internal page: the page parked below it is shown again, as it
   * was (its own history untouched), and Forward leads back to what was left.
   */
  private unpark(tab: Tab, contents: WebContents): void {
    tab.forwardTo = tab.state.url;
    const url = contents.getURL();
    Object.assign(tab.state, {
      url,
      title: contents.getTitle() || displayUrl(url),
      favicon: tab.parkedFavicon ?? null,
      isLoading: contents.isLoading(),
      shieldsEnabled: shieldsEnabledFor(url, this.session),
    });
    this.updateHistory(tab);
    this.syncAttachment();
    this.applyZoom(tab);
    this.emit();
  }

  /** Back/forward availability of the tab, page history and parked page included. */
  private updateHistory(tab: Tab): void {
    const contents = liveContents(tab);
    if (!showsWebPage(tab.state.url)) {
      // Start page or internal page: Back shows the page parked below it, if any.
      tab.state.canGoBack = !!contents?.getURL();
      tab.state.canGoForward = false;
    } else {
      tab.state.canGoBack = contents?.navigationHistory.canGoBack() ?? false;
      tab.state.canGoForward = tab.forwardTo !== undefined || (contents?.navigationHistory.canGoForward() ?? false);
    }
  }

  /** The page closed itself (`window.close()`): the tab goes away, as if the user closed it. */
  private pageClosed(tab: Tab): void {
    // Pages closed by the manager itself (close, sleep, move…) are unwired first: this never runs for them.
    if (!this.tabs.includes(tab)) return;
    tab.unwire?.();
    tab.unwire = undefined;
    this.remove(tab.id);
  }

  private wire(tab: Tab, contents: WebContents): void {
    // Listeners are tracked so that a live tab moving to another manager can be rewired there.
    const listeners: [string, (...args: never[]) => void][] = [];
    const on = ((event: string, listener: (...args: never[]) => void) => {
      contents.on(event as "focus", listener as () => void);
      listeners.push([event, listener]);
    }) as unknown as WebContents["on"];
    tab.unwire = () => {
      for (const [event, listener] of listeners) contents.off(event as "focus", listener as () => void);
    };

    hardenWebContents(contents, {
      openTab: (url, foreground) => {
        // Defense in depth: hardenWebContents already only lets web pages and about:blank through.
        if (!isPageOpenableUrl(url)) return;
        const index = this.tabs.indexOf(tab) + 1;
        // A link opened from a filed tab stays in its folder.
        this.create(url, { activate: foreground, index, folderId: tab.state.folderId });
      },
      peek: this.hooks.peekLink && ((url) => this.hooks.peekLink?.(tab.id, url)),
      popupBlocked: (url) => {
        // The notice keeps the last blocked popup of the page; "Ouvrir" opens it (openBlockedPopup).
        if (!isPageOpenableUrl(url)) return;
        tab.state.blockedPopup = { url, count: (tab.state.blockedPopup?.count ?? 0) + 1 };
        this.emit();
      },
    });
    attachTabPrivacy(contents, {
      blocked: () => {
        tab.state.blockedCount++;
        this.emit();
      },
      permissionChanged: (prompt) => {
        tab.state.permissionRequest = prompt;
        this.emit();
      },
    });

    const refresh = () => {
      if (contents.isDestroyed()) return;
      const url = contents.getURL();
      // A parked page (below the start page or an internal page) does not change the tab's
      // address, and while an interstitial is shown, the tab keeps the address the user asked for.
      if (url && showsWebPage(tab.state.url) && !tab.state.interstitial) {
        tab.state.url = url;
        tab.state.shieldsEnabled = shieldsEnabledFor(url, this.session);
      }
      this.updateHistory(tab);
      this.emit();
    };
    /** A page committed in the main frame: the start/internal page left with Back is no longer ahead. */
    const committed = () => {
      if (showsWebPage(tab.state.url)) tab.forwardTo = undefined;
    };

    // The page closed itself: never touch it again (a destroyed webContents throws).
    on("destroyed", () => this.pageClosed(tab));

    // Clicking a pane of a visible split makes its tab the active one (address bar, shortcuts…).
    on("focus", () => {
      if (this.splitVisible && tab.id !== this.activeId && this.split?.tabIds.includes(tab.id)) this.activate(tab.id);
    });
    // Precision touchpads on Windows report horizontal wheel deltas rather than Electron's
    // macOS-only native `swipe` event. Require a clearly horizontal, precise gesture.
    let horizontalGesture = 0;
    let gestureReset: ReturnType<typeof setTimeout> | undefined;
    const resetHorizontalGesture = () => {
      horizontalGesture = 0;
      if (gestureReset !== undefined) {
        clearTimeout(gestureReset);
        gestureReset = undefined;
      }
    };
    on("input-event", (_event: Electron.Event, input: Electron.InputEvent) => {
      if (input.type === "gestureScrollEnd") {
        resetHorizontalGesture();
        return;
      }
      if (input.type !== "mouseWheel") return;
      const wheel = input as Electron.InputEvent & {
        deltaX?: number;
        deltaY?: number;
        hasPreciseScrollingDeltas?: boolean;
      };
      const deltaX = wheel.deltaX ?? 0;
      const deltaY = wheel.deltaY ?? 0;
      if (!wheel.hasPreciseScrollingDeltas || Math.abs(deltaX) < Math.abs(deltaY) * 1.5) {
        resetHorizontalGesture();
        return;
      }
      horizontalGesture += deltaX;
      gestureReset = setTimeout(resetHorizontalGesture, 250);
      if (Math.abs(horizontalGesture) < 120) return;
      if (horizontalGesture < 0) this.back(tab.id);
      else this.forward(tab.id);
      resetHorizontalGesture();
    });
    on("did-start-navigation", (details) => {
      if (!details.isMainFrame || details.isSameDocument) return;
      // A new page: fresh blocked counter, no blocked popup, and any interstitial gives way to it.
      tab.state.blockedCount = 0;
      tab.state.blockedPopup = null;
      tab.state.readerable = false;
      if (tab.state.interstitial || tab.state.loadError || tab.state.reader) {
        tab.state.interstitial = null;
        tab.state.loadError = null;
        tab.state.reader = false;
        this.syncAttachment();
      }
      this.emit();
    });
    on("did-start-loading", () => {
      // A parked page loading (script navigation) does not make the start/internal page spin.
      if (!showsWebPage(tab.state.url)) return;
      tab.state.isLoading = true;
      this.emit();
    });
    on("did-stop-loading", () => {
      tab.state.isLoading = false;
      refresh();
      void this.checkReaderable(tab, contents);
    });
    on("did-navigate", (_event, url) => {
      // A new document: its favicon comes with it (or not at all).
      if (tab.faviconKey && !tab.faviconKey.startsWith(`${url}\n`)) {
        tab.faviconKey = undefined;
        tab.faviconSeq++;
        if (tab.waking) {
          // A woken tab keeps its saved favicon until the page reports its own.
        } else if (showsWebPage(tab.state.url)) tab.state.favicon = null;
        else tab.parkedFavicon = null;
      }
      if (url === tab.waking) tab.lastVisit = url;
      else this.visit(tab, url, false);
      tab.waking = undefined;
      committed();
      this.applyZoom(tab);
      refresh();
    });
    on("dom-ready", () => {
      this.hooks.boostPage?.(contents);
      this.hooks.pageReady?.(tab.id, contents);
    });
    // Ctrl+wheel and pinch: same steps as the zoom commands, remembered per site.
    on("zoom-changed", (_event, direction) => this.zoom(tab.id, direction === "in" ? 1 : -1));
    on("context-menu", (_event, params) => {
      // A parked page (below the start page or an internal page) is not on screen.
      if (showsWebPage(tab.state.url) && !tab.state.interstitial && !tab.state.loadError) this.hooks.contextMenu?.(tab.id, params);
    });
    on("audio-state-changed", (event) => {
      tab.state.isAudible = event.audible;
      this.emit();
    });
    // Listens through `on` too, so a tab moving to another space keeps a single finder (its query stays).
    tab.finder = new PageFind(contents, on, tab.state.find, (find) => {
      tab.state.find = find;
      this.emit();
    });
    on("did-navigate-in-page", (_event, url, isMainFrame) => {
      if (isMainFrame) {
        this.visit(tab, url, true);
        committed();
      }
      refresh();
    });
    on("page-title-updated", (_event, title) => {
      // A parked view (behind the start page or an internal page) does not name the tab.
      if (!showsWebPage(tab.state.url)) return;
      tab.state.title = title || displayUrl(contents.getURL());
      if (title) this.hooks.onPageInfo?.(contents.getURL(), { title });
      this.emit();
    });
    on("page-favicon-updated", (_event, favicons) => {
      // Fetched by main with the tab's own session, handed to the UI as a data: URL (ADR-018).
      const pageUrl = contents.getURL();
      const key = `${pageUrl}\n${favicons.join("\n")}`;
      if (key === tab.faviconKey) return;
      tab.faviconKey = key;
      const seq = ++tab.faviconSeq;
      void loadFavicon(contents, favicons, pageUrl).then((favicon) => {
        if (seq !== tab.faviconSeq || contents.isDestroyed()) return;
        // A parked page's favicon is kept for when Back shows it again.
        if (!showsWebPage(tab.state.url)) {
          tab.parkedFavicon = favicon;
          return;
        }
        tab.state.favicon = favicon;
        if (favicon) this.hooks.onPageInfo?.(pageUrl, { favicon });
        this.emit();
      });
    });
    on("did-fail-load", (_event, code, description, url, isMainFrame) => {
      // -3 is ERR_ABORTED: a navigation replaced by another one, not a real failure.
      // A parked page's failures do not concern the start/internal page shown in the tab.
      if (!isMainFrame || code === -3 || !showsWebPage(tab.state.url)) return;
      const httpUrl = httpsFallbackFor(contents.id, url, code);
      if (httpUrl) {
        // HTTPS-Only: the upgraded load failed; the chrome UI asks before falling back to http.
        tab.state.interstitial = { kind: "https-only", url: httpUrl };
        tab.state.url = httpUrl;
        tab.state.title = displayUrl(httpUrl);
        tab.state.isLoading = false;
        this.syncAttachment();
        this.emit();
        return;
      }
      tab.state.title = `Erreur : ${displayUrl(url) || description}`;
      tab.state.isLoading = false;
      // The chrome UI explains the failure (LoadErrorPage) instead of Chromium's blank error page.
      tab.state.loadError = { code, description, url };
      this.syncAttachment();
      this.emit();
    });
  }

  /** Coalesce bursts of webContents events into one state push per tick. */
  private emit(): void {
    if (this.emitScheduled) return;
    this.emitScheduled = true;
    queueMicrotask(() => {
      this.emitScheduled = false;
      this.onChange(this.getState());
    });
  }
}
