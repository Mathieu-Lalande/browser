import type { ArchivedTab } from "./archive";
import type { CommandId } from "./commands";
import type { ExtensionInfo, ExtensionInstallResult } from "./extensions";
import type { FolderId, FolderInput } from "./folders";
import type {
  PasswordAccounts,
  PasswordEdit,
  PasswordPrompt,
  PasswordResult,
  PasswordSummary,
  PasswordsStatus,
  PromptAnswer,
} from "./passwords";
import type { DownloadEntry, DownloadsChange } from "./downloads";
import type { Settings, SettingsPatch, SettingsSection } from "./settings";
import type { SiteDataEntry, SiteInfo } from "./site-info";
import type { SyncStatus } from "./sync/controller";
import type {
  Bookmark,
  BookmarkInput,
  Bounds,
  BrowserState,
  HistoryEntry,
  OverlayBackdrop,
  OverlayRequest,
  PermissionKind,
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
  tabOpenBlockedPopup: "tab:open-blocked-popup",
  tabDismissBlockedPopup: "tab:dismiss-blocked-popup",
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
  windowIsMaximized: "window:is-maximized",
  windowMaximized: "window:maximized",
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
  startImage: "settings:start-image",
  tabToggleMute: "tab:toggle-mute",
  findQuery: "find:query",
  findStep: "find:step",
  findClose: "find:close",
  downloadsList: "downloads:list",
  downloadsChanged: "downloads:changed",
  downloadsPause: "downloads:pause",
  downloadsResume: "downloads:resume",
  downloadsCancel: "downloads:cancel",
  downloadsKeep: "downloads:keep",
  downloadsOpen: "downloads:open",
  downloadsShowInFolder: "downloads:show-in-folder",
  downloadsRemove: "downloads:remove",
  downloadsRetry: "downloads:retry",
  downloadsClear: "downloads:clear",
  downloadsChooseFolder: "downloads:choose-folder",
  downloadsShowPanel: "downloads:show-panel",
  downloadsOpenPage: "downloads:open-page",
  syncStatus: "sync:status",
  syncChanged: "sync:changed",
  syncCreate: "sync:create",
  syncPair: "sync:pair",
  syncPairingCode: "sync:pairing-code",
  syncNow: "sync:now",
  syncDisconnect: "sync:disconnect",
  syncReset: "sync:reset",
  siteInfoShow: "site-info:show",
  siteInfoGet: "site-info:get",
  siteInfoResetPermission: "site-info:reset-permission",
  siteInfoClearData: "site-info:clear-data",
  siteInfoAllowThirdPartyCookies: "site-info:allow-third-party-cookies",
  siteDataList: "site-data:list",
  siteDataRemove: "site-data:remove",
  siteDataClearAll: "site-data:clear-all",
  tabPlace: "tab:place",
  folderCreate: "folder:create",
  folderUpdate: "folder:update",
  folderRemove: "folder:remove",
  folderMove: "folder:move",
  favoritesAdd: "favorites:add",
  favoritesRemove: "favorites:remove",
  favoritesMove: "favorites:move",
  favoritesOpen: "favorites:open",
  favoritesContextMenu: "favorites:context-menu",
  archiveList: "archive:list",
  archiveRestore: "archive:restore",
  archiveRemove: "archive:remove",
  archiveClear: "archive:clear",
  archiveChanged: "archive:changed",
  extensionsList: "extensions:list",
  extensionsInstallFolder: "extensions:install-folder",
  extensionsInstallFile: "extensions:install-file",
  extensionsSetEnabled: "extensions:set-enabled",
  extensionsSetPrivateAllowed: "extensions:set-private-allowed",
  extensionsRemove: "extensions:remove",
  extensionsChanged: "extensions:changed",
  passwordsStatus: "passwords:status",
  passwordsList: "passwords:list",
  passwordsNeverList: "passwords:never-list",
  passwordsReveal: "passwords:reveal",
  passwordsCopy: "passwords:copy",
  passwordsUpdate: "passwords:update",
  passwordsRemove: "passwords:remove",
  passwordsRemoveNever: "passwords:remove-never",
  passwordsExport: "passwords:export",
  passwordsChanged: "passwords:changed",
  passwordsShowFill: "passwords:show-fill",
  passwordsAccounts: "passwords:accounts",
  passwordsFill: "passwords:fill",
  passwordsPrompt: "passwords:prompt",
  passwordsAnswer: "passwords:answer",
} as const;

