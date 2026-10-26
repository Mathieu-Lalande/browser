import type { Bookmark, BookmarkInput, Bounds, BrowserState, HistoryEntry, TabId, UiCommand } from "./types";

/** IPC channel names, shared by main and preload so they cannot drift. */
export const Channels = {
  getState: "browser:get-state",
  state: "browser:state",
  uiCommand: "browser:ui-command",
  tabCreate: "tab:create",
  tabClose: "tab:close",
  tabActivate: "tab:activate",
  tabNavigate: "tab:navigate",
  tabBack: "tab:back",
  tabForward: "tab:forward",
  tabReload: "tab:reload",
  tabStop: "tab:stop",
  tabTogglePin: "tab:toggle-pin",
  tabMove: "tab:move",
  tabToggleShields: "tab:toggle-shields",
  tabProceedHttp: "tab:proceed-http",
  permissionRespond: "permission:respond",
  layoutBounds: "layout:bounds",
  windowMinimize: "window:minimize",
  windowToggleMaximize: "window:toggle-maximize",
  windowClose: "window:close",
  historySearch: "history:search",
  historyTopSites: "history:top-sites",
  historyClear: "history:clear",
  bookmarksList: "bookmarks:list",
  bookmarksAdd: "bookmarks:add",
  bookmarksRemove: "bookmarks:remove",
  bookmarksToggleActive: "bookmarks:toggle-active",
} as const;

/** API exposed to the chrome UI on `window.browser` by the preload script. */
export interface BrowserApi {
  getState(): Promise<BrowserState>;
  onState(listener: (state: BrowserState) => void): () => void;
  onUiCommand(listener: (command: UiCommand) => void): () => void;
  tabs: {
    create(input?: string): void;
    close(id: TabId): void;
    activate(id: TabId): void;
    navigate(id: TabId, input: string): void;
    back(id: TabId): void;
    forward(id: TabId): void;
    reload(id: TabId): void;
    stop(id: TabId): void;
    togglePin(id: TabId): void;
    move(id: TabId, toIndex: number): void;
    /** Turn content blocking off/on for the tab's site, then reload it. */
    toggleShields(id: TabId): void;
    /** HTTPS-Only interstitial: load the http:// address anyway (exception for this session). */
    proceedHttp(id: TabId): void;
  };
  permissions: {
    respond(tabId: TabId, promptId: string, allow: boolean, remember: boolean): void;
  };
  layout: {
    setContentBounds(bounds: Bounds): void;
  };
  window: {
    minimize(): void;
    toggleMaximize(): void;
    close(): void;
  };
  history: {
    /** Entries matching `query` (url + title), best first by match quality × frecency. */
    search(query: string, limit?: number): Promise<HistoryEntry[]>;
    /** Most frecent sites, one entry per host. */
    topSites(limit?: number): Promise<HistoryEntry[]>;
    clear(): Promise<void>;
  };
  bookmarks: {
    list(): Promise<Bookmark[]>;
    /** Resolves to null for URLs that cannot be bookmarked. */
    add(input: BookmarkInput): Promise<Bookmark | null>;
    remove(id: string): Promise<void>;
    /** Bookmarks the active tab of this window, or removes its bookmark. */
    toggleActive(): void;
  };
}
