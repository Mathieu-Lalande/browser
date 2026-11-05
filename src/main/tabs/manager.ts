import { WebContentsView, session as electronSession, type BaseWindow, type Session, type WebContents } from "electron";
import type { FolderId, FolderInput } from "@shared/folders";
import { INTERNAL_PAGES, internalPageOf, internalUrl, type InternalPage } from "@shared/internal";
import type { Bounds, TabId, TabState, TabsState } from "@shared/types";
import { displayUrl, isLocalFileUrl, normalizeInput } from "@shared/url";
import { webHostname } from "@shared/hosts";
import { InPageVisits } from "../activation";
import { onShieldsChange, shieldsEnabledFor } from "../privacy";
import type { SleepCandidate } from "../sleep";
import type { SessionTab, SessionTabList } from "../storage/session";
import { TAB_WEB_PREFERENCES, type PopupOptions } from "../security";
import { onSiteZoomChange } from "../zoom";
import { sameFactor } from "../zoom/levels";
import { TabEvents } from "./events";
import { TabFolders } from "./folders";
import { TabLayout } from "./layout";
import { TabLifecycle } from "./lifecycle";
import {
  DEFAULT_TAB_OPTIONS,
  START_TITLE,
  historyOf,
  isDiscarded,
  liveContents,
  showsWebPage,
  unwire,
  type ReleasedTab,
  type Tab,
  type TabManagerHooks,
  type TabManagerOptions,
  type TabOptions,
} from "./model";
import { TabPageActions } from "./page-actions";
import { TabStore, type ClosedTab } from "./store";

/** Title of a popup tab until its page names itself. */
const POPUP_TITLE = "Chargement…";

/**
 * Owns the web pages of one space of one window: each tab is a sandboxed WebContentsView that is
 * attached to the window only while it is the active tab (or one of the tabs of a visible split).
 *
 * A facade over collaborating parts: `TabStore` (records and order), `TabLayout` (what is on
 * screen, split view), `TabLifecycle` (pages created, put to sleep and woken), `TabEvents` (the
 * pages' events), `TabFolders` (sidebar folders) and `TabPageActions` (zoom, find, reader…).
 */
export class TabManager {
  private readonly store = new TabStore();
  private readonly layout: TabLayout;
  private readonly lifecycle: TabLifecycle;
  private readonly events: TabEvents;
  private readonly folders: TabFolders;
  private readonly actions: TabPageActions;
  private session: Session | undefined;
  private emitScheduled = false;
  private readonly unsubscribeShields: () => void;
  private readonly unsubscribeZoom: () => void;
  private options: TabOptions = { ...DEFAULT_TAB_OPTIONS };

  constructor(
    window: BaseWindow,
    private readonly onChange: (state: TabsState) => void,
    private readonly hooks: TabManagerHooks = {},
    options: TabManagerOptions = {},
  ) {
    this.session = options.session;
    const { store } = this;
    const emit = () => this.emit();
    const shieldsFor = (url: string) => shieldsEnabledFor(url, this.session);
    this.layout = new TabLayout(window, store, options.visible ?? true);
    const { layout } = this;
    this.actions = new TabPageActions({
      store,
      layout,
      options: () => this.options,
      session: () => this.session,
      emit,
      reload: (id) => this.reload(id),
      navigate: (id, input) => this.navigate(id, input),
      create: (input, createOptions) => this.create(input, createOptions),
    });
    this.lifecycle = new TabLifecycle({
      store,
      layout,
      createView: () => this.createView(),
      wire: (tab, contents) => this.events.wire(tab, contents),
      viewCreated: (tab, contents) => {
        if (tab.state.mobileSite) this.actions.applyUserAgent(tab, contents);
      },
      applyZoom: (tab) => this.actions.applyZoom(tab),
      shieldsFor,
      emit,
    });
    this.events = new TabEvents({
      store,
      layout,
      lifecycle: this.lifecycle,
      actions: this.actions,
      hooks,
      shieldsFor,
      emit,
      create: (input, createOptions) => this.create(input, createOptions),
      activate: (id) => this.activate(id),
      zoom: (id, direction) => this.zoom(id, direction),
      pageClosed: (tab) => this.pageClosed(tab),
      adoptPopup: (opener, options, url, foreground) => this.adoptPopup(opener, options, url, foreground),
    });
    this.folders = new TabFolders({ store, close: (id) => this.close(id), emit });
    // Shields toggled for a site (from any window) apply to every tab showing it.
    this.unsubscribeShields = onShieldsChange(() => {
      for (const tab of store.all) tab.state.shieldsEnabled = shieldsFor(tab.state.url);
      this.emit();
    });
    // A site zoomed (from any window): its other tabs follow.
    this.unsubscribeZoom = onSiteZoomChange((host) => {
      for (const tab of store.all) if (webHostname(liveContents(tab)?.getURL() ?? "") === host) this.actions.applyZoom(tab);
    });
  }