/** Outcome of a sync action (errors are messages for the user: they do not cross IPC as exceptions). */
export type SyncActionResult = { ok: true } | { ok: false; message: string };

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
    /** Mutes the tab's sound, or unmutes it. */
    toggleMute(id: TabId): void;
    /** Native context menu for the tab (pin, duplicate, split, move to space, close…). */
    contextMenu(id: TabId): void;
    /** Moves the tab to another space of this window (reloads it if the spaces' sessions differ). */
    moveToSpace(id: TabId, spaceId: SpaceId): void;
    /** Popup blocker notice: opens the popup the page was refused (main knows its URL). */
    openBlockedPopup(id: TabId): void;
    /** Popup blocker notice: hides it. */
    dismissBlockedPopup(id: TabId): void;
    /** Drag and drop (ADR-022): files the tab in `folderId` (null: root), before `beforeId` or at the end. */
    place(id: TabId, folderId: FolderId | null, beforeId: TabId | null): void;
  };
  /** Sidebar folders of the space shown (ADR-022). */
  folders: {
    /** Creates a folder (in `parentId`, else at the root), moving `tabIds` into it. */
    create(input?: FolderInput, parentId?: FolderId | null, tabIds?: TabId[]): void;
    update(id: FolderId, input: FolderInput): void;
    /** Deletes the folder and its sub-folders; their tabs are closed or go back to the parent. */
    remove(id: FolderId, closeTabs: boolean): void;
    move(id: FolderId, parentId: FolderId | null, index: number): void;
  };
  /** The favorites grid (ADR-022). Editing is refused from private windows. */
  favorites: {
    /** Adds the page of one of this window's tabs (main reads its URL). */
    add(tabId: TabId, index?: number): void;
    remove(url: string): void;
    move(url: string, index: number): void;
    /** Shows the favorite's tab, or opens it. */
    open(url: string): void;
    contextMenu(url: string): void;
  };
  /** Archived tabs (ADR-022). A private window can read and reopen them, not change the list. */
  archive: {
    list(query?: string): Promise<ArchivedTab[]>;
    restore(id: string): void;
    remove(id: string): void;
    clear(): void;
    onChanged(listener: () => void): () => void;
  };
  /**
   * Browser extensions (ADR-024). Paths never come from the UI: main asks with a file dialog.
   * A private window can list them, not change them (they live in the profile).
   */
  extensions: {
    list(): Promise<ExtensionInfo[]>;
    /** Unpacked extension folder (used in place). Null: cancelled. */
    installFromFolder(): Promise<ExtensionInstallResult>;
    /** A .zip or .crx, unpacked into the profile. Null: cancelled. */
    installFromFile(): Promise<ExtensionInstallResult>;
    setEnabled(id: string, enabled: boolean): Promise<void>;
    setPrivateAllowed(id: string, allowed: boolean): Promise<void>;
    remove(id: string): Promise<void>;
    onChanged(listener: () => void): () => void;
  };
  /**
   * Password manager (ADR-025). Lists carry no password: one reaches the UI only through `reveal`,
   * after the user confirmed; `copy` and `exportCsv` stay in main (clipboard, save dialog).
   */
  passwords: {
    status(): Promise<PasswordsStatus>;
    list(): Promise<PasswordSummary[]>;
    neverList(): Promise<string[]>;
    reveal(id: string): Promise<string | null>;
    /** Copies the password to the clipboard (cleared after 30 s if still there). */
    copy(id: string): Promise<boolean>;
    update(id: string, edit: PasswordEdit): Promise<PasswordResult>;
    remove(id: string): Promise<void>;
    removeNever(origin: string): Promise<void>;
    /** Asks main for a file (save dialog) and writes the CSV there. Null: cancelled. */
    exportCsv(): Promise<PasswordResult | null>;
    onChanged(listener: () => void): () => void;
    /** Chrome UI: the fill popover for the active tab, hanging from `anchor` (the address bar's key). */
    showFill(anchor: Bounds): void;
    /** Usernames saved for the tab's page (main reads its URL). */
    accounts(tabId: TabId): Promise<PasswordAccounts | null>;
    /** Fills the tab's login form with an entry of the page's own origin. */
    fill(tabId: TabId, id: string): Promise<boolean>;
    /** Overlay: what the save prompt shows for a pending capture. */
    prompt(captureId: string): Promise<PasswordPrompt | null>;
    answer(captureId: string, answer: PromptAnswer): Promise<PasswordResult>;
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
    /** Whether the window is maximized (the maximize button shows "restore" then). */
    isMaximized(): Promise<boolean>;
    onMaximizedChange(listener: (maximized: boolean) => void): () => void;
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
    /**
     * The start page's background image as a data: URL, fetched by main (the UI loads no remote
     * image); null when there is none, it failed, or in a private window.
     */
    startImage(): Promise<string | null>;
  };
  find: {
    /** Searches the tab's page for `query` (new search: the first match from the top is highlighted). */
    query(tabId: TabId, query: string, matchCase: boolean): void;
    /** Next (forward) or previous match of the current query. */
    step(tabId: TabId, forward: boolean): void;
    /** Hides the find bar and clears the highlights (the query is kept for the tab). */
    close(tabId: TabId): void;
  };
  downloads: {
    /** Every download, newest first. */
    list(): Promise<DownloadEntry[]>;
    /** Downloads added, updated or forgotten (from any window). */
    onChanged(listener: (change: DownloadsChange) => void): () => void;
    pause(id: string): void;
    resume(id: string): void;
    /** Cancels a running download, or discards a dangerous file waiting for confirmation. */
    cancel(id: string): void;
    /** Keeps a dangerous file: moves it to the downloads folder under its real name. */
    keep(id: string): void;
    /** Opens a completed file with its default app (never automatic). */
    open(id: string): void;
    showInFolder(id: string): void;
    /** Forgets a finished download (the file stays on disk). */
    remove(id: string): void;
    /** Starts a failed or interrupted download again from its original URL (same session). */
    retry(id: string): void;
    /** Forgets every finished download. */
    clear(): void;
    /** Folder picker (native dialog in main); resolves to the resulting settings. */
    chooseFolder(): Promise<Settings>;
    /** Chrome UI: opens the downloads popover in the overlay layer, hanging from `anchor`. */
    showPanel(anchor: Bounds): void;
    /** Shows `browser://downloads` in this window. */
    openPage(): void;
  };
  /** End-to-end encrypted sync (ADR-019). Account actions are refused from private windows. */
  sync: {
    status(): Promise<SyncStatus>;
    onChanged(listener: (status: SyncStatus) => void): () => void;
    /** First device: creates an account on a self-hosted relay. */
    createAccount(serverUrl: string, registrationSecret?: string): Promise<SyncActionResult>;
    /** Joins an account with a pairing code (text form of the QR code). */
    pair(code: string): Promise<SyncActionResult>;
    /** The pairing code (full access to the synced data): only after an explicit user action. */
    pairingCode(): Promise<string | null>;
    syncNow(): void;
    /** Forgets the account on this device and removes it from the devices list. */
    disconnect(): Promise<SyncActionResult>;
    /** Erases the account on the server and starts over with a new key (other devices must pair again). */
    reset(): Promise<SyncActionResult>;
  };
  /**
   * Site info popover (ADR-021). The UI only names the tab: main reads its URL and session (a
   * private window's own), so nothing here can reach another site or the profile from a private window.
   */
  siteInfo: {
    /** Chrome UI: opens the popover for the active tab, hanging from `anchor` (the address bar's lock). */
    show(anchor: Bounds): void;
    get(tabId: TabId): Promise<SiteInfo | null>;
    /** Forgets one permission decision taken on the tab's site; resolves to the updated info. */
    resetPermission(tabId: TabId, origin: string, kind: PermissionKind): Promise<SiteInfo | null>;
    /** Clears the site's cookies and storage in the tab's session, then reloads the tab. */
    clearData(tabId: TabId): Promise<SiteInfo | null>;
    /** Third-party cookie blocking: makes the tab's site an exception (refused in private windows). */
    allowThirdPartyCookies(tabId: TabId, allow: boolean): Promise<SiteInfo | null>;
  };
  /**
   * Cookies and site data of the profile (default session and isolated spaces), for the settings.
   * Null in a private window, which never manages the profile's data.
   */
  siteData: {
    list(): Promise<SiteDataEntry[] | null>;
    /** Clears a site's cookies and storage everywhere in the profile; resolves to the new list. */
    remove(site: string): Promise<SiteDataEntry[] | null>;
    clearAll(): Promise<SiteDataEntry[] | null>;
  };
}
