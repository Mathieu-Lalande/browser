import type { ArchivedTab } from "./archive";
import type { AnnotationExportFormat } from "./annotations/export";
import type { AnnotationResult, AnnotationsList, Highlight, HighlightColor, HighlightPatch, TabAnnotations } from "./annotations/model";
import type { Boost, BoostInput, BoostResult } from "./boosts";
import type { CommandId } from "./commands";
import type { DefaultBrowserStatus } from "./default-browser";
import type { WidevineStatus } from "./drm";
import type { HistoryClearRange, HistoryCursor, HistoryPage } from "./history";
import type { ImportItem, ImportProgress, ImportSource, ImportSummary, PasswordImportSummary } from "./import/types";
import type { ExtensionInfo, ExtensionInstallResult } from "./extensions";
import type { FolderId, FolderInput } from "./folders";
import type {
  AddressInput,
  AutofillAnswer,
  AutofillList,
  AutofillPrompt,
  AutofillResult,
  AutofillRevealResult,
  AutofillStatus,
  AutofillSuggestions,
} from "./autofill/ipc";
import type { CardInput } from "./autofill/model";
import type { FieldSection } from "./autofill/classify";
import type {
  PasswordAccounts,
  PasswordEdit,
  PasswordPrompt,
  PasswordResult,
  RevealResult,
  PasswordSummary,
  PasswordsStatus,
  PromptAnswer,
} from "./passwords";
import type { DownloadEntry, DownloadsChange } from "./downloads";
import type { MediaAction, MediaSource } from "./media";
import type { OmniboxTab, OpenDisposition } from "./omnibox/types";
import type { PeekAction, PeekState } from "./peek";
import type { ReaderArticle } from "./reader";
import type { TranslateProviderId } from "./translate/providers";
import type { TranslateKeysStatus, TranslatePanelState, TranslateResultMessage, TranslateRuleChange } from "./translate/state";
import type { Settings, SettingsPatch, SettingsSection } from "./settings";
import type { ClosedLists } from "./recovery";
import type { ProfileId, ProfileInfo, ProfileInput, ProfilesView } from "./profiles";
import type { TaskRow } from "./tasks";
import type { PrintOptions, PrintPrinter, PrintResult } from "./print";
import type { BackupMode, BackupSummary } from "./backup";
import type { KeyPress } from "./accelerators";
import type { SiteDataEntry, SiteInfo } from "./site-info";
import type { SyncStatus } from "./sync/controller";
import type { SharedTheme, ThemeDecodeResult } from "./theme-share";
import type { UpdateStatus } from "./updates";
import type { WeatherPlace } from "./start-widgets";
import type { Forecast } from "./weather";
import type { CrashReportsInfo } from "./diagnostics";
import type {
  Bookmark,
  BookmarkInput,
  Bounds,
  BrowserState,
  TabBoost,
  HistoryEntry,
  OverlayBackdrop,
  OverlayRequest,
  PermissionKind,
  SpaceId,
  SpaceInfo,
  SpaceInput,
  TabId,
  UiCommand,
  PageSwipeIndicator,
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
  historyPage: "history:page",
  historyRemove: "history:remove",
  historyClearRange: "history:clear-range",
  defaultBrowserStatus: "default-browser:status",
  defaultBrowserSet: "default-browser:set",
  drmStatus: "drm:status",
  importSources: "import:sources",
  importRun: "import:run",
  importPasswords: "import:passwords",
  importProgress: "import:progress",
  bookmarksList: "bookmarks:list",
  bookmarksAdd: "bookmarks:add",
  bookmarksRemove: "bookmarks:remove",
  bookmarksToggleActive: "bookmarks:toggle-active",
  commandRun: "command:run",
  omniboxTabs: "omnibox:tabs",
  omniboxShowTab: "omnibox:show-tab",
  omniboxOpen: "omnibox:open",
  omniboxCopy: "omnibox:copy",
  overlayShow: "overlay:show",
  overlayBackdrop: "overlay:backdrop",
  overlayClose: "overlay:close",
  appMenuShow: "app-menu:show",
  sidebarContextMenu: "sidebar:context-menu",
  spaceContextMenu: "spaces:context-menu",
  pageSwipeState: "page-swipe:state",
  pageSwipeWheel: "page-swipe:wheel",
  settingsGet: "settings:get",
  settingsUpdate: "settings:update",
  settingsReset: "settings:reset",
  settingsChanged: "settings:changed",
  settingsOpen: "settings:open",
  shortcutCapture: "settings:shortcut-capture",
  shortcutKey: "settings:shortcut-key",
  startImage: "settings:start-image",
  weatherPlaces: "weather:places",
  weatherForecast: "weather:forecast",
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
  updatesStatus: "updates:status",
  updatesChanged: "updates:changed",
  updatesCheck: "updates:check",
  updatesDownload: "updates:download",
  updatesInstall: "updates:install",
  themeExportFile: "theme:export-file",
  themeImportFile: "theme:import-file",
  syncStatus: "sync:status",
  syncChanged: "sync:changed",
  syncCreate: "sync:create",
  syncPair: "sync:pair",
  syncPairingCode: "sync:pairing-code",
  syncNow: "sync:now",
  syncDisconnect: "sync:disconnect",
  syncReset: "sync:reset",
  siteInfoShow: "site-info:show",
  pageOptionsShow: "page-options:show",
  captureCopy: "capture:copy",
  captureSave: "capture:save",
  captureDiscard: "capture:discard",
  recordingControl: "recording:control",
  recordingStarted: "recording:started",
  recordingFailed: "recording:failed",
  recordingFinish: "recording:finish",
  siteInfoGet: "site-info:get",
  siteInfoResetPermission: "site-info:reset-permission",
  siteInfoSetPermission: "site-info:set-permission",
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
  autofillStatus: "autofill:status",
  autofillList: "autofill:list",
  autofillPutAddress: "autofill:put-address",
  autofillPutCard: "autofill:put-card",
  autofillRemove: "autofill:remove",
  autofillRevealCard: "autofill:reveal-card",
  autofillChanged: "autofill:changed",
  autofillSuggestions: "autofill:suggestions",
  autofillFill: "autofill:fill",
  autofillPrompt: "autofill:prompt",
  autofillAnswer: "autofill:answer",
  spellcheckLanguages: "spellcheck:languages",
  spellcheckWords: "spellcheck:words",
  spellcheckAddWord: "spellcheck:add-word",
  spellcheckRemoveWord: "spellcheck:remove-word",
  readerArticle: "reader:article",
  translateShow: "translate:show",
  translatePanel: "translate:panel",
  translateRun: "translate:run",
  translateRestore: "translate:restore",
  translateRule: "translate:rule",
  translateKeys: "translate:keys",
  translateSetKey: "translate:set-key",
  translateTest: "translate:test",
  annotationsForTab: "annotations:for-tab",
  annotationsList: "annotations:list",
  annotationsGet: "annotations:get",
  annotationsHighlight: "annotations:highlight",
  annotationsUpdate: "annotations:update",
  annotationsRemove: "annotations:remove",
  annotationsSetNote: "annotations:set-note",
  annotationsRemovePage: "annotations:remove-page",
  annotationsJump: "annotations:jump",
  annotationsCopy: "annotations:copy",
  annotationsExport: "annotations:export",
  annotationsChanged: "annotations:changed",
  boostsList: "boosts:list",
  boostsForTab: "boosts:for-tab",
  boostsCreateForTab: "boosts:create-for-tab",
  boostsSave: "boosts:save",
  boostsRemove: "boosts:remove",
  boostsUnzap: "boosts:unzap",
  boostsZap: "boosts:zap",
  boostsChanged: "boosts:changed",
  peekState: "peek:state",
  peekAction: "peek:action",
  mediaList: "media:list",
  mediaChanged: "media:changed",
  mediaAction: "media:action",
  mediaPictureInPicture: "media:picture-in-picture",
  mediaFocus: "media:focus",
  mediaMute: "media:mute",
  mediaDismiss: "media:dismiss",
  tabPreviewShow: "tab-preview:show",
  tabPreviewHide: "tab-preview:hide",
  // ADR-042: crash recovery, profiles, task manager, print preview, backups.
  recoveryRestore: "recovery:restore",
  recoveryDismiss: "recovery:dismiss",
  recoveryClosed: "recovery:closed",
  recoveryReopen: "recovery:reopen",
  profilesList: "profiles:list",
  profilesCreate: "profiles:create",
  profilesUpdate: "profiles:update",
  profilesRemove: "profiles:remove",
  profilesOpen: "profiles:open",
  profilesSetAsk: "profiles:set-ask",
  tasksList: "tasks:list",
  tasksKill: "tasks:kill",
  printUpdate: "print:update",
  printPrinters: "print:printers",
  printRun: "print:run",
  printClose: "print:close",
  backupExport: "backup:export",
  backupInspect: "backup:inspect",
  backupApply: "backup:apply",
  crashesInfo: "crashes:info",
  crashesClear: "crashes:clear",
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
  /**
   * Boosts (ADR-029): per-site CSS, zapped elements, font, color filters and an optional script.
   * The UI names tabs of its own window; main reads their URL. Changes are refused from a private window.
   */
  boosts: {
    list(): Promise<Boost[]>;
    forTab(tabId: TabId): Promise<TabBoost | null>;
    /** The tab's site boost, created when there is none. */
    createForTab(tabId: TabId): Promise<TabBoost | null>;
    /** A whole boost (no id: a new one), validated in main. */
    save(boost: BoostInput): Promise<BoostResult>;
    remove(id: string): Promise<void>;
    /** Shows a zapped element of the tab's site again. */
    unzap(tabId: TabId, selector: string): Promise<TabBoost | null>;
    /** Starts the zap tool in the tab's page (closes the overlay). */
    zap(tabId: TabId): void;
    onChanged(listener: () => void): () => void;
  };
  passwords: {
    status(): Promise<PasswordsStatus>;
    list(): Promise<PasswordSummary[]>;
    neverList(): Promise<string[]>;
    /** Rate limited per window in main (`PASSWORD_ACCESS_LIMIT` reveals and copies a minute). */
    reveal(id: string): Promise<RevealResult>;
    /** Copies the password to the clipboard (cleared after 30 s if still there); rate limited like `reveal`. */
    copy(id: string): Promise<PasswordResult>;
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
  /**
   * Addresses and payment cards (ADR-041). Lists show a card by its last digits: its number only
   * comes through `revealCard`, after main asked the user itself (Touch ID or a native dialog).
   * Changes are refused from a private window.
   */
  autofill: {
    status(): Promise<AutofillStatus>;
    list(): Promise<AutofillList>;
    /** Adds (null id) or replaces an address. */
    putAddress(id: string | null, address: AddressInput): Promise<AutofillResult>;
    /** Adds (null id, number required) or edits a card (an empty number keeps the saved one). */
    putCard(id: string | null, card: CardInput): Promise<AutofillResult>;
    remove(section: FieldSection, id: string): Promise<AutofillResult>;
    revealCard(id: string): Promise<AutofillRevealResult>;
    onChanged(listener: () => void): () => void;
    /** Overlay: what the suggestion popover offers for the tab's focused form. */
    suggestions(tabId: TabId): Promise<AutofillSuggestions | null>;
    fill(tabId: TabId, id: string): Promise<boolean>;
    /** Overlay: the save prompt after a submitted form. */
    prompt(captureId: string): Promise<AutofillPrompt | null>;
    answer(captureId: string, answer: AutofillAnswer): Promise<AutofillResult>;
  };
  /** Spell checking (ADR-041): dictionaries offered and in use, the custom words. */
  spellcheck: {
    languages(): Promise<{ available: string[]; current: string[] }>;
    words(): Promise<string[]>;
    addWord(word: string): Promise<void>;
    removeWord(word: string): Promise<void>;
  };
  /**
   * Reader mode (ADR-026): main extracts and validates the article (command "toggle-reader"); the
   * chrome UI draws it in place of the page.
   */
  reader: {
    article(tabId: TabId): Promise<ReaderArticle | null>;
  };
  /**
   * Page translation (ADR-036): main calls the provider and runs the page script in an isolated
   * world; the UIs name tabs of their own window. API keys go in, never back out (only whether set).
   */
  translate: {
    /** Chrome UI: the popover for the active tab, hanging from `anchor` (the address bar's button). */
    show(anchor: Bounds): void;
    panel(tabId: TabId): Promise<TranslatePanelState | null>;
    /** `from` null: detected by the provider; `consent`: the privacy notice was just accepted. */
    run(tabId: TabId, from: string | null, to: string, consent: boolean): Promise<TranslateResultMessage>;
    restore(tabId: TabId): void;
    setRule(tabId: TabId, rule: TranslateRuleChange, on: boolean): Promise<TranslatePanelState | null>;
    keys(): Promise<TranslateKeysStatus>;
    /** Saves a provider's key in the OS keychain (empty: removes it). Refused from a private window. */
    setKey(provider: TranslateProviderId, key: string): Promise<TranslateResultMessage>;
    /** Translates a short sample with the configured provider. */
    test(): Promise<TranslateResultMessage>;
  };
  /**
   * Notes and highlights (ADR-037): the UIs name tabs of their own window and highlights by id;
   * main reads the pages and keeps the window's book (in memory for a private window).
   */
  annotations: {
    /** The notes panel: the tab's page, its highlights and note (null: not a web page). */
    forTab(tabId: TabId): Promise<TabAnnotations | null>;
    /** `browser://notes`: everything. */
    list(): Promise<AnnotationsList>;
    get(id: string): Promise<Highlight | null>;
    /** The tab's selection becomes a highlight (the last color when none is given). */
    highlight(tabId: TabId, color?: HighlightColor): Promise<AnnotationResult>;
    update(id: string, patch: HighlightPatch): Promise<Highlight | null>;
    remove(id: string): void;
    /** A page's note; empty text removes it. */
    setNote(url: string, text: string): void;
    /** Every highlight and the note of a page. */
    removePage(url: string): void;
    /** Scrolls the tab's page to the highlight and flashes it. */
    jump(tabId: TabId, id: string): Promise<boolean>;
    /** Copies the quote (main writes the clipboard). */
    copy(id: string): void;
    /** Save dialog, then the file. Null: cancelled. */
    exportAs(format: AnnotationExportFormat): Promise<AnnotationResult | null>;
    onChanged(listener: () => void): () => void;
  };
  /**
   * Link peek (ADR-027): main owns the peeked page; the overlay layer draws the card around it
   * and only names an action (never a URL).
   */
  peek: {
    /** Overlay page only: the card's header and geometry changed (title, address, resize…). */
    onState(listener: (state: PeekState) => void): () => void;
    action(action: PeekAction): void;
  };
  /**
   * Media hub (ADR-035): tabs of this window playing (or recently paused) media. Controls name a
   * tab; main runs them in its page's isolated world.
   */
  media: {
    list(): Promise<MediaSource[]>;
    onChanged(listener: (sources: MediaSource[]) => void): () => void;
    action(tabId: TabId, action: MediaAction): void;
    pictureInPicture(tabId: TabId): void;
    /** Shows the tab (switching space if needed). */
    focus(tabId: TabId): void;
    toggleMute(tabId: TabId): void;
    /** Pauses the source and hides it until it plays again. */
    dismiss(tabId: TabId): void;
  };
  spaces: {
    /** Creates a space (defaults for missing fields) and shows it in this window; null at the limit. */
    create(input?: SpaceInput): Promise<SpaceInfo | null>;
    update(id: SpaceId, input: SpaceInput): void;
    /** Deletes the space and closes its tabs, in every window. The last space cannot be deleted. */
    remove(id: SpaceId): void;
    switchTo(id: SpaceId): void;
    /** Native menu of a space chip: rename, icon and color, move, delete, new space (ADR-033). */
    contextMenu(id: SpaceId): void;
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
    /** `browser://history`: most recent first, after `cursor`. Refused in a private window. */
    page(query: string, cursor: HistoryCursor | null): Promise<HistoryPage>;
    /** Forgets these pages; resolves to how many were removed. */
    remove(urls: string[]): Promise<number>;
    /** Forgets the pages visited in the range; resolves to how many were removed. */
    clearRange(range: HistoryClearRange): Promise<number>;
  };
  /** ADR-039: whether this browser opens the OS's web links. */
  defaultBrowser: {
    status(): Promise<DefaultBrowserStatus>;
    /** Asks the OS (Windows: opens its Settings). */
    makeDefault(): Promise<DefaultBrowserStatus>;
  };
  /** ADR-040: protected content (Widevine CDM) status, for the settings row. */
  drm: {
    status(): Promise<WidevineStatus>;
  };
  /** ADR-039: import from other browsers (refused in a private window). */
  import: {
    sources(): Promise<ImportSource[]>;
    run(profileId: string, items: ImportItem[]): Promise<ImportSummary>;
    /** Main asks for a CSV file, then merges its logins into the vault. */
    passwordsCsv(): Promise<PasswordImportSummary>;
    onProgress(listener: (progress: ImportProgress) => void): () => void;
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
  /** The universal bar (ADR-032). */
  omnibox: {
    /** Tabs of every space of this window. */
    tabs(): Promise<OmniboxTab[]>;
    /** Shows a tab of any space of this window (switching space). */
    showTab(spaceId: SpaceId, tabId: TabId): void;
    /** Opens typed text or a URL: in the active tab, a new one, a background one, or beside it (split). */
    open(input: string, disposition: OpenDisposition): void;
    /** Copies an instant answer. */
    copy(text: string): void;
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
    /** Overlay page only: the page swipe indicator moved (ADR-033). */
    onPageSwipe(listener: (indicator: PageSwipeIndicator) => void): () => void;
    /** Overlay page only: wheel events received while the swipe indicator covers the page. */
    swipeWheel(sample: { deltaX: number; deltaY: number; deltaMode: number; shiftKey: boolean; ctrlKey: boolean }): void;
  };
  /** The "…" app menu (ADR-033), in the overlay layer, hanging from `anchor` (its button). Chrome UI only. */
  appMenu: {
    show(anchor: Bounds): void;
  };
  /** Native menu of the sidebar's empty space (ADR-033). Chrome UI only. */
  sidebar: {
    contextMenu(): void;
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
     * Shortcut capture (ADR-028): while on, this window's key presses skip the menu accelerators
     * and arrive through `onShortcutKey` instead.
     */
    captureShortcut(active: boolean): void;
    onShortcutKey(listener: (press: KeyPress) => void): () => void;
    /**
     * The start page's background image as a data: URL, fetched by main (the UI loads no remote
     * image); null when there is none, it failed, or in a private window.
     */
    startImage(): Promise<string | null>;
  };
  /**
   * The start page's weather widget (ADR-034): Open-Meteo, asked by main (no key, no cookies,
   * 30 min cache). Empty / null when offline or on an error.
   */
  weather: {
    places(query: string): Promise<WeatherPlace[]>;
    forecast(latitude: number, longitude: number): Promise<Forecast | null>;
  };
  find: {
    /** Searches the tab's page for `query` (new search: the first match from the top is highlighted). */
    query(tabId: TabId, query: string, matchCase: boolean): void;
    /** Next (forward) or previous match of the current query. */
    step(tabId: TabId, forward: boolean): void;
    /** Hides the find bar and clears the highlights (the query is kept for the tab). */
    close(tabId: TabId): void;
  };
  /**
   * Tab hover preview (ADR-038), chrome UI only: the UI decides when (hover intent), main builds
   * the card (thumbnail, badges) in the overlay layer beside `anchor` (the hovered row).
   */
  tabPreview: {
    show(kind: "tab" | "favorite", id: string, anchor: Bounds): void;
    hide(): void;
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
  /** Desktop auto-updates (ADR-030); status null until the updater has started. */
  updates: {
    status(): Promise<UpdateStatus | null>;
    onChanged(listener: (status: UpdateStatus) => void): () => void;
    /** "Rechercher des mises à jour". */
    check(): void;
    /** Downloads the update found (automatic download off). */
    download(): void;
    /** Restarts into the downloaded update. */
    install(): void;
  };
  /** Shareable themes (ADR-030): `.browsertheme` files go through native dialogs in main. */
  theme: {
    /** Save dialog; resolves to false when cancelled or refused (private window). */
    exportFile(theme: SharedTheme): Promise<boolean>;
    /** Open dialog; null when cancelled, otherwise the validated theme or why it was refused. */
    importFile(): Promise<ThemeDecodeResult | null>;
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
    /** Allows or blocks one permission for a site of the tab (notifications…, ADR-041). */
    setPermission(tabId: TabId, origin: string, kind: PermissionKind, allow: boolean): Promise<SiteInfo | null>;
    /** Clears the site's cookies and storage in the tab's session, then reloads the tab. */
    clearData(tabId: TabId): Promise<SiteInfo | null>;
    /** Third-party cookie blocking: makes the tab's site an exception (refused in private windows). */
    allowThirdPartyCookies(tabId: TabId, allow: boolean): Promise<SiteInfo | null>;
  };
  /** Page options popover (ADR-031), hanging from `anchor` (the address bar). Chrome UI only. */
  pageOptions: {
    show(anchor: Bounds): void;
  };
  /** Screenshots (ADR-031): the image stays in main, the UI only names it. */
  capture: {
    /** Copies the image to the clipboard. */
    copy(id: string): Promise<boolean>;
    /** Save dialog (PNG, in the downloads folder by default); false when cancelled or failed. */
    save(id: string): Promise<boolean>;
    /** The result popover closed: main forgets the image. */
    discard(id: string): void;
  };
  /**
   * Tab recording (ADR-031): the chrome UI runs the recorder (main grants it the tab as its only
   * display-media source); main owns the state and the save dialog.
   */
  recording: {
    /** Chrome UI only: main asks to start or stop the recorder. */
    onControl(listener: (action: "start" | "stop") => void): () => void;
    started(): void;
    failed(): void;
    /** The WebM file; false when the save dialog was cancelled or writing failed. */
    finish(data: Uint8Array): Promise<boolean>;
  };
  /**
   * Cookies and site data of the profile (default session and isolated spaces), for the settings.
   * Null in a private window, which never manages the profile's data.
   */
  /** ADR-042: the "Restaurer la session ?" card and recently closed tabs and windows. */
  recovery: {
    /** Reopens the offered windows (all when null); this window goes if it only shows a start page. */
    restore(indexes: number[] | null): Promise<number>;
    dismiss(): void;
    closed(): Promise<ClosedLists>;
    reopen(kind: "tab" | "window", index: number): void;
  };
  /** ADR-042: user profiles (`browser://profiles`). Changes are refused in a private window. */
  profiles: {
    list(): Promise<ProfilesView>;
    create(input: ProfileInput): Promise<ProfileInfo | null>;
    update(id: ProfileId, input: ProfileInput): Promise<boolean>;
    remove(id: ProfileId): Promise<boolean>;
    /** Opens the profile in a new window (its own instance of the app). */
    open(id: ProfileId): Promise<boolean>;
    setAskOnLaunch(ask: boolean): Promise<void>;
  };
  /** ADR-042: `browser://tasks`. */
  /** ADR-043: crash dumps kept on this device, and whether reports are sent. */
  crashes: {
    info(): Promise<CrashReportsInfo>;
    /** Deletes the dumps on disk. */
    clear(): Promise<CrashReportsInfo>;
  };
  tasks: {
    list(): Promise<TaskRow[]>;
    /** Ends a tab renderer process (the tab shows its crash page). */
    kill(pid: number): Promise<boolean>;
  };
  /** ADR-042: the print preview (overlay page only). */
  print: {
    update(options: PrintOptions): Promise<PrintResult>;
    printers(): Promise<PrintPrinter[]>;
    run(options: PrintOptions): Promise<PrintResult>;
    close(): void;
  };
  /** ADR-042: profile backups (refused in a private window). */
  backup: {
    /** With a passphrase, the passwords come along, sealed with it. */
    export(passphrase: string | null): Promise<{ ok: true } | { ok: false; message: string }>;
    /** Picks a file and summarizes it. */
    inspect(): Promise<{ ok: true; summary: BackupSummary } | { ok: false; message: string }>;
    apply(mode: BackupMode, passphrase: string | null): Promise<{ ok: true } | { ok: false; message: string }>;
  };
  siteData: {
    list(): Promise<SiteDataEntry[] | null>;
    /** Clears a site's cookies and storage everywhere in the profile; resolves to the new list. */
    remove(site: string): Promise<SiteDataEntry[] | null>;
    clearAll(): Promise<SiteDataEntry[] | null>;
  };
}
