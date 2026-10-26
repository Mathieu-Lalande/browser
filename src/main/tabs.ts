import { randomUUID } from "node:crypto";
import { WebContentsView, session as electronSession, type BaseWindow, type Session, type WebContents } from "electron";
import { INTERNAL_PAGES, internalPageOf, internalUrl, isInternalUrl, type InternalPage } from "@shared/internal";
import type { CloseTabActivates, NewTabPosition } from "@shared/settings";
import { clampRatio, splitLayout, splitWith, splitWithout } from "@shared/split";
import type { Bounds, SplitState, TabId, TabState, TabsState } from "@shared/types";
import { DEFAULT_SEARCH_ENGINE, displayUrl, isNavigableUrl, normalizeInput, type SearchEngine } from "@shared/url";
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
import { togglePictureInPicture } from "./media";
import { webHostname } from "./privacy/hosts";
import { hardenWebContents } from "./security";
import type { SessionTab, SessionTabList } from "./storage/session";
import { onSiteZoomChange, rememberSiteZoom, siteZoomFactor } from "./zoom";
import { nextZoomFactor, sameFactor } from "./zoom/levels";

const START_TITLE = "Nouvel onglet";

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
}

/** A tab taken out of a TabManager (`release`) to be adopted by another one, live page included. */
export interface ReleasedTab {
  readonly state: TabState;
  readonly view: WebContentsView | null;
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
 * Owns the web pages of one space of one window: each tab is a sandboxed WebContentsView that is
 * attached to the window only while it is the active tab (or one of the tabs of a visible split).
 */
export class TabManager {
  private tabs: Tab[] = [];
  private activeId: TabId | null = null;
  private bounds: Bounds = { x: 0, y: 0, width: 0, height: 0 };
  private attached = new Set<WebContentsView>();
  private split: SplitState | null = null;
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
      for (const tab of this.tabs) tab.state.shieldsEnabled = shieldsEnabledFor(tab.state.url);
      this.emit();
    });
    // A site zoomed (from any window): its other tabs follow.
    this.unsubscribeZoom = onSiteZoomChange((host) => {
      for (const tab of this.tabs) if (tab.view && webHostname(tab.view.webContents.getURL()) === host) this.applyZoom(tab);
    });
  }

  getState(): TabsState {
    return {
      tabs: this.tabs.map((tab) => ({ ...tab.state, isBookmarked: this.isBookmarked(tab.state.url) })),
      activeTabId: this.activeId,
      split: this.split && { ...this.split, tabIds: [...this.split.tabIds] },
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

  create(input = "", options: { activate?: boolean; index?: number } = {}): TabId {
    const tab = this.insert({ url: "", title: START_TITLE, favicon: null, pinned: false }, options.index ?? this.newTabIndex());
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
    const restored = saved.tabs.map((entry) => this.insert(entry, this.tabs.length));
    if (saved.split) {
      const tabIds = saved.split.tabIndexes.map((index) => restored[index]?.id).filter((id) => id !== undefined);
      if (tabIds.length >= 2) this.split = { tabIds, ratioX: clampRatio(saved.split.ratioX), ratioY: clampRatio(saved.split.ratioY) };
    }
    // Pinned tabs always sit before unpinned ones.
    this.tabs.sort((a, b) => Number(b.state.isPinned) - Number(a.state.isPinned));
    const active = this.tabs[saved.activeIndex] ?? this.tabs[0];
    if (active) this.activate(active.id);
    else this.create();
  }

  /** What to save to restore this window later. */
  snapshot(): SessionTabList {
    const indexOf = (id: TabId) => this.tabs.findIndex((tab) => tab.id === id);
    return {
      tabs: this.tabs.map(({ state }) => ({ url: state.url, title: state.title, favicon: state.favicon, pinned: state.isPinned })),
      activeIndex: Math.max(0, indexOf(this.activeId ?? "")),
      split: this.split && { tabIndexes: this.split.tabIds.map(indexOf), ratioX: this.split.ratioX, ratioY: this.split.ratioY },
    };
  }

  /** Re-sends the state, e.g. after a bookmark change that affects `isBookmarked`. */
  refresh(): void {
    this.emit();
  }

  close(id: TabId): void {
    const tab = this.remove(id);
    tab?.view?.webContents.close();
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
    return { state: tab.state, view: tab.view };
  }

  /**
   * Adds a tab released by another manager. Its live page is kept when it already uses this
   * manager's session; otherwise it is closed and the tab comes back discarded (reloads here).
   */
  adopt(released: ReleasedTab, options: { activate?: boolean; index?: number } = {}): TabId {
    const { state } = released;
    let view = released.view;
    if (view && view.webContents.session !== this.sessionOf()) {
      view.webContents.close();
      view = null;
    }
    const tab: Tab = { id: state.id, view, state: { ...state } };
    if (!view) {
      Object.assign(tab.state, { isLoading: false, canGoBack: false, canGoForward: false, blockedCount: 0, permissionRequest: null, interstitial: null });
    } else {
      view.setBorderRadius(this.options.pageRadius);
    }
    this.tabs.splice(Math.max(0, Math.min(options.index ?? this.tabs.length, this.tabs.length)), 0, tab);
    this.tabs.sort((a, b) => Number(b.state.isPinned) - Number(a.state.isPinned));
    if (view) this.wire(tab, view.webContents);
    // A manager always has an active tab once it has tabs.
    if (options.activate || !this.activeId) this.activate(tab.id);
    this.emit();
    return tab.id;
  }

  activate(id: TabId): void {
    const tab = this.find(id);
    if (!tab) return;
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
      tab.view.webContents.close();
      tab.view = null;
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
    tab.state.url = url;
    tab.state.interstitial = null;
    tab.state.shieldsEnabled = shieldsEnabledFor(url);
    if (!showsWebPage(url)) {
      // Start page or internal page: drawn by the chrome UI, the page view (if any) is parked.
      const page = internalPageOf(url);
      tab.state.title = page ? INTERNAL_PAGES[page].title : START_TITLE;
      tab.state.favicon = null;
      tab.state.isLoading = false;
      if (tab.view?.webContents.getURL()) tab.view.webContents.loadURL("about:blank").catch(() => {});
    } else {
      tab.state.title = displayUrl(url);
      this.ensureView(tab).webContents.loadURL(url).catch(() => {
        // Load failures are reported through did-fail-load.
      });
    }
    this.syncAttachment();
    this.emit();
  }

  back(id: TabId): void {
    this.find(id)?.view?.webContents.navigationHistory.goBack();
  }

  forward(id: TabId): void {
    this.find(id)?.view?.webContents.navigationHistory.goForward();
  }

  reload(id: TabId): void {
    const tab = this.find(id);
    if (!tab || !showsWebPage(tab.state.url)) return;
    if (tab.view) tab.view.webContents.reload();
    else this.wake(tab);
  }

  stop(id: TabId): void {
    this.find(id)?.view?.webContents.stop();
  }

  togglePin(id: TabId): void {
    const tab = this.find(id);
    if (!tab) return;
    tab.state.isPinned = !tab.state.isPinned;
    // Pinned tabs always sit before unpinned ones.
    this.tabs.sort((a, b) => Number(b.state.isPinned) - Number(a.state.isPinned));
    this.emit();
  }

  /**
   * Opens a copy of a tab right after it (after the pinned tabs, as copies are not pinned),
   * with its back/forward history, and activates it.
   */
  duplicate(id: TabId): TabId | undefined {
    const source = this.find(id);
    if (!source) return undefined;
    const pinnedCount = this.tabs.filter((tab) => tab.state.isPinned).length;
    const index = Math.max(this.tabs.indexOf(source) + 1, pinnedCount);
    const { url, title, favicon } = source.state;
    const copy = this.insert({ url, title, favicon, pinned: false }, index);
    const entries = source.view?.webContents.navigationHistory;
    if (showsWebPage(url) && entries && entries.length() > 0) {
      const view = this.ensureView(copy);
      // Like waking a restored tab: reopening a page is not a new visit.
      copy.waking = url;
      view.webContents.navigationHistory
        .restore({ entries: entries.getAllEntries(), index: entries.getActiveIndex() })
        .catch(() => view.webContents.loadURL(url).catch(() => {}));
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
    const contents = tab?.view?.webContents;
    if (!tab || !contents || !showsWebPage(tab.state.url)) return;
    const next = nextZoomFactor(contents.getZoomFactor(), direction, this.options.defaultZoom);
    if (next === undefined) return;
    if (webHostname(contents.getURL())) rememberSiteZoom(contents.getURL(), next, this.options.defaultZoom);
    else contents.setZoomFactor(next);
    this.applyZoom(tab);
  }

  toggleMute(id: TabId): void {
    const tab = this.find(id);
    const contents = tab?.view?.webContents;
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
    if (id === this.activeId && tab.view && this.attached.has(tab.view)) tab.view.webContents.focus();
  }

  /** Picture-in-picture on the page's main video (or back from it). */
  pictureInPicture(id: TabId): void {
    const tab = this.find(id);
    if (tab?.view && showsWebPage(tab.state.url)) void togglePictureInPicture(tab.view.webContents);
  }

  move(id: TabId, toIndex: number): void {
    const from = this.tabs.findIndex((tab) => tab.id === id);
    if (from === -1) return;
    const [tab] = this.tabs.splice(from, 1);
    this.tabs.splice(Math.max(0, Math.min(toIndex, this.tabs.length)), 0, tab);
    this.emit();
  }

  /** Turn content blocking off (or back on) for the tab's site, then reload to apply it. */
  toggleShields(id: TabId): void {
    const tab = this.find(id);
    if (!tab?.state.url || tab.state.interstitial) return;
    setShieldsEnabled(tab.state.url, !tab.state.shieldsEnabled);
    this.reload(id);
  }

  /** HTTPS-Only interstitial: the user accepts plain http for this host (until the browser quits). */
  proceedHttp(id: TabId): void {
    const url = this.find(id)?.state.interstitial?.url;
    if (!url) return;
    allowHttp(url);
    this.navigate(id, url);
  }

  respondPermission(id: TabId, promptId: string, allow: boolean, remember: boolean): void {
    const tab = this.find(id);
    if (tab?.view) respondPermission(tab.view.webContents.id, promptId, allow, remember);
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
    return tab && showsWebPage(tab.state.url) && tab.view ? tab.view.webContents : null;
  }

  /** Shows an internal page: switches to its tab if one is open, else opens it in a new tab. */
  openInternal(page: InternalPage): void {
    const url = internalUrl(page);
    const existing = this.tabs.find((tab) => tab.state.url === url);
    if (existing) this.activate(existing.id);
    else this.create(url, { index: this.indexAfterActive() });
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
    for (const tab of this.tabs) tab.view?.webContents.close();
    this.tabs = [];
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
        isBookmarked: false,
        blockedCount: 0,
        shieldsEnabled: shieldsEnabledFor(entry.url),
        permissionRequest: null,
        interstitial: null,
        lastActiveAt: 0,
        isAudible: false,
        isMuted: false,
        zoom: Math.round(this.options.defaultZoom * 100),
        find: null,
      },
    };
    this.tabs.splice(Math.max(0, Math.min(index, this.tabs.length)), 0, tab);
    return tab;
  }

  private defaultTitle(url: string): string {
    const page = internalPageOf(url);
    if (page) return INTERNAL_PAGES[page].title;
    return url ? displayUrl(url) : START_TITLE;
  }

  private ensureView(tab: Tab): WebContentsView {
    if (tab.view) return tab.view;
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
    return view;
  }

  /** Loads the URL a discarded tab kept from the saved session. */
  private wake(tab: Tab): void {
    if (!isDiscarded(tab)) return;
    tab.waking = tab.state.url;
    this.ensureView(tab).webContents.loadURL(tab.state.url).catch(() => {
      // Load failures are reported through did-fail-load.
    });
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
    return this.shownTabs().map((tab) => (showsWebPage(tab.state.url) && !tab.state.interstitial ? tab.view : null));
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
    const contents = tab.view?.webContents;
    if (!contents || contents.isDestroyed()) return;
    const factor = siteZoomFactor(contents.getURL(), this.options.defaultZoom);
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
    tab.lastVisit = url;
    this.hooks.onVisit?.(url);
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
        // Defense in depth: hardenWebContents already only lets web URLs through.
        if (!isNavigableUrl(url)) return;
        const index = this.tabs.indexOf(tab) + 1;
        this.create(url, { activate: foreground, index });
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
      const url = contents.getURL();
      // While an interstitial is shown, the tab keeps the address the user asked for.
      if (url && url !== "about:blank" && !tab.state.interstitial) {
        tab.state.url = url;
        tab.state.shieldsEnabled = shieldsEnabledFor(url);
      }
      tab.state.canGoBack = contents.navigationHistory.canGoBack();
      tab.state.canGoForward = contents.navigationHistory.canGoForward();
      this.emit();
    };

    // Clicking a pane of a visible split makes its tab the active one (address bar, shortcuts…).
    on("focus", () => {
      if (this.splitVisible && tab.id !== this.activeId && this.split?.tabIds.includes(tab.id)) this.activate(tab.id);
    });
    on("did-start-navigation", (details) => {
      if (!details.isMainFrame || details.isSameDocument) return;
      // A new page: fresh blocked counter, and any interstitial gives way to it.
      tab.state.blockedCount = 0;
      if (tab.state.interstitial) {
        tab.state.interstitial = null;
        this.syncAttachment();
      }
      this.emit();
    });
    on("did-start-loading", () => {
      tab.state.isLoading = true;
      this.emit();
    });
    on("did-stop-loading", () => {
      tab.state.isLoading = false;
      refresh();
    });
    on("did-navigate", (_event, url) => {
      if (url === tab.waking) tab.lastVisit = url;
      else this.visit(tab, url, false);
      tab.waking = undefined;
      this.applyZoom(tab);
      refresh();
    });
    // Ctrl+wheel and pinch: same steps as the zoom commands, remembered per site.
    on("zoom-changed", (_event, direction) => this.zoom(tab.id, direction === "in" ? 1 : -1));
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
      if (isMainFrame) this.visit(tab, url, true);
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
      if (!showsWebPage(tab.state.url)) return;
      tab.state.favicon = favicons.find(isNavigableUrl) ?? null;
      if (tab.state.favicon) this.hooks.onPageInfo?.(contents.getURL(), { favicon: tab.state.favicon });
      this.emit();
    });
    on("did-fail-load", (_event, code, description, url, isMainFrame) => {
      // -3 is ERR_ABORTED: a navigation replaced by another one, not a real failure.
      if (!isMainFrame || code === -3) return;
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
