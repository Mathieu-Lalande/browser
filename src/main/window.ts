import { join } from "node:path";
import { app, BrowserWindow, nativeTheme, type WebContents } from "electron";
import { Channels } from "@shared/ipc";
import { pageRadius, searchEngineOf, type Settings } from "@shared/settings";
import type { UiCommand } from "@shared/types";
import { Overlay } from "./overlay";
import { profile } from "./profile";
import { onSettingsChanged, settings, updateSettings, windowBackground } from "./settings";
import type { SessionWindow } from "./storage/session";
import { TabManager, type TabManagerHooks } from "./tabs";

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
  },
  isBookmarked: (url) => profile().bookmarks.has(url),
};

/** What each TabManager takes from the settings. */
const tabOptions = (current: Settings) => ({
  searchEngine: searchEngineOf(current),
  newTabPosition: current.behavior.newTabPosition,
  closeTabActivates: current.behavior.closeTabActivates,
  pageRadius: pageRadius(current),
});

// Settings apply live: every window re-themes itself and its chrome UI gets the new values.
onSettingsChanged((current) => {
  for (const controller of controllers.values()) controller.applySettings(current);
});
// The OS switched light/dark: windows following the system need their native background updated.
nativeTheme.on("updated", () => {
  for (const controller of controllers.values()) controller.window.setBackgroundColor(windowBackground());
});

/** One browser window: the chrome UI (sidebar, address bar…) plus the TabManager for its pages. */
export class BrowserController {
  readonly window: BrowserWindow;
  readonly tabs: TabManager;
  /** Floating UI above the pages (command palette). */
  readonly overlay: Overlay;

  /** `restore`: a window from the previous session, whose tabs come back discarded (lazy). */
  constructor(restore?: SessionWindow) {
    const isMac = process.platform === "darwin";
    this.window = new BrowserWindow({
      width: 1280,
      height: 820,
      minWidth: 640,
      minHeight: 420,
      show: false,
      title: "Browser",
      // The theme's own background: no white flash while the UI loads or on resize.
      backgroundColor: windowBackground(),
      titleBarStyle: "hidden",
      // macOS keeps its traffic lights; elsewhere the sidebar draws its own window controls.
      ...(isMac ? { trafficLightPosition: { x: 16, y: 16 } } : { frame: false }),
      webPreferences: {
        preload: join(import.meta.dirname, "../preload/index.cjs"),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        spellcheck: false,
      },
    });

    this.tabs = new TabManager(
      this.window,
      (state) => {
        if (!this.window.isDestroyed()) this.window.webContents.send(Channels.state, state);
        this.overlay.send(Channels.state, state);
        // A tab view attached while the overlay is open must not cover it.
        if (this.overlay.isOpen) this.overlay.raise();
        BrowserController.saveSession();
      },
      tabHooks,
    );

    const chrome = this.window.webContents;
    controllers.set(chrome.id, this);
    registerUi(chrome, this);
    this.applySettings(settings(), false);
    // The chrome UI is a fixed app page: it never navigates nor opens windows.
    chrome.on("will-navigate", (event) => event.preventDefault());
    chrome.setWindowOpenHandler(() => ({ action: "deny" }));

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
    });

    this.window.once("ready-to-show", () => {
      this.window.show();
      // Pre-warm the overlay once the window is up, so the first Ctrl+K opens instantly.
      setTimeout(() => !this.window.isDestroyed() && this.overlay.warm(), 0);
    });
    this.window.on("closed", () => {
      // Closing the last window keeps it in the session (that is how the app usually quits on
      // Windows/Linux); closing one of several windows forgets it.
      const last = controllers.size === 1;
      if (last) BrowserController.saveSession(true);
      controllers.delete(chrome.id);
      if (!last) BrowserController.saveSession();
      this.tabs.destroy();
      this.overlay.destroy();
    });

    if (process.env.ELECTRON_RENDERER_URL) void this.window.loadURL(process.env.ELECTRON_RENDERER_URL);
    else void this.window.loadFile(join(import.meta.dirname, "../renderer/index.html"));

    if (restore) this.tabs.restore(restore);
    else this.tabs.create();
  }

  /** Toggles the bookmark of the active tab's page, then refreshes `isBookmarked` everywhere. */
  toggleBookmark(): void {
    const tab = this.tabs.getState().tabs.find((item) => item.id === this.tabs.activeTabId);
    if (!tab?.url) return;
    const { bookmarks, saveBookmarks } = profile();
    bookmarks.toggle({ url: tab.url, title: tab.title, favicon: tab.favicon }, Date.now());
    saveBookmarks();
    BrowserController.refreshAll();
  }

  /** Applies settings to the native side of the window, and tells its chrome UI (unless `notify` is false). */
  applySettings(current: Settings, notify = true): void {
    if (this.window.isDestroyed()) return;
    this.window.setBackgroundColor(windowBackground(current));
    this.tabs.configure(tabOptions(current));
    // Zen mode hides the macOS traffic lights along with the sidebar.
    if (process.platform === "darwin") this.window.setWindowButtonVisibility(!current.layout.zenMode);
    this.window.setHasShadow(current.appearance.shadows);
    if (notify) this.window.webContents.send(Channels.settingsChanged, current);
  }

  openSettings(): void {
    this.tabs.openInternal("settings");
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
    for (const controller of controllers.values()) controller.tabs.refresh();
  }

  /** Persists the open windows (debounced unless `now`). An empty window list is never saved. */
  static saveSession(now = false): void {
    if (quitting || controllers.size === 0) return;
    const { saveSession, flush } = profile();
    saveSession(() => ({ windows: BrowserController.all().map((controller) => controller.tabs.snapshot()) }));
    if (now) flush();
  }
}
