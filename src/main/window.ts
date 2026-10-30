import { join } from "node:path";
import { app, BrowserWindow, nativeTheme, session, type Session, type WebContents } from "electron";
import { internalUrl, type InternalPage } from "@shared/internal";
import { Channels } from "@shared/ipc";
import { PRIVATE_SPACE, privateSettings } from "@shared/private";
import { pageRadius, searchEngineOf, type Settings } from "@shared/settings";
import type { Bounds, BrowserState, UiCommand } from "@shared/types";
import { matchesFavorite } from "@shared/favorites";
import { uiUrl } from "./app-protocol";
import { downloadViewerOf, isDownloadVisible, onDownloadsChanged } from "./downloads";
import { setExtensionsNotifier } from "./extensions";
import type { DownloadViewer } from "./downloads/list";
import { favoriteFavicon, favoriteTiles, setArchiveNotifier, setFavoritesRefresh } from "./organize";
import { Overlay } from "./overlay";
import { LinkPeek } from "./peek";
import { boostPage } from "./boosts";
import { watchPasswordForms } from "./passwords";
import { hasPasswordsFor, setPasswordsNotifier } from "./passwords/vault";
import { createPrivateSession, wipePrivateSession } from "./private";
import { persistentWindows, sessionOnClose, tabHooksFor } from "./private-guards";
import { profile } from "./profile";
import { onSettingsChanged, settings, updateSettings, windowBackground } from "./settings";
import { SpaceManager, spaces } from "./spaces";
import type { SessionWindow } from "./storage/session";
import type { TabManager, TabManagerHooks } from "./tabs";
import { uiSession } from "./ui-session";

/** Browser windows, keyed by their chrome UI's webContents id. */
const controllers = new Map<number, BrowserController>();

/**
 * Every webContents that runs the browser's own UI (chrome and overlay) → its window. This is
 * the IPC sender allow-list: tab pages are never registered, so their messages are refused.
 */
const uiOwners = new Map<number, BrowserController>();

function registerUi(contents: WebContents, controller: BrowserController): void {
  const id = contents.id;
  uiOwners.set(id, controller);
  contents.once("destroyed", () => uiOwners.delete(id));
}

