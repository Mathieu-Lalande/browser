import type { CommandId } from "./commands";
import type { Settings, SettingsPatch, SettingsSection } from "./settings";
import type {
  Bookmark,
  BookmarkInput,
  Bounds,
  BrowserState,
  HistoryEntry,
  OverlayBackdrop,
  OverlayRequest,
  SpaceId,
  SpaceInfo,
  SpaceInput,
  TabId,
  UiCommand,
} from "./types";

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
  tabContextMenu: "tab:context-menu",
  tabMoveToSpace: "tab:move-to-space",
  spaceCreate: "space:create",
  spaceUpdate: "space:update",
  spaceRemove: "space:remove",
  spaceSwitch: "space:switch",
  splitOpen: "split:open",
  splitExit: "split:exit",
  splitRatios: "split:ratios",
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
  commandRun: "command:run",
  overlayShow: "overlay:show",
  overlayBackdrop: "overlay:backdrop",
  overlayClose: "overlay:close",
  settingsGet: "settings:get",
  settingsUpdate: "settings:update",
  settingsReset: "settings:reset",
  settingsChanged: "settings:changed",
  settingsOpen: "settings:open",
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
    /** Native context menu for the tab (pin, duplicate, split, move to space, close…). */
    contextMenu(id: TabId): void;
    /** Moves the tab to another space of this window (reloads it if the spaces' sessions differ). */
    moveToSpace(id: TabId, spaceId: SpaceId): void;
  };
  spaces: {
    /** Creates a space (defaults for missing fields) and shows it in this window; null at the limit. */
    create(input?: SpaceInput): Promise<SpaceInfo | null>;
    update(id: SpaceId, input: SpaceInput): void;
    /** Deletes the space and closes its tabs, in every window. The last space cannot be deleted. */
    remove(id: SpaceId): void;
    switchTo(id: SpaceId): void;
  };
  split: {
    /** Shows `tabId` side by side with the active tab (or adds it to the visible split). */
    open(tabId: TabId): void;
    exit(): void;
    /** Divider positions while dragging, 0…1. */
    setRatios(ratioX: number, ratioY: number): void;
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
  commands: {
    /** Runs a registry command (`src/shared/commands.ts`) against this window, like its menu item. */
    run(id: CommandId): void;
  };
  overlay: {
    /** Overlay page only: main asks it to show a floating UI (it is attached and focused right after). */
    onShow(listener: (request: OverlayRequest) => void): () => void;
    /** Overlay page only: snapshot of the window below, sent shortly after `onShow`. */
    onBackdrop(listener: (backdrop: OverlayBackdrop) => void): () => void;
    /**
     * Hides the overlay layer. `restoreFocus`: give focus back to what had it before (cancel);
     * otherwise focus goes to the active page, or the chrome UI on the start page.
     */
    close(restoreFocus?: boolean): void;
  };
  settings: {
    get(): Promise<Settings>;
    /** Validated field by field in main; resolves to the resulting settings. */
    update(patch: SettingsPatch): Promise<Settings>;
    /** Back to defaults: one section, or everything. */
    reset(section?: SettingsSection): Promise<Settings>;
    /** Settings changed (from any window). */
    onChanged(listener: (settings: Settings) => void): () => void;
    /** Shows `browser://settings` in this window (existing tab, or a new one). */
    open(): void;
  };
}
