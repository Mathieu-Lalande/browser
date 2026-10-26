import { app, BrowserWindow } from "electron";
import { registerIpc } from "./ipc";
import { installMenu } from "./menu";
import { flushProfile, openProfile } from "./profile";
import { hardenApp, hardenSession } from "./security";
import { applyNativeTheme } from "./settings";
import { BrowserController } from "./window";

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
    hardenSession();
    registerIpc();
    installMenu();
    const { previousSession, settings } = openProfile();
    applyNativeTheme(settings);
    const restore = settings.behavior.restoreSession ? (previousSession?.windows ?? []) : [];
    if (restore.length) for (const saved of restore) new BrowserController(saved);
    else new BrowserController();

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
