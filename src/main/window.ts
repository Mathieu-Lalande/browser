import { getLocale } from "@shared/i18n";
import { app, BrowserWindow, nativeTheme, session, type Session, type WebContents, type WebContentsView } from "electron";
import { internalPageOf, internalUrl, type InternalPage } from "@shared/internal";
import { Channels } from "@shared/ipc";
import { PRIVATE_SPACE, privateSettings } from "@shared/private";
import { pageRadius, searchEngineOf, type Settings } from "@shared/settings";
import type { Bounds, BrowserState, UiCommand } from "@shared/types";
import { matchesFavorite } from "@shared/favorites";
import { isLocalFileUrl } from "@shared/url";
import { uiUrl } from "./app-protocol";
import { downloadViewerOf } from "./downloads";
import type { DownloadViewer } from "./downloads/list";
import { favoriteFavicon, favoriteTiles, setArchiveNotifier, setFavoritesRefresh } from "./organize";
import { Overlay } from "./overlay";
import { LinkPeek } from "./peek";
import { ExtensionPopup } from "./extensions/popup";
import { WebStorePages } from "./extensions/store-page";
import { installFromWebStore, removeFromStorePage } from "./extensions";
import { TabPreviews } from "./tab-preview";
import { AutoPip, MediaHub } from "./media";
import { PanelHost } from "./panels";
import { PageTranslator } from "./translate";
import { PageAssistant } from "./assistant";
import { PageAnnotator } from "./annotations";
import { watchPasswordForms } from "./passwords";
import { hasPasswordsFor } from "./passwords/vault";
import { createPrivateSession, wipePrivateSession } from "./private";
import { persistentWindows, sessionOnClose, tabHooksFor } from "./private-guards";
import { profile } from "./profile";
import { onSettingsChanged, settings, updateSettings, windowBackground } from "./settings";
import { SpaceManager, spaces } from "./spaces";
import type { Session as SavedSession, SessionWindow } from "./storage/session";
import type { TabManager, TabManagerHooks } from "./tabs";
import { uiSession } from "./ui-session";
import { PageGestures } from "./page-swipe";
import { watchPageWheel } from "./page-swipe-script";
import type { WindowDirectory } from "./ports";
import { appServices } from "./app-services-ref";
import type { AppServices } from "./services";
import { WindowRegistry } from "./window-registry";
import { Emitter } from "@shared/emitter";
import { ChromeBridge } from "./window-parts/chrome-bridge";
import { PageHooks } from "./window-parts/page-hooks";
import { WindowChrome } from "./window-parts/window-chrome";

/** The open windows and the browser UIs (chrome, overlay) of each: the IPC sender allow-list. */
const windows = new WindowRegistry<BrowserController>();

// Favorites changed: every window re-renders its grid; the archive changed: its pages re-list it.
setFavoritesRefresh(() => BrowserController.refreshAll());
setArchiveNotifier(() => {
  for (const controller of windows.all()) controller.send(Channels.archiveChanged);
});
/** Set once the app starts quitting: windows closing from then on stay in the saved session. */
let quitting = false;
app.on("before-quit", () => {
  BrowserController.saveSession(true);
  quitting = true;
});

/** History and bookmarks integration shared by every window's TabManager. */
const tabHooks: TabManagerHooks = {
  onVisit: (url) => {
    const { history, saveHistory } = profile();
    if (history.recordVisit(url, Date.now())) saveHistory();
  },
  onPageInfo: (url, info) => {
    const { history, saveHistory } = profile();
    if (history.updatePage(url, info)) saveHistory();
    favoriteFavicon(url, info.favicon);
  },
  isBookmarked: (url) => profile().bookmarks.has(url),
  isFavorite: (url) => matchesFavorite(profile().favorites.list(), url),
  isInReadingList: (url) => appServices().reading.has(url),
  hasPasswords: (url) => hasPasswordsFor(url),
};

type PageMenu = (controller: BrowserController, tabId: string, params: Electron.ContextMenuParams) => void;
/** The page context menu (`./page-menu`), plugged in at startup: it creates windows itself. */
let pageMenu: PageMenu | null = null;
export function setPageMenu(menu: PageMenu): void {
  pageMenu = menu;
}

/** What each TabManager takes from the settings. */
const tabOptions = (current: Settings) => ({
  searchEngine: searchEngineOf(current),
  newTabPosition: current.behavior.newTabPosition,
  closeTabActivates: current.behavior.closeTabActivates,
  pageRadius: pageRadius(current),
  defaultZoom: current.appearance.pageZoom / 100,
});

