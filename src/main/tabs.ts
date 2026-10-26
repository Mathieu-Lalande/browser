import { randomUUID } from "node:crypto";
import { WebContentsView, type BaseWindow, type WebContents } from "electron";
import type { Bounds, BrowserState, TabId, TabState } from "@shared/types";
import { displayUrl, isNavigableUrl, normalizeInput } from "@shared/url";
import { hardenWebContents } from "./security";
import type { SessionTab, SessionWindow } from "./storage/session";

const START_TITLE = "Nouvel onglet";
const CONTENT_RADIUS = 10;

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
}

/** Optional integrations (history, bookmarks); TabManager itself does no persistence. */
export interface TabManagerHooks {
  /** A page was committed in a tab (full navigation, or an in-page one to a new URL). */
  onVisit?(url: string): void;
  /** The committed page reported its title or favicon. */
  onPageInfo?(url: string, info: { title?: string; favicon?: string | null }): void;
  isBookmarked?(url: string): boolean;
}

const isDiscarded = (tab: Tab) => !tab.view && tab.state.url !== "";
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

  constructor(
    private readonly window: BaseWindow,
    private readonly onChange: (state: BrowserState) => void,
    private readonly hooks: TabManagerHooks = {},
  ) {}

  getState(): BrowserState {
    return {
      tabs: this.tabs.map((tab) => ({ ...tab.state, isBookmarked: this.isBookmarked(tab.state.url) })),
      activeTabId: this.activeId,
    };
  }

  create(input = "", options: { activate?: boolean; index?: number } = {}): TabId {
    const tab = this.insert({ url: "", title: START_TITLE, favicon: null, pinned: false }, options.index ?? this.tabs.length);
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
    if (this.activeId === id) {
      const next = this.tabs[Math.min(index, this.tabs.length - 1)];
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
    this.wake(tab);
    this.syncAttachment();
    this.emit();
  }

  navigate(id: TabId, input: string): void {
    const tab = this.find(id);
    if (!tab) return;
    const url = normalizeInput(input);
    tab.state.url = url;
    if (!url) {
      tab.state.title = START_TITLE;
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
    if (!tab?.state.url) return;
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

  move(id: TabId, toIndex: number): void {
    const from = this.tabs.findIndex((tab) => tab.id === id);
    if (from === -1) return;
    const [tab] = this.tabs.splice(from, 1);
    this.tabs.splice(Math.max(0, Math.min(toIndex, this.tabs.length)), 0, tab);
    this.emit();
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
    return tab?.state.url && tab.view ? tab.view.webContents : null;
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
    for (const tab of this.tabs) tab.view?.webContents.close();
    this.tabs = [];
  }

  private insert(entry: SessionTab, index: number): Tab {
    const id = randomUUID();
    const tab: Tab = {
      id,
      view: null,
      state: {
        id,
        url: entry.url,
        title: entry.title || (entry.url ? displayUrl(entry.url) : START_TITLE),
        favicon: entry.favicon,
        isLoading: false,
        canGoBack: false,
        canGoForward: false,
        isPinned: entry.pinned,
        isBookmarked: false,
      },
    };
    this.tabs.splice(Math.max(0, Math.min(index, this.tabs.length)), 0, tab);
    return tab;
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
    view.setBorderRadius(CONTENT_RADIUS);
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

  /** The active tab's view is attached unless it shows the start page (rendered by the chrome UI). */
  private syncAttachment(): void {
    const tab = this.activeId ? this.find(this.activeId) : undefined;
    const wanted = tab?.state.url ? tab.view : null;
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
        const index = this.tabs.indexOf(tab) + 1;
        this.create(url, { activate: foreground, index });
      },
    });

    const refresh = () => {
      const url = contents.getURL();
      if (url && url !== "about:blank") tab.state.url = url;
      tab.state.canGoBack = contents.navigationHistory.canGoBack();
      tab.state.canGoForward = contents.navigationHistory.canGoForward();
      this.emit();
    };

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
      refresh();
    });
    contents.on("did-navigate-in-page", (_event, url, isMainFrame) => {
      if (isMainFrame) this.visit(tab, url, true);
      refresh();
    });
    contents.on("page-title-updated", (_event, title) => {
      tab.state.title = title || displayUrl(contents.getURL());
      if (title) this.hooks.onPageInfo?.(contents.getURL(), { title });
      this.emit();
    });
    contents.on("page-favicon-updated", (_event, favicons) => {
      tab.state.favicon = favicons.find(isNavigableUrl) ?? null;
      if (tab.state.favicon) this.hooks.onPageInfo?.(contents.getURL(), { favicon: tab.state.favicon });
      this.emit();
    });
    contents.on("did-fail-load", (_event, code, description, url, isMainFrame) => {
      // -3 is ERR_ABORTED: a navigation replaced by another one, not a real failure.
      if (!isMainFrame || code === -3) return;
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