// Favorites changed: every window re-renders its grid; the archive changed: its pages re-list it.
setFavoritesRefresh(() => BrowserController.refreshAll());
setArchiveNotifier(() => {
  for (const controller of controllers.values()) controller.send(Channels.archiveChanged);
});
// Extensions installed, switched or removed: `browser://extensions` re-lists them (ADR-024).
setExtensionsNotifier(() => {
  for (const controller of controllers.values()) controller.send(Channels.extensionsChanged);
});
// Passwords saved, edited or removed: the address bar's key and `browser://passwords` follow (ADR-025).
setPasswordsNotifier(() => {
  BrowserController.refreshAll();
  for (const controller of controllers.values()) controller.send(Channels.passwordsChanged);
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

// Downloads progress and history changes reach the browser UIs (sidebar button, panel, page) of
// the windows that may see them: a private window's downloads stay its own (ADR-018, audit LOW-3).
onDownloadsChanged((change) => {
  for (const controller of controllers.values()) {
    const updated = change.updated.filter((entry) => isDownloadVisible(entry.id, controller.downloadViewer));
    if (updated.length || change.removed.length) controller.send(Channels.downloadsChanged, { ...change, updated });
  }
});

// Settings apply live: every window re-themes itself and its chrome UI gets the new values.
onSettingsChanged((current) => {
  for (const controller of controllers.values()) controller.applySettings(current);
});
// The OS switched light/dark: windows following the system need their native background updated.
nativeTheme.on("updated", () => {
  for (const controller of controllers.values()) controller.window.setBackgroundColor(controller.background());
});

export interface WindowOptions {
  /** A private window (ADR-014): in-memory session, no history nor session entry, private theme. */
  private?: boolean;
}

/** One browser window: the chrome UI (sidebar, address bar…) plus the spaces and tabs of its pages. */
export class BrowserController {
  readonly window: BrowserWindow;
  /** One TabManager per space; only the active space's pages are shown. */
  readonly spaces: SpaceManager;
  /** Floating UI above the pages (command palette). */
  readonly overlay: Overlay;
  /** The link previewed in a floating card above the page, if any (ADR-027). */
  readonly peek: LinkPeek;
  /**
   * Private window: never written to the profile (history, session, permissions…). Anything that
   * persists per window checks this; per-session hooks (downloads) use `isPrivateSession` (./private).
   */
  readonly isPrivate: boolean;
  /** The in-memory session of a private window's pages, wiped when it closes. */
  private readonly privateSession: Session | null;
  /** The settings are capturing a keyboard shortcut in the chrome UI (ADR-028). */
  capturingShortcut = false;

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
    const isMac = process.platform === "darwin";
    this.window = new BrowserWindow({
      width: 1280,
      height: 820,
      minWidth: 640,
      minHeight: 420,
      show: false,
      title: this.isPrivate ? "Browser — Navigation privée" : "Browser",
      // The theme's own background: no white flash while the UI loads or on resize.
      backgroundColor: this.background(),
      titleBarStyle: "hidden",
      // macOS keeps its traffic lights; elsewhere the sidebar draws its own window controls.
      ...(isMac ? { trafficLightPosition: { x: 16, y: 16 } } : { frame: false }),
      webPreferences: {
        preload: join(import.meta.dirname, "../preload/index.cjs"),
        // Never a tab session: nothing installed there (extensions…) reaches the UI (ADR-024).
        session: uiSession(),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        spellcheck: false,
      },
    });

    this.spaces = new SpaceManager(
      this.window,
      (spaceState) => {
        const state = this.withFavorites(spaceState);
        if (!this.window.isDestroyed()) this.window.webContents.send(Channels.state, state);
        this.overlay.send(Channels.state, state);
        // A tab view attached while the overlay is open must not cover it.
        if (this.overlay.isOpen) this.overlay.raise();
        if (!this.isPrivate) BrowserController.saveSession();
      },
      tabHooksFor(
        {
          ...tabHooks,
          contextMenu: (tabId, params) => pageMenu?.(this, tabId, params),
          pageReady: (tabId, contents) => watchPasswordForms(this, tabId, contents),
          boostPage: (contents) => boostPage(contents, this.isPrivate),
          peekLink: (tabId, url) => this.peek.open(tabId, url),
        },
        this.isPrivate,
      ),
      this.isPrivate ? undefined : restore,
      this.privateSession ? { space: PRIVATE_SPACE, session: this.privateSession } : undefined,
    );

    const chrome = this.window.webContents;
    controllers.set(chrome.id, this);
    registerUi(chrome, this);
    this.applySettings(settings(), false);
    // The chrome UI is a fixed app page: it never navigates nor opens windows.
    chrome.on("will-navigate", (event) => event.preventDefault());
    chrome.setWindowOpenHandler(() => ({ action: "deny" }));
    // Shortcut capture in the settings (ADR-028): while it is on, key presses reach neither the
    // menu accelerators nor the page; main hands them to the chrome UI instead.
    chrome.on("before-input-event", (event, input) => {
      if (!this.capturingShortcut || input.type !== "keyDown") return;
      event.preventDefault();
      const { key, code, control, alt, shift, meta } = input;
      chrome.send(Channels.shortcutKey, { key, code, control, alt, shift, meta });
    });
    chrome.on("did-start-loading", () => (this.capturingShortcut = false));

    this.overlay = new Overlay(this.window, {
      onCreated: (contents) => registerUi(contents, this),
      focusTarget: () => this.tabs.activeWebContents() ?? chrome,
      chrome: () => chrome,
      backdrop: () => {
        const { width, height } = this.window.getContentBounds();
        const layers = [{ contents: chrome, bounds: { x: 0, y: 0, width, height } }];
        const page = this.tabs.activeWebContents();
        if (page) layers.push({ contents: page, bounds: this.tabs.viewBounds });
        return layers;
      },
      dismissed: () => this.peek.close(),
    });
    this.peek = new LinkPeek(this);

    // A native macOS swipe navigates the active page when possible. If there is no page history,
    // retain the existing space-switching gesture.
    this.window.on("swipe", (_event, direction) => {
      const active = this.tabs.getState().tabs.find((tab) => tab.id === this.tabs.activeTabId);
      if (direction === "right" && active?.canGoBack) this.tabs.back(active.id);
      else if (direction === "left" && active?.canGoForward) this.tabs.forward(active.id);
      else if (direction === "left") this.spaces.switchBy(1);
      else if (direction === "right") this.spaces.switchBy(-1);
    });

    // The window controls show "restore" instead of "maximize" while maximized.
    for (const event of ["maximize", "unmaximize", "enter-full-screen", "leave-full-screen"] as const) {
      this.window.on(event as "maximize", () => {
        if (!this.window.isDestroyed()) chrome.send(Channels.windowMaximized, this.window.isMaximized() || this.window.isFullScreen());
      });
    }

    this.window.once("ready-to-show", () => {
      this.window.show();
      // Pre-warm the overlay once the window is up, so the first Ctrl+K opens instantly.
      setTimeout(() => !this.window.isDestroyed() && this.overlay.warm(), 0);
    });
    this.window.on("closed", () => {
      // Closing the last window keeps it in the session (that is how the app usually quits on
      // Windows/Linux); closing one of several windows forgets it. Private windows never count.
      const outcome = sessionOnClose(this, BrowserController.all());
      if (outcome === "keep") BrowserController.saveSession(true);
      controllers.delete(chrome.id);
      if (outcome === "forget") BrowserController.saveSession();
      try {
        this.spaces.destroy();
      } finally {
        // Whatever happened to the pages, the overlay goes and a private window takes its
        // cookies, storage and cache with it.
        this.overlay.destroy();
        if (this.privateSession) void wipePrivateSession(this.privateSession);
      }
    });

    // app://browser/index.html (or the dev server, unpackaged only).
    void this.window.loadURL(uiUrl("index"));
  }

  /** What the browser UIs show: the shown space's tabs, the spaces, and the favorites grid. */
  getState(): BrowserState {
    return this.withFavorites(this.spaces.getState());
  }

  private withFavorites(state: BrowserState): BrowserState {
    return { ...state, favorites: favoriteTiles(this) };
  }

  /** Shows `browser://archive` (ADR-022). */
  openArchive(): void {
    this.openInternal("archive");
  }

  /** Shows `browser://extensions` (ADR-024). */
  openExtensions(): void {
    this.openInternal("extensions");
  }

  /** Shows `browser://boosts` (ADR-029). */
  openBoosts(): void {
    this.openInternal("boosts");
  }

  /** Shows `browser://passwords` (ADR-025). */
  openPasswords(): void {
    this.openInternal("passwords");
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

  /** Applies settings to the native side of the window, and tells its chrome UI (unless `notify` is false). */
  applySettings(current: Settings, notify = true): void {
    if (this.window.isDestroyed()) return;
    this.window.setBackgroundColor(this.background(current));
    this.spaces.configure(tabOptions(current));
    // Zen mode hides the macOS traffic lights along with the sidebar.
    if (process.platform === "darwin") this.window.setWindowButtonVisibility(!current.layout.zenMode);
    this.window.setHasShadow(current.appearance.shadows);
    if (notify) this.window.webContents.send(Channels.settingsChanged, current);
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

  /** Shows an internal page: its open tab, else in the space's empty start-page tab, else a new tab. */
  private openInternal(page: InternalPage): void {
    const { tabs } = this.tabs.getState();
    const empty = this.emptyTab();
    if (!tabs.some((tab) => tab.url === internalUrl(page)) && empty) {
      this.tabs.navigate(empty, internalUrl(page));
      this.tabs.activate(empty);
    } else {
      this.tabs.openInternal(page);
    }
  }

  /** An unpinned tab of the active space showing the start page (the active one first). */
  private emptyTab(): string | undefined {
    const { tabs, activeTabId } = this.tabs.getState();
    const empty = tabs.filter((tab) => !tab.url && !tab.isPinned);
    return (empty.find((tab) => tab.id === activeTabId) ?? empty[0])?.id;
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
    if (!this.window.isDestroyed()) this.window.webContents.send(channel, ...args);
    this.overlay.send(channel, ...args);
  }

  static toggleZenMode(): void {
    updateSettings({ layout: { zenMode: !settings().layout.zenMode } });
  }

  sendUiCommand(command: UiCommand): void {
    // The chrome UI cannot take input while the overlay covers it.
    this.overlay.close();
    // Shortcuts may fire while a web page has focus; UI commands need the chrome focused.
    this.window.webContents.focus();
    this.window.webContents.send(Channels.uiCommand, command);
  }

  /** Window of a chrome UI webContents (not the overlay). */
  static fromChrome(contents: WebContents): BrowserController | undefined {
    return controllers.get(contents.id);
  }

  /** Window of any browser UI webContents (chrome or overlay): the IPC sender check. */
  static fromUi(contents: WebContents): BrowserController | undefined {
    return uiOwners.get(contents.id);
  }

  static focused(): BrowserController | undefined {
    const window = BrowserWindow.getFocusedWindow();
    return window ? controllers.get(window.webContents.id) : undefined;
  }

  static count(): number {
    return controllers.size;
  }

  static all(): BrowserController[] {
    return [...controllers.values()];
  }

  /** Re-sends every window's state (bookmarks changed, …). */
  static refreshAll(): void {
    for (const controller of controllers.values()) controller.spaces.refresh();
  }

  /**
   * Persists the open windows (debounced unless `now`), private ones excepted. An empty window
   * list is never saved.
   */
  static saveSession(now = false): void {
    if (quitting || persistentWindows(BrowserController.all()).length === 0) return;
    const { saveSession, flush } = profile();
    saveSession(() => ({
      spaces: spaces.list(),
      windows: persistentWindows(BrowserController.all()).map((controller) => controller.spaces.snapshot()),
    }));
    if (now) flush();
  }
}