  getState(): TabsState {
    const { split } = this.layout;
    return {
      tabs: this.store.all.map((tab) => ({
        ...tab.state,
        isBookmarked: this.isBookmarked(tab.state.url),
        isFavorite: tab.state.url !== "" && (this.hooks.isFavorite?.(tab.state.url) ?? false),
        isAsleep: isDiscarded(tab),
        hasPasswords: showsWebPage(tab.state.url) && (this.hooks.hasPasswords?.(tab.state.url) ?? false),
        reader: this.layout.showsReader(tab),
        ...this.translationOf(tab),
      })),
      activeTabId: this.store.active,
      split: split && { ...split, tabIds: [...split.tabIds] },
      folders: this.folders.list(),
    };
  }

  /** The tab's translation (ADR-036): web pages only. */
  private translationOf(tab: Tab): Pick<TabState, "translation" | "translated"> {
    const translation = showsWebPage(tab.state.url) ? (this.hooks.translation?.(tab.id) ?? null) : null;
    return { translation, translated: translation?.status === "translated" || translation?.status === "translating" };
  }

  /** Updates preferences; already open page views pick up the new radius right away. */
  configure(options: Partial<TabOptions>): void {
    const radiusChanged = options.pageRadius !== undefined && options.pageRadius !== this.options.pageRadius;
    const zoomChanged = options.defaultZoom !== undefined && !sameFactor(options.defaultZoom, this.options.defaultZoom);
    this.options = { ...this.options, ...options };
    if (radiusChanged) for (const tab of this.store.all) tab.view?.setBorderRadius(this.options.pageRadius);
    if (zoomChanged) for (const tab of this.store.all) this.actions.applyZoom(tab);
  }

  /** `localFile`: `input` is a `file://` URL main checked (ADR-039), loaded as it is. */
  create(input = "", options: { activate?: boolean; index?: number; folderId?: FolderId | null; localFile?: boolean } = {}): TabId {
    const folderId = options.folderId && this.folders.has(options.folderId) ? options.folderId : undefined;
    const tab = this.insert({ url: "", title: START_TITLE, favicon: null, pinned: false, folderId }, options.index ?? this.store.newTabIndex(this.options.newTabPosition));
    if (folderId) this.folders.reorder();
    if (options.activate ?? true) this.activate(tab.id);
    this.navigate(tab.id, input, { localFile: options.localFile });
    this.emit();
    return tab.id;
  }

  /**
   * Brings back a saved window. Tabs are restored discarded (url, title and favicon only):
   * just the active one loads now, the others on first activation.
   */
  restore(saved: SessionTabList): void {
    this.folders.restore(saved.folders);
    const restored = saved.tabs.map((entry) => this.insert(entry, this.store.length));
    if (saved.split) {
      const tabIds = saved.split.tabIndexes.map((index) => restored[index]?.id).filter((id) => id !== undefined);
      this.layout.restoreSplit(saved.split, tabIds);
    }
    // Pinned tabs always sit before unpinned ones.
    this.store.sortPinnedFirst();
    const active = this.store.all[saved.activeIndex] ?? this.store.all[0];
    this.folders.reorder();
    if (active) this.activate(active.id);
    else this.create();
  }

  /** What to save to restore this window later. */
  snapshot(): SessionTabList {
    const onScreen = new Set(this.layout.visibleTabs());
    return {
      tabs: this.store.snapshot((tab) => onScreen.has(tab)),
      activeIndex: Math.max(0, this.store.indexOf(this.store.active ?? "")),
      split: this.layout.snapshotSplit(),
      ...(this.folders.size ? { folders: this.folders.list() } : {}),
    };
  }

  // --- Folders (ADR-022, see ./folders.ts) -----------------------------------------------------

  /**
   * Creates a folder (in `parentId`, or at the root), optionally moving tabs into it. Returns its
   * id, or null at the limit / too deep.
   */
  createFolder(input: FolderInput = {}, parentId: FolderId | null = null, tabIds: readonly TabId[] = []): FolderId | null {
    return this.folders.create(input, parentId, tabIds);
  }