// Settings apply live: every window re-themes itself and its chrome UI gets the new values.
onSettingsChanged((current) => {
  for (const controller of windows.all()) controller.applySettings(current);
});
// The OS switched light/dark: windows following the system need their native background updated.
nativeTheme.on("updated", () => {
  for (const controller of windows.all()) controller.window.setBackgroundColor(controller.nativeBackground());
});

export interface WindowOptions {
  /** A private window (ADR-014): in-memory session, no history nor session entry, private theme. */
  private?: boolean;
}

/** One browser window: the chrome UI (sidebar, address bar…) plus the spaces and tabs of its pages. */
export class BrowserController {
  /** A window showed for the first time (the taskbar's thumbnail toolbar, ADR-048). */
  static readonly shown = new Emitter<BrowserController>();
  readonly window: BrowserWindow;
  /** One TabManager per space; only the active space's pages are shown. */
  readonly spaces: SpaceManager;
  /** Floating UI above the pages (command palette). */
  readonly overlay: Overlay;
  /** The link previewed in a floating card above the page, if any (ADR-027). */
  readonly peek: LinkPeek;
  /** The open extension popup, below its toolbar button (ADR-049). */
  readonly extensionPopup: ExtensionPopup;
  /** Pinch zoom pacing and the two-finger swipe back/forward on pages (ADR-033). */
  readonly gestures: PageGestures = new PageGestures(this);
  /** Tabs playing media, for the sidebar's mini-player (ADR-035). */
  readonly media: MediaHub = new MediaHub(this);
  /** Page translation of this window's tabs (ADR-036). */
  readonly translator: PageTranslator = new PageTranslator(this);
  /** The AI assistant's conversations of this window's tabs (ADR-044). */
  readonly assistant: PageAssistant = new PageAssistant(this);
  /** Highlights and notes of this window's pages (ADR-037). */
  readonly annotator: PageAnnotator = new PageAnnotator(this, { all: () => BrowserController.all() });
  /** Our "Ajouter à Browser" button on the Chrome Web Store pages of this window (ADR-049). */
  readonly storePages: WebStorePages = new WebStorePages({
    testOrigin: () => appServices().extensions.webStoreTestOrigin,
    stateOf: (webStoreId) => appServices().extensions.storeButton(webStoreId),
    install: (webStoreId) => void installFromWebStore(this, webStoreId),
    remove: (webStoreId) => void removeFromStorePage(this, webStoreId),
  });
  /** Tab hover preview cards and their thumbnails (ADR-038). */
  readonly previews: TabPreviews;
  /** The web panels' live pages beside the page (ADR-047); none in a private window. */
  readonly panels: PanelHost;
  /** Automatic picture-in-picture on tab switches (ADR-047, off by default). */
  readonly autoPip: AutoPip = new AutoPip({
    enabled: () => settings().media.autoPictureInPicture,
    // Any tab of the window (a space switch leaves a tab of another space).
    pageOf: (tabId) => this.spaces?.allTabs().find(({ tab }) => tab.id === tabId)?.manager.pageOf(tabId) ?? null,
    log: (entry) => appServices().autoPipLog?.(entry),
  });
  /**
   * Private window: never written to the profile (history, session, permissions…). Anything that
   * persists per window checks this; per-session hooks (downloads) use `isPrivateSession` (./private).
   */
  readonly isPrivate: boolean;
  /** The in-memory session of a private window's pages, wiped when it closes. */
  private readonly privateSession: Session | null;
  /** The native window: creation, native settings and events. */
  private readonly frame: WindowChrome;
  /** The chrome UI webContents and what main pushes to the window's UIs. */
  private readonly bridge: ChromeBridge;

  /** The settings are capturing a keyboard shortcut in the chrome UI (ADR-028). */
  get capturingShortcut(): boolean {
    return this.bridge.capturingShortcut;
  }
  set capturingShortcut(active: boolean) {
    this.bridge.capturingShortcut = active;
  }

  /** Whose downloads this window lists and may act on (its own only, for a private window). */
  get downloadViewer(): DownloadViewer {
    return downloadViewerOf(this.privateSession);
  }

  /** The session of the pages of the space on screen (a download retried from this window starts there). */
  get tabSession(): Session {
    return this.privateSession ?? spaces.sessionFor(this.spaces.activeSpaceId) ?? session.defaultSession;
  }

