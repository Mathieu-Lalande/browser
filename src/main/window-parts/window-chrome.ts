import { t } from "@shared/i18n";
import { release } from "node:os";
import { join } from "node:path";
import { micaSupported } from "@shared/desktop";
import { BrowserWindow, screen, type Session } from "electron";
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
  private topBarTimer: ReturnType<typeof setInterval> | undefined;
  /** Mica is drawn behind the UI (Windows 11 and "Effet Mica", ADR-048). */
  micaApplied = false;

  constructor({ isPrivate, background, uiSession }: WindowChromeOptions) {
    const isMac = process.platform === "darwin";
    this.window = new BrowserWindow({
      width: 1280,
      height: 820,
      minWidth: 640,
      minHeight: 420,
      show: false,
      title: isPrivate ? t("windowPartsWindowChrome.browserPrivateBrowsing") : "Browser",
      // The theme's own background: no white flash while the UI loads or on resize.
      backgroundColor: background,
      titleBarStyle: "hidden",
      // macOS keeps its traffic lights (centered in the 40px window bar); elsewhere the window bar
      // draws its own controls (ADR-045).
      ...(isMac ? { trafficLightPosition: { x: 16, y: 13 } } : { frame: false }),
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
    // macOS: the traffic lights show with the chrome's window bar only (ADR-045, `watchTopBar`).
    if (isMac) this.window.setWindowButtonVisibility(false);
  }

  /**
   * The settings' native effects: background and shadow, and Mica on Windows 11 (ADR-048): the
   * window turns transparent behind the UI, whose backgrounds let it show (`data-mica`). Windows 10
   * and other systems keep the theme's opaque background.
   */
  applySettings(current: Settings, background: string): void {
    if (this.window.isDestroyed()) return;
    const mica = current.appearance.mica && micaSupported(process.platform, release());
    if (mica !== this.micaApplied && process.platform === "win32") this.window.setBackgroundMaterial(mica ? "mica" : "none");
    this.micaApplied = mica;
    this.window.setBackgroundColor(this.background(background));
    this.window.setHasShadow(current.appearance.shadows);
  }

  /** The native background: the theme's, or transparent behind Mica. */
  background(theme: string): string {
    return this.micaApplied ? "#00000000" : theme;
  }

  /**
   * The chrome's window bar (ADR-045) unfolded, `height` px tall at the top of the window (0: folded).
   * The UI sees no pointer events over the page view or a drag region, so the cursor is polled
   * while the bar shows: `onLeave` runs once it leaves the band (after having been in it: a bar
   * unfolded from the keyboard or by a synthetic event waits for the pointer), then polling stops.
   * macOS: the traffic lights show with the bar.
   */
  watchTopBar(height: number, onLeave: () => void): void {
    clearInterval(this.topBarTimer);
    this.topBarTimer = undefined;
    if (this.window.isDestroyed()) return;
    if (process.platform === "darwin") this.window.setWindowButtonVisibility(height > 0);
    if (height <= 0) return;
    let seen = false;
    this.topBarTimer = setInterval(() => {
      if (this.window.isDestroyed()) return void clearInterval(this.topBarTimer);
      const point = screen.getCursorScreenPoint();
      const area = this.window.getContentBounds();
      const inside =
        point.x >= area.x && point.x < area.x + area.width && point.y >= area.y - 2 && point.y < area.y + height + 4;
      if (inside) seen = true;
      else if (seen) {
        clearInterval(this.topBarTimer);
        this.topBarTimer = undefined;
        onLeave();
      }
    }, 100);
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
