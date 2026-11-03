import { join } from "node:path";
import { BrowserWindow, type Session } from "electron";
import type { Settings } from "@shared/settings";

export interface WindowChromeOptions {
  isPrivate: boolean;
  /** The native background color behind the UI (the theme's). */
  background: string;
  /** The chrome UI's session, never a tab session (ADR-024). */
  uiSession: Session;
}

/**
 * The native side of a browser window: the `BrowserWindow` (frameless, the chrome UI in its own
 * session), what the settings change on it, and its native events (maximize, swipe, first show).
 */
export class WindowChrome {
  readonly window: BrowserWindow;

  constructor({ isPrivate, background, uiSession }: WindowChromeOptions) {
    const isMac = process.platform === "darwin";
    this.window = new BrowserWindow({
      width: 1280,
      height: 820,
      minWidth: 640,
      minHeight: 420,
      show: false,
      title: isPrivate ? "Browser — Navigation privée" : "Browser",
      // The theme's own background: no white flash while the UI loads or on resize.
      backgroundColor: background,
      titleBarStyle: "hidden",
      // macOS keeps its traffic lights; elsewhere the sidebar draws its own window controls.
      ...(isMac ? { trafficLightPosition: { x: 16, y: 16 } } : { frame: false }),
      webPreferences: {
        preload: join(import.meta.dirname, "../preload/index.cjs"),
        // Never a tab session: nothing installed there (extensions…) reaches the UI (ADR-024).
        session: uiSession,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        spellcheck: false,
      },
    });
  }

  /** The settings' native effects: background, shadow, and the macOS traffic lights hidden in zen mode. */
  applySettings(current: Settings, background: string): void {
    if (this.window.isDestroyed()) return;
    this.window.setBackgroundColor(background);
    if (process.platform === "darwin") this.window.setWindowButtonVisibility(!current.layout.zenMode);
    this.window.setHasShadow(current.appearance.shadows);
  }

  /** Maximized or full screen changed: the window controls show "restore" instead of "maximize". */
  onMaximizedChange(listener: (maximized: boolean) => void): void {
    for (const event of ["maximize", "unmaximize", "enter-full-screen", "leave-full-screen"] as const) {
      this.window.on(event as "maximize", () => {
        if (!this.window.isDestroyed()) listener(this.window.isMaximized() || this.window.isFullScreen());
      });
    }
  }

  /** A native macOS swipe. */
  onSwipe(listener: (direction: string) => void): void {
    this.window.on("swipe", (_event, direction) => listener(direction));
  }

  /** Shows the window once its UI is drawn, then runs `afterShow` on the next turn. */
  showWhenReady(afterShow: () => void): void {
    this.window.once("ready-to-show", () => {
      this.window.show();
      setTimeout(() => !this.window.isDestroyed() && afterShow(), 0);
    });
  }
}
