import { join } from "node:path";
import { BrowserWindow, nativeTheme, type WebContents } from "electron";
import { Channels } from "@shared/ipc";
import type { UiCommand } from "@shared/types";
import { TabManager } from "./tabs";

const controllers = new Map<number, BrowserController>();

/** One browser window: the chrome UI (sidebar, address bar…) plus the TabManager for its pages. */
export class BrowserController {
  readonly window: BrowserWindow;
  readonly tabs: TabManager;

  constructor() {
    const isMac = process.platform === "darwin";
    this.window = new BrowserWindow({
      width: 1280,
      height: 820,
      minWidth: 640,
      minHeight: 420,
      show: false,
      title: "Browser",
      backgroundColor: nativeTheme.shouldUseDarkColors ? "#141318" : "#f3f1f7",
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

    this.tabs = new TabManager(this.window, (state) => {
      if (!this.window.isDestroyed()) this.window.webContents.send(Channels.state, state);
    });

    const chrome = this.window.webContents;
    controllers.set(chrome.id, this);
    // The chrome UI is a fixed app page: it never navigates nor opens windows.
    chrome.on("will-navigate", (event) => event.preventDefault());
    chrome.setWindowOpenHandler(() => ({ action: "deny" }));

    this.window.once("ready-to-show", () => this.window.show());
    this.window.on("closed", () => {
      controllers.delete(chrome.id);
      this.tabs.destroy();
    });

    if (process.env.ELECTRON_RENDERER_URL) void this.window.loadURL(process.env.ELECTRON_RENDERER_URL);
    else void this.window.loadFile(join(import.meta.dirname, "../renderer/index.html"));

    this.tabs.create();
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
}
