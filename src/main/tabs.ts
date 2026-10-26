import { randomUUID } from "node:crypto";
import { WebContentsView, type BaseWindow, type WebContents } from "electron";
import { INTERNAL_PAGES, internalPageOf, internalUrl, isInternalUrl, type InternalPage } from "@shared/internal";
import type { CloseTabActivates, NewTabPosition } from "@shared/settings";
import type { Bounds, BrowserState, TabId, TabState } from "@shared/types";
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
import type { SessionTab, SessionWindow } from "./storage/session";
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
 * Owns the web pages of one window: each tab is a sandboxed WebContentsView that is
 * attached to the window only while it is the active tab.
 */
export class TabManager {
  private tabs: Tab[] = [];
  private activeId: TabId | null = null;
  private bounds: Bounds = { x: 0, y: 0, width: 0, height: 0 };
  private attached: WebContentsView | null = null;
  private emitScheduled = false;
  private readonly unsubscribeShields: () => void;
  private readonly unsubscribeZoom: () => void;
  private options: TabOptions = { ...DEFAULT_TAB_OPTIONS };
  /** Tab ids, least recently activated first (for "close → back to the last used tab"). */
  private recent: TabId[] = [];

  constructor(
    private readonly window: BaseWindow,
    private readonly onChange: (state: BrowserState) => void,
    private readonly hooks: TabManagerHooks = {},
  ) {
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

  getState(): BrowserState {
    return {
      tabs: this.tabs.map((tab) => ({ ...tab.state, isBookmarked: this.isBookmarked(tab.state.url) })),
      activeTabId: this.activeId,
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
  restore(saved: SessionWindow): void {
    for (const entry of saved.tabs) this.insert(entry, this.tabs.length);
    // Pinned tabs always sit before unpinned ones.
    this.tabs.sort((a, b) => Number(b.state.isPinned) - Number(a.state.isPinned));
    const active = this.tabs[saved.activeIndex] ?? this.tabs[0];
    if (active) this.activate(active.id);
    else this.create();
  }

  /** What to save to restore this window later. */
  snapshot(): SessionWindow {
    return {
      tabs: this.tabs.map(({ state }) => ({ url: state.url, title: state.title, favicon: state.favicon, pinned: state.isPinned })),
      activeIndex: Math.max(0, this.tabs.findIndex((tab) => tab.id === this.activeId)),
    };
  }

  /** Re-sends the state, e.g. after a bookmark change that affects `isBookmarked`. */
  refresh(): void {
    this.emit();
  }

  close(id: TabId): void {
    const index = this.tabs.findIndex((tab) => tab.id === id);
    if (index === -1) return;
    const [tab] = this.tabs.splice(index, 1);
    this.recent = this.recent.filter((recentId) => recentId !== id);
    if (this.activeId === id) {
      const next = this.nextAfterClose(index);
      this.activeId = null;
      if (next) this.activate(next.id);
      else this.detach();
    }
    tab.view?.webContents.close();
    if (this.tabs.length === 0) this.create();
    this.emit();
  }

  activate(id: TabId): void {
    const tab = this.find(id);
    if (!tab) return;
    this.activeId = id;
    tab.state.lastActiveAt = Date.now();
    this.recent = [...this.recent.filter((recentId) => recentId !== id), id];
    this.wake(tab);
    this.syncAttachment();
    this.emit();
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
    if (id === this.activeId) this.syncAttachment();
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
    if (id === this.activeId && tab.view === this.attached) tab.view?.webContents.focus();
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

  /** Where the active page is drawn, in window content coordinates. */
  get viewBounds(): Bounds {
    return { ...this.bounds };
  }

  setBounds(bounds: Bounds): void {
    this.bounds = {
      x: Math.round(bounds.x),
      y: Math.round(bounds.y),
      width: Math.max(0, Math.round(bounds.width)),
      height: Math.max(0, Math.round(bounds.height)),
    };
    this.attached?.setBounds(this.bounds);
  }

  destroy(): void {
    this.unsubscribeShields();
    this.unsubscribeZoom();
    for (const tab of this.tabs) tab.view?.webContents.close();
    this.tabs = [];
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
   * The active tab's view is attached unless the chrome UI renders in its place
   * (start page, internal page, interstitial).
   */
  private syncAttachment(): void {
    const tab = this.activeId ? this.find(this.activeId) : undefined;
    const wanted = tab && showsWebPage(tab.state.url) && !tab.state.interstitial ? tab.view : null;
    if (wanted === this.attached) return;
    this.detach();
    if (wanted) {
      this.window.contentView.addChildView(wanted);
      wanted.setBounds(this.bounds);
      this.attached = wanted;
    }
  }

  private detach(): void {
    if (this.attached) this.window.contentView.removeChildView(this.attached);
    this.attached = null;
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

    contents.on("did-start-navigation", (details) => {
      if (!details.isMainFrame || details.isSameDocument) return;
      // A new page: fresh blocked counter, and any interstitial gives way to it.
      tab.state.blockedCount = 0;
      if (tab.state.interstitial) {
        tab.state.interstitial = null;
        if (tab.id === this.activeId) this.syncAttachment();
      }
      this.emit();
    });
    contents.on("did-start-loading", () => {
      tab.state.isLoading = true;
      this.emit();
    });
    contents.on("did-stop-loading", () => {
      tab.state.isLoading = false;
      refresh();
    });
    contents.on("did-navigate", (_event, url) => {
      if (url === tab.waking) tab.lastVisit = url;
      else this.visit(tab, url, false);
      tab.waking = undefined;
      this.applyZoom(tab);
      refresh();
    });
    // Ctrl+wheel and pinch: same steps as the zoom commands, remembered per site.
    contents.on("zoom-changed", (_event, direction) => this.zoom(tab.id, direction === "in" ? 1 : -1));
    contents.on("audio-state-changed", (event) => {
      tab.state.isAudible = event.audible;
      this.emit();
    });
    tab.finder = new PageFind(contents, (find) => {
      tab.state.find = find;
      this.emit();
    });
    contents.on("did-navigate-in-page", (_event, url, isMainFrame) => {
      if (isMainFrame) this.visit(tab, url, true);
      refresh();
    });
    contents.on("page-title-updated", (_event, title) => {
      // A parked view (behind the start page or an internal page) does not name the tab.
      if (!showsWebPage(tab.state.url)) return;
      tab.state.title = title || displayUrl(contents.getURL());
      if (title) this.hooks.onPageInfo?.(contents.getURL(), { title });
      this.emit();
    });
    contents.on("page-favicon-updated", (_event, favicons) => {
      if (!showsWebPage(tab.state.url)) return;
      tab.state.favicon = favicons.find(isNavigableUrl) ?? null;
      if (tab.state.favicon) this.hooks.onPageInfo?.(contents.getURL(), { favicon: tab.state.favicon });
      this.emit();
    });
    contents.on("did-fail-load", (_event, code, description, url, isMainFrame) => {
      // -3 is ERR_ABORTED: a navigation replaced by another one, not a real failure.
      if (!isMainFrame || code === -3) return;
      const httpUrl = httpsFallbackFor(contents.id, url, code);
      if (httpUrl) {
        // HTTPS-Only: the upgraded load failed; the chrome UI asks before falling back to http.
        tab.state.interstitial = { kind: "https-only", url: httpUrl };
        tab.state.url = httpUrl;
        tab.state.title = displayUrl(httpUrl);
        tab.state.isLoading = false;
        if (tab.id === this.activeId) this.syncAttachment();
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
