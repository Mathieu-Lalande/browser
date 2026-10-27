import { app, BrowserWindow } from "electron";
import { tabSleepDelayMs } from "@shared/settings";
import { registerIpc } from "./ipc";
import { installMenu } from "./menu";
import { flushProfile, openProfile } from "./profile";
import { hardenApp, hardenSession } from "./security";
import { applyNativeTheme, settings as currentSettings } from "./settings";
import { startTabSleeper } from "./sleep";
import { startSync } from "./sync";
import { spaces } from "./spaces";
import { BrowserController } from "./window";

/** Test hook: `BROWSER_TEST_SLEEP_MS` replaces the sleep delay (unless sleeping is off). */
const TEST_SLEEP_MS = Number(process.env.BROWSER_TEST_SLEEP_MS) || 0;

function sleepDelay(): number | null {
  const delay = tabSleepDelayMs(currentSettings());
  return delay !== null && TEST_SLEEP_MS > 0 ? TEST_SLEEP_MS : delay;
}

app.setName("Browser");
// Lets tests and power users run isolated profiles.
if (process.env.BROWSER_PROFILE_DIR) app.setPath("userData", process.env.BROWSER_PROFILE_DIR);
hardenApp();

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
    hardenSession();
    registerIpc();
    installMenu();
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
    // End-to-end encrypted sync (ADR-018): off unless an account was set up on this device.
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