  /** The tabs of the space on screen (what tab commands and shortcuts act on). */
  get tabs(): TabManager {
    return this.spaces.active;
  }

  /** `restore`: a window from the previous session, whose tabs come back discarded (lazy). */
  constructor(restore?: SessionWindow, options: WindowOptions = {}) {
    this.isPrivate = options.private === true;
    this.privateSession = this.isPrivate ? createPrivateSession() : null;
    this.frame = new WindowChrome({ isPrivate: this.isPrivate, background: this.background(), uiSession: uiSession() });
    this.window = this.frame.window;
    const chrome = this.window.webContents;
    this.bridge = new ChromeBridge(chrome, () => this.overlay);
    const pageHooks = new PageHooks({
      base: tabHooks,
      features: this,
      boosts: appServices().boosts,
      contextMenu: (tabId, params) => pageMenu?.(this, tabId, params),
      watchPasswordForms: (tabId, contents) => watchPasswordForms(this, tabId, contents),
      watchAutofill: (tabId, contents) => appServices().autofill.watch(this, tabId, contents),
      watchNotifications: (tabId, contents) => appServices().notifications.watch(this, tabId, contents),
      watchPageWheel,
    });
    this.spaces = new SpaceManager(
      this.window,
      (spaceState) => this.stateChanged(spaceState),
      tabHooksFor(pageHooks.hooks(), this.isPrivate),
      this.isPrivate ? undefined : restore,
      this.privateSession ? { space: PRIVATE_SPACE, session: this.privateSession } : undefined,
    );

    windows.add(chrome, this);
    this.applySettings(settings(), false);
    this.overlay = new Overlay(this.window, {
      onCreated: (contents) => windows.registerUi(contents, this),
      focusTarget: () => this.tabs.activeWebContents() ?? chrome,
      chrome: () => chrome,
      backdrop: () => {
        const { width, height } = this.window.getContentBounds();
        const layers = [{ contents: chrome, bounds: { x: 0, y: 0, width, height } }];
        const page = this.tabs.activeWebContents();
        if (page) layers.push({ contents: page, bounds: this.tabs.viewBounds });
        return layers;
      },
      dismissed: () => {
        this.peek.close();
        this.extensionPopup.close();
        appServices().print.close(this);
      },
    });
    this.peek = new LinkPeek(this);
    this.extensionPopup = new ExtensionPopup({
      window: this.window,
      overlay: this.overlay,
      session: () => this.tabSession,
      openTab: (url) => this.tabs.create(url, { activate: true }),
    });
    this.previews = new TabPreviews(this);
    this.panels = new PanelHost({
      window: this.window,
      isPrivate: this.isPrivate,
      overlay: this.overlay,
      service: appServices().panels,
      openTab: (url, foreground) => this.tabs.create(url, { activate: foreground }),
      refresh: () => this.spaces.refresh(),
    });
    this.wireWindow(chrome.id);

    // app://browser/index.html (or the dev server, unpackaged only).
    void this.window.loadURL(uiUrl("index"));
  }

  /** A new state of the spaces and their tabs: every UI of the window gets it. */
  private stateChanged(spaceState: BrowserState): void {
    this.bridge.pushState(this.withFavorites(spaceState));
    if (!this.isPrivate) BrowserController.saveSession();
    this.media.sync();
    this.autoPip.sync(spaceState.activeTabId);
    // Undefined only while the spaces are being created (first state, before the window is up).
    this.previews?.sync();
  }

  /** Native window events: swipe, maximize state, first show and close. */
  private wireWindow(chromeId: number): void {
    // A native macOS swipe navigates the active page when possible. If there is no page history,
    // retain the existing space-switching gesture.
    this.frame.onSwipe((direction) => {
      const active = this.tabs.getState().tabs.find((tab) => tab.id === this.tabs.activeTabId);
      if (direction === "right" && active?.canGoBack) this.tabs.back(active.id);
      else if (direction === "left" && active?.canGoForward) this.tabs.forward(active.id);
      else if (direction === "left") this.spaces.switchBy(1);
      else if (direction === "right") this.spaces.switchBy(-1);
    });

    this.frame.onMaximizedChange((maximized) => this.bridge.toChrome(Channels.windowMaximized, maximized));
    // Pre-warm the overlay once the window is up, so the first Ctrl+K opens instantly.
    this.frame.showWhenReady(() => {
      this.overlay.warm();
      BrowserController.shown.emit(this);
    });
    this.window.on("focus", () => windows.focused(chromeId));
    this.window.on("closed", () => {
      this.frame.watchTopBar(0, () => {});
      this.closed(chromeId);
    });
  }