  updateFolder(id: FolderId, input: FolderInput): void {
    this.folders.update(id, input);
  }

  /** Deletes a folder and its sub-folders; their tabs are closed, or go back to the parent container. */
  removeFolder(id: FolderId, closeTabs: boolean): void {
    this.folders.remove(id, closeTabs);
  }

  moveFolder(id: FolderId, parentId: FolderId | null, index: number): void {
    this.folders.move(id, parentId, index);
  }

  /** Moves a tab into a folder (null: the root), before `beforeId` or at the end of it. */
  placeTab(tabId: TabId, folderId: FolderId | null, beforeId: TabId | null): void {
    this.folders.placeTab(tabId, folderId, beforeId);
  }

  /** Re-sends the state, e.g. after a bookmark change that affects `isBookmarked`. */
  refresh(): void {
    this.emit();
  }

  close(id: TabId): void {
    const index = this.store.indexOf(id);
    const tab = this.remove(id);
    if (!tab) return;
    this.store.rememberClosed(tab.state.url, index, tab.state.title);
    unwire(tab);
    liveContents(tab)?.close();
  }

  /** Whether a closed tab can be reopened. */
  get canReopenClosed(): boolean {
    return this.store.canReopenClosed;
  }

  /** The closed tabs of this list, most recent first (app menu, ADR-042). */
  closedTabs(): readonly ClosedTab[] {
    return this.store.closedTabs();
  }

  /** Reopens a closed tab (the last one by default) where it was (its URL: the page loads again). */
  reopenClosed(at = 0): TabId | null {
    const last = this.store.popClosed(at);
    if (!last) return null;
    return this.create(last.url, { index: Math.min(Math.max(0, last.index), this.store.length) });
  }

  /**
   * Takes a tab out of this manager without closing its page, for `adopt` by another manager
   * (moving a tab to another space).
   */
  release(id: TabId): ReleasedTab | null {
    const tab = this.remove(id);
    if (!tab) return null;
    unwire(tab);
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
    this.store.place(tab, options.index ?? this.store.length);
    if (view) this.events.wire(tab, view.webContents);
    // A manager always has an active tab once it has tabs.
    if (options.activate || !this.store.active) this.activate(tab.id);
    this.emit();
    return tab.id;
  }

  activate(id: TabId): void {
    const tab = this.store.find(id);
    if (!tab) return;
    this.lifecycle.markSeen();
    this.store.setActive(id);
    tab.state.lastActiveAt = Date.now();
    for (const shown of this.layout.visibleTabs()) this.lifecycle.wake(shown);
    this.layout.syncAttachment();
    this.emit();
  }

  /** Shows (space switched to) or hides this manager's pages. Showing loads the active tab if needed. */
  setVisible(visible: boolean): void {
    if (this.layout.visible === visible) return;
    this.lifecycle.markSeen();
    this.layout.visible = visible;
    if (visible && this.store.active) this.activate(this.store.active);
    else this.layout.syncAttachment();
  }

  /**
   * Moves every tab to another session (a space became isolated or shared again): pages are closed
   * and reload in the new session, the visible ones right away, the others when activated.
   */
  setSession(session: Session | undefined): void {
    if (session === this.session) return;
    this.session = session;
    this.layout.detach();
    for (const tab of this.store.all) this.lifecycle.closePage(tab);
    if (this.store.active) this.activate(this.store.active);
  }

  /** "Ouvrir en vue scindée avec l'onglet actif": shows `id` next to the active tab (or adds it to its split). */
  openSplit(id: TabId): boolean {
    if (!this.store.find(id) || !this.layout.openSplit(id)) return false;
    if (this.store.active) this.activate(this.store.active);
    return true;
  }

  /** Leaves split view: the active tab stays, alone. */
  exitSplit(): void {
    if (!this.layout.split) return;
    this.lifecycle.markSeen();
    this.layout.exitSplit();
    this.layout.syncAttachment();
    this.emit();
  }

  /** Divider positions (from the chrome UI's drag), 0…1 each, clamped. */
  setSplitRatios(ratioX: number, ratioY: number): void {
    if (this.layout.setRatios(ratioX, ratioY)) this.emit();
  }

  /** Whether the split is on screen (the active tab is one of its tabs). */
  get splitVisible(): boolean {
    return this.layout.splitVisible;
  }

