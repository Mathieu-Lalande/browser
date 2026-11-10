import { onLocaleChange } from "@shared/i18n";
import { applyUiLanguage } from "./locale";
import { spawn } from "node:child_process";
import { statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { app, clipboard, crashReporter, ipcMain, nativeTheme, powerMonitor, session, shell, webContents } from "electron";
import { parseLaunchActions } from "@shared/desktop";
import { parseCrashEndpoint } from "@shared/diagnostics";
import { shouldOpenWelcome } from "@shared/onboarding";
import { launchProfile, profileFromArgs, shouldPickProfile } from "@shared/profiles";
import { startupPlan } from "@shared/recovery";
import { CrashMarker } from "./recovery/crash-marker";
import { ProfileService, profileDir, readProfiles } from "./profiles/service";
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
import { uiSession } from "./ui-session";
import { uiUrl } from "./app-protocol";
import { MiniWindows } from "./mini";
import { DesktopIntegration, type DesktopWindow } from "./desktop/integration";
import { onSettingsChanged as onSettings, resolvedMode, windowBackground } from "./settings";
import { appServices } from "./app-services-ref";

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

/** The user's sleep delay, shortened while the energy saver is on (ADR-048). */
function sleepDelay(): number | null {
  const delay = appServices().energy.policy.sleepDelayMs(tabSleepDelayMs(currentSettings()));
  return delay !== null && TEST_SLEEP_MS > 0 ? TEST_SLEEP_MS : delay;
}

/** Test hook: `BROWSER_TEST_ON_BATTERY=1` reports the computer on battery (energy saver, ADR-048). */
const TEST_ON_BATTERY = !app.isPackaged && process.env.BROWSER_TEST_ON_BATTERY === "1";

app.setName("Browser");
// Lets tests run isolated profiles. A packaged app ignores it: an environment variable must not
// silently redirect a user's profile; `--user-data-dir=<dir>` (Chromium's switch) does that openly.
if (!app.isPackaged && process.env.BROWSER_PROFILE_DIR) app.setPath("userData", process.env.BROWSER_PROFILE_DIR);
// User profiles (ADR-042): the root holds `profiles.json` and "Personnel"'s data (unchanged from
// older versions); any other profile lives in `Profiles/<id>`, in its own instance of the app.
const profileRoot = app.getPath("userData");
const askedProfile = profileFromArgs(process.argv);
const profilesAtLaunch = readProfiles(profileRoot);
const currentProfile = launchProfile(profilesAtLaunch, askedProfile);
if (profileDir(profileRoot, currentProfile) !== profileRoot) {
  app.setPath("userData", profileDir(profileRoot, currentProfile));
  app.setPath("sessionData", profileDir(profileRoot, currentProfile));
}
/** Test hooks (unpackaged only): files written or read instead of the print and backup dialogs. */
const testHook = (name: string) => (!app.isPackaged && process.env[name]) || undefined;
// Crash dumps stay in the profile (ADR-043): one Crashpad database per profile.
app.setPath("crashDumps", join(app.getPath("userData"), "Crashpad"));
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
const launchContext = (cwd = process.cwd()): LaunchContext => ({ cwd, platform: process.platform, isFile });

/** Mini windows for links from other apps (ADR-048), once the app is ready. */
let minis: MiniWindows | null = null;

/**
 * Links and files handed over by the OS (ADR-039) open in the last focused normal window, or a
 * single link in a mini window (ADR-048); those arriving before the windows exist wait for them.
 */
const launches = new LaunchRouter(() => ({
  lastNormal: () => BrowserController.lastNormal(),
  create: () => new BrowserController(),
  createPrivate: () => new BrowserController(undefined, { private: true }),
  mini: minis
    ? { enabled: () => currentSettings().behavior.externalLinksInMiniWindow, open: (url: string) => void minis?.show(url) }
    : undefined,
}));

/** A browser window as the taskbar sees it (thumbnail toolbar, downloads: ADR-048). */
const desktopWindow = (controller: BrowserController): DesktopWindow => ({
  window: controller.window,
  isPrivate: controller.isPrivate,
  back: () => controller.tabs.activeTabId && controller.tabs.back(controller.tabs.activeTabId),
  forward: () => controller.tabs.activeTabId && controller.tabs.forward(controller.tabs.activeTabId),
  newTab: () => controller.newTab(),
});

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
  // Jump List tasks (ADR-048) launch the browser with `--new-tab`, `--private` or `--space=<id>`.
  app.on("second-instance", (_event, argv, workingDirectory) => {
    const urls = launchUrls(argv, launchContext(workingDirectory));
    const actions = parseLaunchActions(argv);
    if (urls.length || actions) {
      launches.act(actions);
      return launches.open(urls);
    }
    const window = BrowserController.lastNormal() ?? BrowserController.all()[0];
    if (window) window.focus();
    else new BrowserController();
  });
  launches.open(launchUrls(process.argv, launchContext()));
  launches.act(parseLaunchActions(process.argv));

  void app.whenReady().then(async () => {
    // The profile comes first: session hardening reads the settings (Accept-Language).
    const { previousSession, settings } = openProfile();
    // The UI language (ADR-052) before anything shows text.
    applyUiLanguage(settings);
    // Unclean shutdown detection (ADR-042): the marker goes on a clean quit only.
    const marker = new CrashMarker(app.getPath("userData"));
    const unclean = marker.begin();
    app.on("will-quit", () => marker.end());
    const profiles = new ProfileService(profileRoot, currentProfile, {
      args: process.argv.slice(1),
      packaged: app.isPackaged,
      spawn: (args) => spawn(process.execPath, args, { detached: true, stdio: "ignore", env: process.env }).unref(),
    });
    profiles.markUsed();
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
      profiles,
      openWindow: (saved) => new BrowserController(saved),
      session: () => BrowserController.sessionSnapshot(),
      processes: { metrics: () => app.getAppMetrics(), allContents: () => webContents.getAllWebContents() },
      configureHostResolver: (resolver) => app.configureHostResolver(resolver),
      power: {
        isOnBatteryPower: () => TEST_ON_BATTERY || powerMonitor.isOnBatteryPower(),
        on: (event, listener) => powerMonitor.on(event as "on-battery", listener),
      },
      testHooks: app.isPackaged
        ? {}
        : {
            plainKeychain: process.env.BROWSER_TEST_PLAIN_KEYCHAIN === "1",
            importChromiumDir: process.env.BROWSER_TEST_IMPORT_DIR || undefined,
            printPdfPath: testHook("BROWSER_TEST_PRINT_PDF"),
            backupExportPath: testHook("BROWSER_TEST_BACKUP_EXPORT"),
            backupImportPath: testHook("BROWSER_TEST_BACKUP_IMPORT"),
            notifications: process.env.BROWSER_TEST_NOTIFICATIONS === "1",
            autoPip: process.env.BROWSER_TEST_AUTO_PIP === "1",
            webStoreOrigin: testHook("BROWSER_TEST_WEBSTORE_URL"),
          },
      crashReports: {
        reporter: crashReporter,
        dumpsDir: app.getPath("crashDumps"),
        // Baked in at build time; the test hook points it at a local receiver.
        endpoint: parseCrashEndpoint(testHook("BROWSER_TEST_CRASH_ENDPOINT") ?? import.meta.env.MAIN_VITE_CRASH_ENDPOINT),
        version: app.getVersion(),
      },
      // Touch ID passkeys need a signed build whose entitlements list this group (ADR-041): none yet.
      touchIdKeychainGroup: null,
    });
    // Crashpad first: crashes of the processes started from now on are caught (ADR-043).
    services.crashes.start();
    if (!app.isPackaged) (globalThis as { __browserCrashReports?: unknown }).__browserCrashReports = services.crashes;
    BrowserController.watchServices(services);
    hardenSession();
    registerIpc();
    // Mini windows (ADR-048): the page in the default space's session, promoted into a tab of the
    // last normal window without reloading.
    minis = new MiniWindows({
      uiSession,
      pageSession: () => session.defaultSession,
      barUrl: () => uiUrl("mini"),
      preload: join(import.meta.dirname, "../preload/index.cjs"),
      settings: currentSettings,
      mode: resolvedMode,
      background: () => windowBackground(),
      isMac: process.platform === "darwin",
      copy: (text) => clipboard.writeText(text),
      promote: (view, url, favicons) => (BrowserController.lastNormal() ?? new BrowserController()).adoptExternalPage(view, url, favicons),
      openTab: (url) => {
        const target = BrowserController.lastNormal() ?? new BrowserController();
        target.openUrl(url);
        target.focus();
      },
    });
    minis.registerIpc(ipcMain);
    onSettings(() => minis?.refreshAll());
    nativeTheme.on("updated", () => minis?.refreshAll());
    // Jump List, taskbar downloads and thumbnail toolbar (Windows), Dock menu (macOS): ADR-048.
    const desktop = new DesktopIntegration({
      platform: process.platform,
      program: process.execPath,
      programArgs: app.isPackaged ? [] : [app.getAppPath()],
      spaces: () => spaces.list(),
      downloads: () => services.downloads.list(services.downloads.viewerOf(null)),
      windows: () => BrowserController.all().map(desktopWindow),
      run: (actions) => launches.act(actions),
    });
    BrowserController.shown.on((controller) => desktop.attach(desktopWindow(controller)));
    services.downloads.onChanged(() => desktop.downloadsChanged());
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
    desktop.updateTasks();
    spaces.onChange(() => desktop.updateTasks());
    // A new UI language (ADR-052): Jump List, thumbnail buttons and every window's UIs follow.
    onLocaleChange(() => {
      desktop.updateTasks();
      for (const controller of BrowserController.all()) {
        for (const tabs of controller.spaces.tabManagers()) tabs.relocalize();
        controller.refreshState();
        desktop.attach(desktopWindow(controller));
      }
    });
    // After a crash nothing reopens by itself: the start page offers the session (ADR-042).
    const saved = previousSession?.windows ?? [];
    const plan = startupPlan({ unclean, restoreSession: settings.behavior.restoreSession, savedWindows: saved.length });
    if (plan === "offer" && previousSession) services.recovery.offer(previousSession);
    if (plan === "restore") for (const window of saved) new BrowserController(window);
    else new BrowserController();
    // Several profiles and "Choisir le profil au démarrage": the first window shows the picker.
    const picker = shouldPickProfile(profilesAtLaunch, askedProfile);
    if (picker) BrowserController.all().find((window) => !window.isPrivate)?.openInternal("profiles");
    // A fresh profile opens on the welcome page (ADR-043), until it is finished or skipped.
    const welcome = shouldOpenWelcome({
      completed: currentSettings().onboarding.completed,
      suppressed: testHook("BROWSER_TEST_SKIP_WELCOME") === "1",
      otherPageFirst: picker || plan === "offer",
    });
    if (welcome) BrowserController.all().find((window) => !window.isPrivate)?.openInternal("welcome");
    launches.ready();
    // End-to-end encrypted sync (ADR-019): off unless an account was set up on this device.
    services.sync.start();
    app.on("will-quit", () => services.sync.stop());
    // Auto-updates (ADR-030): packaged builds only, first check a little after startup.
    void startUpdates();
    // Extensions installed from the Chrome Web Store (ADR-049): checked once a day.
    services.extensions.startAutoUpdates();

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
