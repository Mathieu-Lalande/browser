import { statSync } from "node:fs";
import { homedir } from "node:os";
import { app, shell } from "electron";
import { ARCHIVE_CHECK_MS } from "@shared/archive";
import { tabArchiveDelayMs, tabSleepDelayMs } from "@shared/settings";
import { registerAppScheme, serveAppScheme } from "./app-protocol";
import { registerIpc } from "./ipc";
import { installMenu } from "./menu";
import { flushProfile, openProfile, profile } from "./profile";
import { hardenApp, hardenSession } from "./security";
import { buildAppServices } from "./services";
import { applyNativeTheme, onSettingsChanged, settings as currentSettings, updateSettings } from "./settings";
import { startTabSleeper } from "./sleep";
import { desktopAdapters } from "./sync/adapters";
import { startUpdates } from "./updates";
import { spaces } from "./spaces";
import { startTabArchiver } from "./organize";
import { showPageMenu } from "./page-menu";
import { BrowserController, setPageMenu } from "./window";
import { castlabsComponents } from "./drm";
import { LaunchRouter, launchUrl, launchUrls, type LaunchContext } from "./default-browser/launch";

/**
 * Test hook: `BROWSER_TEST_SLEEP_MS` replaces the sleep delay (unless sleeping is off). Test and dev
 * hooks are only honored by an unpackaged app (ADR-018, audit LOW-4).
 */
const TEST_SLEEP_MS = (!app.isPackaged && Number(process.env.BROWSER_TEST_SLEEP_MS)) || 0;

/** Test hook: `BROWSER_TEST_ARCHIVE_MS` replaces the archive delay (unless archiving is off), checked often. */
const TEST_ARCHIVE_MS = (!app.isPackaged && Number(process.env.BROWSER_TEST_ARCHIVE_MS)) || 0;

function archiveDelay(): number | null {
  const delay = tabArchiveDelayMs(currentSettings());
  return delay !== null && TEST_ARCHIVE_MS > 0 ? TEST_ARCHIVE_MS : delay;
}

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

const isFile = (path: string) => {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
};
const launchContext = (cwd = process.cwd()): LaunchContext => ({ cwd, isFile });

/**
 * Links and files handed over by the OS (ADR-039) open in the last focused normal window; those
 * arriving before the windows exist wait for them.
 */
const launches = new LaunchRouter(() => ({
  lastNormal: () => BrowserController.lastNormal(),
  create: () => new BrowserController(),
}));

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // macOS hands links and files over as events, possibly before the app is ready.
  app.on("open-url", (event, url) => {
    event.preventDefault();
    const target = launchUrl(url, launchContext());
    if (target) launches.open([target]);
  });
  app.on("open-file", (event, path) => {
    event.preventDefault();
    const target = launchUrl(path, launchContext());
    if (target) launches.open([target]);
  });
  // Another launch (a link clicked in another app, a file opened): this instance shows it.
  app.on("second-instance", (_event, argv, workingDirectory) => {
    const urls = launchUrls(argv, launchContext(workingDirectory));
    if (urls.length) return launches.open(urls);
    const window = BrowserController.lastNormal() ?? BrowserController.all()[0];
    if (window) window.focus();
    else new BrowserController();
  });
  launches.open(launchUrls(process.argv, launchContext()));

  void app.whenReady().then(async () => {
    // The profile comes first: session hardening reads the settings (Accept-Language).
    const { previousSession, settings } = openProfile();
    serveAppScheme();
    // The app's services (downloads, extensions, passwords…), each session service installed in
    // every tab session by `hardenSession`.
    const services = buildAppServices({
      paths: { userData: app.getPath("userData"), downloads: app.getPath("downloads") },
      profile,
      settings: currentSettings,
      updateSettings,
      onSettingsChanged,
      windows: BrowserController.directory,
      syncAdapters: desktopAdapters,
      appName: app.getName(),
      locale: app.getLocale(),
      defaultClient: {
        platform: process.platform,
        packaged: app.isPackaged,
        appName: app.getName(),
        isDefaultProtocolClient: (protocol) => app.isDefaultProtocolClient(protocol),
        setAsDefaultProtocolClient: (protocol) => app.setAsDefaultProtocolClient(protocol),
        defaultAppNameFor: (url) => app.getApplicationNameForProtocol(url),
        openExternal: (url) => shell.openExternal(url),
      },
      components: castlabsComponents(),
      platform: process.platform,
      locationEnv: { platform: process.platform, home: homedir(), localAppData: process.env.LOCALAPPDATA, appData: process.env.APPDATA },
      testHooks: app.isPackaged
        ? {}
        : {
            plainKeychain: process.env.BROWSER_TEST_PLAIN_KEYCHAIN === "1",
            importChromiumDir: process.env.BROWSER_TEST_IMPORT_DIR || undefined,
            notifications: process.env.BROWSER_TEST_NOTIFICATIONS === "1",
          },
      // Touch ID passkeys need a signed build whose entitlements list this group (ADR-041): none yet.
      touchIdKeychainGroup: null,
    });
    BrowserController.watchServices(services);
    hardenSession();
    registerIpc();
    installMenu();
    setPageMenu(showPageMenu);
    applyNativeTheme(settings);
    startTabSleeper({
      targets: () => BrowserController.all().flatMap((controller) => controller.spaces.tabManagers()),
      idleMs: sleepDelay,
    });
    // Auto-archiving (ADR-022): idle tabs of normal windows are closed and kept in the archive.
    startTabArchiver({
      windows: () => BrowserController.all(),
      idleMs: archiveDelay,
      checkMs: TEST_ARCHIVE_MS > 0 ? 250 : ARCHIVE_CHECK_MS,
    });
    // Widevine (ADR-040): pages created before the CDM is registered cannot play protected content;
    // the wait is bounded so that the browser starts all the same without it.
    await services.widevine.prepare();
    // Spaces are kept even when windows are not restored.
    spaces.init(previousSession?.spaces);
    const restore = settings.behavior.restoreSession ? (previousSession?.windows ?? []) : [];
    if (restore.length) for (const saved of restore) new BrowserController(saved);
    else new BrowserController();
    launches.ready();
    // End-to-end encrypted sync (ADR-019): off unless an account was set up on this device.
    services.sync.start();
    app.on("will-quit", () => services.sync.stop());
    // Auto-updates (ADR-030): packaged builds only, first check a little after startup.
    void startUpdates();

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
