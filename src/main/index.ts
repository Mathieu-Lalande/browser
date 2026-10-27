import { app, BrowserWindow } from "electron";
import { tabSleepDelayMs } from "@shared/settings";
import { registerAppScheme, serveAppScheme } from "./app-protocol";
import { registerIpc } from "./ipc";
import { installMenu } from "./menu";
import { flushProfile, openProfile } from "./profile";
import { hardenApp, hardenSession } from "./security";
import { applyNativeTheme, settings as currentSettings } from "./settings";
import { startTabSleeper } from "./sleep";
import { startSync } from "./sync";
import { spaces } from "./spaces";
import { showPageMenu } from "./page-menu";
import { BrowserController, setPageMenu } from "./window";

/**
 * Test hook: `BROWSER_TEST_SLEEP_MS` replaces the sleep delay (unless sleeping is off). Test and dev
 * hooks are only honored by an unpackaged app (ADR-018, audit LOW-4).
 */
const TEST_SLEEP_MS = (!app.isPackaged && Number(process.env.BROWSER_TEST_SLEEP_MS)) || 0;

function sleepDelay(): number | null {
  const delay = tabSleepDelayMs(currentSettings());
  return delay !== null && TEST_SLEEP_MS > 0 ? TEST_SLEEP_MS : delay;
}

app.setName("Browser");
// Lets tests run isolated profiles. A packaged app ignores it: an environment variable must not
// silently redirect a user's profile; `--user-data-dir=<dir>` (Chromium's switch) does that openly.
if (!app.isPackaged && process.env.BROWSER_PROFILE_DIR) app.setPath("userData", process.env.BROWSER_PROFILE_DIR);
hardenApp();
// The chrome UI and the overlay are served from app:// (registered before ready).
registerAppScheme();

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const window = BrowserWindow.getAllWindows()[0];
    if (window) {
      if (window.isMinimized()) window.restore();
      window.focus();
    } else {
      new BrowserController();
    }
  });

  void app.whenReady().then(() => {
    // The profile comes first: session hardening reads the settings (Accept-Language).
    const { previousSession, settings } = openProfile();
    serveAppScheme();
    hardenSession();
    registerIpc();
    installMenu();
    setPageMenu(showPageMenu);
    applyNativeTheme(settings);
    startTabSleeper({
      targets: () => BrowserController.all().flatMap((controller) => controller.spaces.tabManagers()),
      idleMs: sleepDelay,
    });
    // Spaces are kept even when windows are not restored.
    spaces.init(previousSession?.spaces);
    const restore = settings.behavior.restoreSession ? (previousSession?.windows ?? []) : [];
    if (restore.length) for (const saved of restore) new BrowserController(saved);
    else new BrowserController();
    // End-to-end encrypted sync (ADR-019): off unless an account was set up on this device.
    startSync();

    app.on("activate", () => {
      if (BrowserController.count() === 0) new BrowserController();
    });
  });

  // Last chance to write pending history/bookmarks/session changes.
  app.on("will-quit", flushProfile);

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