  private closed(chromeId: number): void {
    // Closing the last window keeps it in the session (that is how the app usually quits on
    // Windows/Linux); closing one of several windows forgets it. Private windows never count.
    const outcome = sessionOnClose(this, BrowserController.all());
    if (outcome === "keep") BrowserController.saveSession(true);
    // "Rouvrir la fenêtre fermée" (ADR-042): normal windows only, in memory.
    if (outcome === "forget") appServices().recovery.rememberWindow(this.spaces.snapshot());
    windows.remove(chromeId);
    if (outcome === "forget") BrowserController.saveSession();
    this.media.destroy();
    this.extensionPopup.close();
    this.previews.destroy();
    this.panels.destroy();
    try {
      this.spaces.destroy();
    } finally {
      // Whatever happened to the pages, the overlay goes and a private window takes its
      // cookies, storage and cache with it.
      this.overlay.destroy();
      if (this.privateSession) void wipePrivateSession(this.privateSession);
    }
  }

  /** What the browser UIs show: the shown space's tabs, the spaces, and the favorites grid. */
  getState(): BrowserState {
    return this.withFavorites(this.spaces.getState());
  }

  private withFavorites(state: BrowserState): BrowserState {
    return {
      ...state,
      favorites: favoriteTiles(this),
      recording: appServices().capture.recorder.stateOf(this),
      // The "Restaurer la session ?" card (ADR-042), never in a private window.
      recovery: this.isPrivate ? null : appServices().recovery.summary(),
      // Undefined only while the spaces are being created (first state, before the window is up).
      panels: this.panels?.state() ?? null,
      // ADR-048: the window bar's indicator and motion; Mica behind the UI on Windows 11.
      energy: appServices().energy.state,
      mica: this.frame.micaApplied,
      locale: getLocale(),
    };
  }

  /** Sends the current state again (the UI language changed, ADR-052). */
  refreshState(): void {
    this.bridge.pushState(this.getState());
  }

  /** Shows `browser://archive` (ADR-022). */
  openArchive(): void {
    this.openInternal("archive");
  }

  /** Shows `browser://extensions` (ADR-024). */
  openExtensions(): void {
    this.openInternal("extensions");
  }

  /** An extension page main built (its options, ADR-049), in a new tab. */
  openExtensionPage(url: string): void {
    this.tabs.create(url, { activate: true, extensionPage: true });
  }

  /** An extension was installed from this window: the chrome UI anchors the confirmation (ADR-049). */
  extensionInstalled(id: string): void {
    this.bridge.toChrome(Channels.extensionsInstalled, id);
  }

  /** Shows `browser://boosts` (ADR-029). */
  openBoosts(): void {
    this.openInternal("boosts");
  }

  /** Shows `browser://notes` (ADR-037). */
  openNotes(): void {
    this.openInternal("notes");
  }

  /** Shows `browser://passwords` (ADR-025). */
  openPasswords(): void {
    this.openInternal("passwords");
  }

  /**
   * Shows a page handed over by the OS (ADR-039): a web page, or a local file (already checked by
   * `launchUrl`), in the space's empty start-page tab if there is one, else a new tab.
   */
  openUrl(url: string): void {
    const localFile = isLocalFileUrl(url);
    const empty = this.emptyTab();
    if (empty) {
      this.tabs.navigate(empty, url, { localFile });
      this.tabs.activate(empty);
    } else {
      this.tabs.create(url, { localFile });
    }
  }

  /**
   * "Ouvrir dans le navigateur" of a mini window (ADR-048): its live page (default session) becomes
   * a tab without reloading, in the shown space when it uses that session, else in the first space
   * that does; otherwise `url` opens again in a new tab.
   */
  adoptExternalPage(view: WebContentsView, url: string, favicons: string[]): void {
    const shared = spaces.list().find((space) => !space.isolated);
    if (!this.isPrivate && spaces.get(this.spaces.activeSpaceId)?.isolated && shared) this.spaces.switchTo(shared.id);
    const empty = this.emptyTab();
    const id = this.tabs.adoptPage(view, { favicons });
    if (!id) {
      if (!view.webContents.isDestroyed()) view.webContents.close();
      this.openUrl(url);
    } else if (empty) {
      this.tabs.close(empty);
    }
    this.focus();
  }

