import { join } from "node:path";
import { app, BrowserWindow, nativeTheme, type WebContents } from "electron";
import { Channels } from "@shared/ipc";
import { pageRadius, searchEngineOf, type Settings } from "@shared/settings";
import type { UiCommand } from "@shared/types";
import { profile } from "./profile";
import { onSettingsChanged, settings, updateSettings, windowBackground } from "./settings";
import type { SessionWindow } from "./storage/session";
import { TabManager, type TabManagerHooks } from "./tabs";

const controllers = new Map<number, BrowserController>();

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
        BrowserController.saveSession();
      },
      tabHooks,
    );

    const chrome = this.window.webContents;
    controllers.set(chrome.id, this);
    this.applySettings(settings(), false);
    // The chrome UI is a fixed app page: it never navigates nor opens windows.
    chrome.on("will-navigate", (event) => event.preventDefault());
    chrome.setWindowOpenHandler(() => ({ action: "deny" }));

    this.window.once("ready-to-show", () => this.window.show());
    this.window.on("closed", () => {
      // Closing the last window keeps it in the session (that is how the app usually quits on
      // Windows/Linux); closing one of several windows forgets it.
      const last = controllers.size === 1;
      if (last) BrowserController.saveSession(true);
      controllers.delete(chrome.id);
      if (!last) BrowserController.saveSession();
      this.tabs.destroy();
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
    // Shortcuts may fire while a web page has focus; UI commands need the chrome focused.
    this.window.webContents.focus();
    this.window.webContents.send(Channels.uiCommand, command);
  }

  static fromChrome(contents: WebContents): BrowserController | undefined {
    return controllers.get(contents.id);
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