  /**
   * Loads what the user typed (or an internal page). Local file URLs may come from the address bar
   * or from an OS file association; page-initiated file navigation remains blocked by hardening.
   */
  navigate(id: TabId, input: string, _options: { localFile?: boolean } = {}): void {
    const tab = this.store.find(id);
    if (!tab) return;
    const url = _options.localFile && isLocalFileUrl(input) ? input : normalizeInput(input, this.options.searchEngine);
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
      this.lifecycle.ensureView(tab).webContents.loadURL(url).catch(() => {
        // Load failures are reported through did-fail-load.
      });
    }
    this.lifecycle.updateHistory(tab);
    this.layout.syncAttachment();
    this.emit();
  }

  /** Back: in the page's history, or from the start page / an internal page to the page parked below it. */
  back(id: TabId): void {
    const tab = this.store.find(id);
    const contents = tab && liveContents(tab);
    if (!tab || !contents) return;
    if (showsWebPage(tab.state.url)) contents.navigationHistory.goBack();
    else if (contents.getURL()) this.lifecycle.unpark(tab, contents);
  }

  /** Forward: to the start page / internal page left with Back, else in the page's history. */
  forward(id: TabId): void {
    const tab = this.store.find(id);
    if (!tab) return;
    if (tab.forwardTo !== undefined && showsWebPage(tab.state.url)) this.navigate(id, tab.forwardTo);
    else liveContents(tab)?.navigationHistory.goForward();
  }

  reload(id: TabId): void {
    const tab = this.store.find(id);
    if (!tab || !showsWebPage(tab.state.url)) return;
    const contents = liveContents(tab);
    // A crashed page (ADR-042) gets a new renderer by loading its address again.
    if (contents?.isCrashed()) void contents.loadURL(tab.state.url).catch(() => {});
    else if (contents) contents.reload();
    else this.lifecycle.wake(tab);
  }

  stop(id: TabId): void {
    const tab = this.store.find(id);
    if (tab) liveContents(tab)?.stop();
  }

  togglePin(id: TabId): void {
    const tab = this.store.find(id);
    if (!tab) return;
    tab.state.isPinned = !tab.state.isPinned;
    // A pinned tab leaves its folder.
    if (tab.state.isPinned) tab.state.folderId = null;
    // Pinned tabs always sit before unpinned ones: the tab joins the end of its new group.
    this.store.repin(tab);
    this.folders.reorder();
    this.emit();
  }

  /**
   * Opens a copy of a tab right after it (after the pinned tabs, as copies are not pinned),
   * with its back/forward history, and activates it.
   */
  duplicate(id: TabId): TabId | undefined {
    const source = this.store.find(id);
    if (!source) return undefined;
    const { url, title, favicon } = source.state;
    const copy = this.insert({ url, title, favicon, pinned: false, folderId: source.state.folderId ?? undefined }, this.store.all.indexOf(source) + 1);
    const history = historyOf(source);
    if (history) {
      const view = this.lifecycle.ensureView(copy);
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

  // --- Page actions (see ./page-actions.ts) ----------------------------------------------------

  /**
   * Zooms the tab's page one step in (1) or out (-1), or back to the default zoom (0). The level
   * is remembered for the site (every tab on it follows), except for pages without a web host.
   */
  zoom(id: TabId, direction: 1 | -1 | 0): void {
    this.actions.zoom(id, direction);
  }

  toggleMute(id: TabId): void {
    this.actions.toggleMute(id);
  }

  /** Opens the find bar on the tab's page; false (no-op) on the start page and internal pages. */
  openFind(id: TabId): boolean {
    return this.actions.openFind(id);
  }

  findQuery(id: TabId, query: string, matchCase: boolean): void {
    this.actions.findQuery(id, query, matchCase);
  }

  findStep(id: TabId, forward: boolean): void {
    this.actions.findStep(id, forward);
  }

  /** Closes the find bar; the page gets the focus back when it is the active tab. */
  closeFind(id: TabId): void {
    this.actions.closeFind(id);
  }

  /** Picture-in-picture on the page's main video (or back from it). */
  pictureInPicture(id: TabId): void {
    this.actions.pictureInPicture(id);
  }

  /** Turn content blocking off (or back on) for the tab's site, then reload to apply it. */
  toggleShields(id: TabId): void {
    this.actions.toggleShields(id);
  }

  /** HTTPS-Only interstitial: the user accepts plain http for this host (until the browser quits). */
  proceedHttp(id: TabId): void {
    this.actions.proceedHttp(id);
  }

  /** The user opens the popup the blocker stopped ("Ouvrir" in the notice), next to its tab. */
  openBlockedPopup(id: TabId): void {
    this.actions.openBlockedPopup(id);
  }

  dismissBlockedPopup(id: TabId): void {
    this.actions.dismissBlockedPopup(id);
  }

  respondPermission(id: TabId, promptId: string, allow: boolean, remember: boolean): void {
    this.actions.respondPermission(id, promptId, allow, remember);
  }

  /**
   * Turns reader mode on (main extracted the article of `url`) or off. Refused when the tab moved
   * on to another page meanwhile.
   */
  setReader(id: TabId, on: boolean, url?: string): boolean {
    return this.actions.setReader(id, on, url);
  }

  /** "Demander la version mobile" (ADR-026): a mobile user agent for this tab's page, then a reload. */
  toggleMobileSite(id: TabId): void {
    this.actions.toggleMobileSite(id);
  }

  move(id: TabId, toIndex: number): void {
    if (!this.store.move(id, toIndex)) return;
    this.folders.reorder();
    this.emit();
  }

  /** Cycle through tabs in sidebar order (Ctrl+Tab / Ctrl+Shift+Tab). */
  cycle(direction: 1 | -1): void {
    const tabs = this.store.all;
    if (tabs.length < 2 || !this.store.active) return;
    const index = this.store.indexOf(this.store.active);
    const next = tabs[(index + direction + tabs.length) % tabs.length];
    this.activate(next.id);
  }

  activateIndex(index: number): void {
    const tab = index < 0 ? this.store.all.at(-1) : this.store.all[index];
    if (tab) this.activate(tab.id);
  }

  get activeTabId(): TabId | null {
    return this.store.active;
  }

  /** The page of `id` when it is on screen (attached): only those can be captured (tab preview, ADR-038). */
  visiblePage(id: TabId): WebContents | null {
    return this.layout.visiblePage(this.store.find(id));
  }

  activeWebContents(): WebContents | null {
    const tab = this.store.active ? this.store.find(this.store.active) : undefined;
    return tab && showsWebPage(tab.state.url) ? liveContents(tab) : null;
  }

  /** Shows an internal page: switches to its tab if one is open, else opens it in a new tab. */
  openInternal(page: InternalPage, fragment?: string | null): void {
    const url = internalUrl(page, fragment);
    const existing = this.store.all.find((tab) => internalPageOf(tab.state.url) === page);
    if (!existing) {
      this.create(url, { index: this.store.indexAfterActive() });
      return;
    }
    // A deep link (ADR-032) moves the open page to its row.
    if (fragment && existing.state.url !== url) this.navigate(existing.id, url);
    this.activate(existing.id);
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
    const tab = this.insert({ url, title: contents.getTitle(), favicon: null, pinned: false }, options.index ?? this.store.newTabIndex(this.options.newTabPosition));
    tab.view = view;
    view.setBorderRadius(this.options.pageRadius);
    tab.state.isLoading = contents.isLoading();
    this.events.wire(tab, contents);
    this.events.visit(tab, url, false);
    this.lifecycle.updateHistory(tab);
    this.actions.applyZoom(tab);
    if (options.favicons?.length) this.events.fetchFavicon(tab, contents, options.favicons, url, false);
    if (options.activate ?? true) this.activate(tab.id);
    this.emit();
    return tab.id;
  }

  /**
   * A page opened by `window.open` after a gesture (ADR-018): the page Chromium created keeps its
   * opener, name and `window.close()`, and becomes a tab right after `opener` (in its folder). It
   * shows "Chargement…" on white until it commits a document; when it closes itself while on
   * screen, its opener comes back.
   */
  private adoptPopup(opener: Tab, options: PopupOptions, url: string, foreground: boolean): WebContents {
    const view = new WebContentsView({
      ...(options.webContents ? { webContents: options.webContents } : {}),
      webPreferences: { ...(this.session ? { session: this.session } : {}), ...TAB_WEB_PREFERENCES },
    });
    view.setBorderRadius(this.options.pageRadius);
    view.setBackgroundColor("#ffffff");
    const contents = view.webContents;
    const folderId = opener.state.folderId && this.folders.has(opener.state.folderId) ? opener.state.folderId : undefined;
    const openerIndex = this.store.indexOf(opener.id);
    const index = openerIndex >= 0 ? openerIndex + 1 : this.store.newTabIndex(this.options.newTabPosition);
    const tab = this.insert({ url: url || "about:blank", title: POPUP_TITLE, favicon: null, pinned: false, folderId }, index);
    if (folderId) this.folders.reorder();
    tab.view = view;
    tab.state.isLoading = true;
    // Before the tab's own listeners (which remove it): was it on screen when it closed itself?
    contents.once("destroyed", () => {
      const shown = this.store.active === tab.id;
      queueMicrotask(() => {
        if (shown && this.store.find(opener.id) && !this.store.find(tab.id)) this.activate(opener.id);
      });
    });
    this.events.wire(tab, contents);
    this.actions.applyZoom(tab);
    // No page from Chromium (never seen for window.open): load the address in ours.
    if (!options.webContents) void contents.loadURL(url).catch(() => {});
    if (foreground) this.activate(tab.id);
    this.emit();
    return contents;
  }

  /** Position of a tab in the list (-1 if unknown). */
  indexOf(id: TabId): number {
    return this.store.indexOf(id);
  }

  /** The whole page area (every pane of a split), in window content coordinates. */
  get area(): Bounds {
    return this.layout.area;
  }

  /** Where the active page is drawn, in window content coordinates (its pane in a split). */
  get viewBounds(): Bounds {
    return this.layout.viewBounds;
  }

  setBounds(bounds: Bounds): void {
    this.layout.setBounds(bounds);
  }

  destroy(): void {
    this.unsubscribeShields();
    this.unsubscribeZoom();
    // The window is closing: its views go with it (removing them from a destroyed window hangs).
    this.layout.forget();
    for (const tab of this.store.clear()) {
      unwire(tab);
      // A page that already closed itself is skipped (closing it again would throw).
      liveContents(tab)?.close();
    }
  }

  // --- Tab sleeping (ADR-014, policy and scheduler in ../sleep.ts) -----------------------------

  /** What the sleep policy needs to know about each tab; tabs on screen are marked seen now. */
  sleepCandidates(now = Date.now()): SleepCandidate[] {
    return this.lifecycle.sleepCandidates(now);
  }

  /** The live page of a tab (null when it has none: start page, discarded…). */
  pageOf(id: TabId): WebContents | null {
    const tab = this.store.find(id);
    return tab ? liveContents(tab) : null;
  }

  /**
   * Puts a background tab to sleep: its page is destroyed, url/title/favicon (and the back/forward
   * list) are kept, and it loads again when activated, like a tab restored from the session.
   * Refused for tabs on screen. The caller checks the policy (`../sleep.ts`) first.
   */
  discard(id: TabId): boolean {
    return this.lifecycle.discard(this.store.find(id));
  }

  /** Makes another tab active (the most recently used one), so that `id` can sleep. */
  activateOther(id: TabId): boolean {
    const next = this.store.otherThan(id);
    if (!next) return false;
    if (this.layout.inSplit(id)) this.exitSplit();
    this.activate(next);
    return true;
  }

  /** Removes a tab from the list (active tab and split follow); its page is left to the caller. */
  private remove(id: TabId): Tab | undefined {
    const taken = this.store.take(id);
    if (!taken) return undefined;
    const { tab, index } = taken;
    this.layout.removeFromSplit(id);
    this.layout.detachView(tab.view);
    if (this.store.active === id) {
      const next = this.store.closeSuccessor(index, this.options.closeTabActivates);
      this.store.setActive(null);
      if (next) this.activate(next.id);
      else this.layout.detach();
    } else {
      this.layout.syncAttachment();
    }
    if (this.store.length === 0) this.create();
    this.emit();
    return tab;
  }

  /** The page closed itself (`window.close()`): the tab goes away, as if the user closed it. */
  private pageClosed(tab: Tab): void {
    // Pages closed by the manager itself (close, sleep, move…) are unwired first: this never runs for them.
    if (!this.store.all.includes(tab)) return;
    unwire(tab);
    this.remove(tab.id);
  }

  private insert(entry: SessionTab, index: number): Tab {
    return this.store.insert(entry, index, { shieldsEnabled: shieldsEnabledFor(entry.url, this.session), defaultZoom: this.options.defaultZoom });
  }

  private createView(): WebContentsView {
    const view = new WebContentsView({
      webPreferences: { ...(this.session ? { session: this.session } : {}), ...TAB_WEB_PREFERENCES },
    });
    view.setBorderRadius(this.options.pageRadius);
    view.setBackgroundColor("#ffffff");
    return view;
  }

  private sessionOf(): Session {
    return this.session ?? electronSession.defaultSession;
  }

  private isBookmarked(url: string): boolean {
    return url !== "" && (this.hooks.isBookmarked?.(url) ?? false);
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