  /** Shows a space of this window (Jump List, Dock menu: ADR-048); unknown ids are ignored. */
  showSpace(id: string): void {
    this.spaces.switchTo(id);
  }

  /** Brings the window to the front (restored if minimized). */
  focus(): void {
    if (this.window.isMinimized()) this.window.restore();
    this.window.show();
    this.window.focus();
  }

  /** False while the energy saver is on (ADR-048): the media hub polls the tab on screen only. */
  pollsBackgroundMedia(): boolean {
    return appServices().energy.policy.pollBackgroundMedia;
  }

  /** Toggles the bookmark of the active tab's page, then refreshes `isBookmarked` everywhere. */
  toggleBookmark(): void {
    const tab = this.tabs.getState().tabs.find((item) => item.id === this.tabs.activeTabId);
    if (!tab?.url) return;
    const { bookmarks, saveBookmarks } = profile();
    // A private window writes no favicon anywhere (ADR-014, ADR-018).
    bookmarks.toggle({ url: tab.url, title: tab.title, favicon: this.isPrivate ? null : tab.favicon }, Date.now());
    saveBookmarks();
    BrowserController.refreshAll();
  }

  /** Applies settings to the native side of the window, and tells its browser UI (unless `notify` is false). */
  applySettings(current: Settings, notify = true): void {
    if (this.window.isDestroyed()) return;
    this.frame.applySettings(current, this.background(current));
    this.spaces.configure(tabOptions(current));
    // The overlay layer too: its floating UI follows the theme (and the other settings) live.
    if (notify) this.bridge.send(Channels.settingsChanged, current);
  }

  /**
   * "Nouvel onglet": shows the space's empty start-page tab if it has one, instead of piling up
   * identical empty tabs; otherwise opens a new one.
   */
  newTab(): void {
    const empty = this.emptyTab();
    if (empty) this.tabs.activate(empty);
    else this.tabs.create();
  }

  openSettings(): void {
    this.openInternal("settings");
  }

  /**
   * Shows an internal page (at `fragment`, a deep link): its open tab, else in the space's empty
   * start-page tab, else a new tab.
   */
  openInternal(page: InternalPage, fragment?: string | null): void {
    const { tabs } = this.tabs.getState();
    const empty = this.emptyTab();
    if (!tabs.some((tab) => internalPageOf(tab.url) === page) && empty) {
      this.tabs.navigate(empty, internalUrl(page, fragment));
      this.tabs.activate(empty);
    } else {
      this.tabs.openInternal(page, fragment);
    }
  }

  /** An unpinned tab of the active space showing the start page (the active one first). */
  private emptyTab(): string | undefined {
    const { tabs, activeTabId } = this.tabs.getState();
    const empty = tabs.filter((tab) => !tab.url && !tab.isPinned);
    return (empty.find((tab) => tab.id === activeTabId) ?? empty[0])?.id;
  }

  /** What the native window draws behind the UI: the theme's background, or none behind Mica (ADR-048). */
  nativeBackground(): string {
    return this.frame.background(this.background());
  }

  /** Native background color behind the UI: the theme's, or the private theme's (always dark). */
  background(current = settings()): string {
    return this.isPrivate ? windowBackground(privateSettings(current), "dark") : windowBackground(current);
  }

  openDownloads(): void {
    this.openInternal("downloads");
  }

  /**
   * Site info popover of a tab (the active one by default), hanging from `anchor` (the address
   * bar's lock), else from the top-left corner of the page.
   */
  showSiteInfo(anchor?: Bounds, tabId = this.tabs.activeTabId): void {
    const tab = this.tabs.getState().tabs.find((item) => item.id === tabId);
    if (!tab || !/^https?:/.test(tab.url)) return;
    const { x, y } = this.tabs.viewBounds;
    this.overlay.open({ kind: "site-info", tabId: tab.id, anchor: anchor ?? { x: x + 8, y, width: 0, height: 0 } });
  }

  /** Pushes a message to this window's browser UIs (chrome and overlay). */
  send(channel: string, ...args: unknown[]): void {
    this.bridge.send(channel, ...args);
  }

  /** The chrome's window bar unfolded (`height` px) or folded (0): see `WindowChrome.watchTopBar`. */
  watchTopBar(height: number): void {
    this.frame.watchTopBar(height, () => this.bridge.toChrome(Channels.windowTopBarLeft));
  }

  static toggleZenMode(): void {
    updateSettings({ layout: { zenMode: !settings().layout.zenMode } });
  }

  sendUiCommand(command: UiCommand): void {
    // The chrome UI cannot take input while the overlay covers it.
    this.bridge.command(command);
  }

  /** Window of a chrome UI webContents (not the overlay). */
  static fromChrome(contents: WebContents): BrowserController | undefined {
    return windows.fromChrome(contents.id);
  }

  /** Window of any browser UI webContents (chrome or overlay): the IPC sender check. */
  static fromUi(contents: WebContents): BrowserController | undefined {
    return windows.fromUi(contents.id);
  }

  /** The open windows as the app services see them (`WindowPort`, ./ports). */
  static readonly directory: WindowDirectory = {
    all: () => BrowserController.all(),
    focused: () => BrowserController.focused(),
    fromChrome: (contents) => BrowserController.fromChrome(contents),
    refreshAll: () => BrowserController.refreshAll(),
  };

  /** The normal (not private) window used last: where links from other apps open (ADR-039). */
  static lastNormal(): BrowserController | undefined {
    return windows.lastFocused((controller) => !controller.isPrivate && !controller.window.isDestroyed());
  }

  static focused(): BrowserController | undefined {
    const window = BrowserWindow.getFocusedWindow();
    return window ? windows.fromChrome(window.webContents.id) : undefined;
  }

  static count(): number {
    return windows.size;
  }

  static all(): BrowserController[] {
    return windows.all();
  }

  /** Re-sends every window's state (bookmarks changed, …). */
  static refreshAll(): void {
    for (const controller of windows.all()) controller.spaces.refresh();
  }

  /**
   * Follows the app services (once, at startup): downloads, extensions and passwords changes reach
   * the windows that show them.
   */
  static watchServices(services: AppServices): void {
    // Downloads progress and history changes reach the browser UIs (sidebar button, panel, page) of
    // the windows that may see them: a private window's downloads stay its own (ADR-018, audit LOW-3).
    services.downloads.onChanged((change) => {
      for (const controller of windows.all()) {
        const updated = change.updated.filter((entry) => services.downloads.isVisible(entry.id, controller.downloadViewer));
        if (updated.length || change.removed.length) controller.send(Channels.downloadsChanged, { ...change, updated });
      }
    });
    // Extensions installed, switched or removed: `browser://extensions` re-lists them (ADR-024).
    services.extensions.onChanged(() => {
      for (const controller of windows.all()) {
        controller.send(Channels.extensionsChanged);
        // Store pages show the new state on their own button (ADR-049).
        controller.storePages.refresh();
      }
    });
    // Passwords saved, edited or removed: the address bar's key and `browser://passwords` follow (ADR-025).
    services.passwords.onChanged(() => {
      BrowserController.refreshAll();
      for (const controller of windows.all()) controller.send(Channels.passwordsChanged);
    });
    // Web panels added, removed, edited or synced (ADR-047): each window follows with its own pages.
    services.panels.onChanged(() => {
      for (const controller of windows.all()) {
        controller.panels.sync();
        controller.spaces.refresh();
      }
    });
    // The reading list changed: the address bar's button and `browser://reading-list` follow (ADR-047).
    services.reading.onChanged(() => {
      BrowserController.refreshAll();
      for (const controller of windows.all()) controller.send(Channels.readingChanged);
    });
    // Addresses and cards changed: the settings section re-lists them (ADR-041).
    services.autofill.onChanged(() => {
      for (const controller of windows.all()) controller.send(Channels.autofillChanged);
    });
  }

  /**
   * Persists the open windows (debounced unless `now`), private ones excepted. An empty window
   * list is never saved.
   */
  static saveSession(now = false): void {
    if (quitting || persistentWindows(BrowserController.all()).length === 0) return;
    const { saveSession, flush } = profile();
    saveSession(() => BrowserController.sessionSnapshot());
    if (now) flush();
  }

  /** The spaces and normal windows, as session.json holds them. */
  static sessionSnapshot(): SavedSession {
    return {
      spaces: spaces.list(),
      windows: persistentWindows(BrowserController.all()).map((controller) => controller.spaces.snapshot()),
    };
  }
}
