import { WidevineService, type ComponentsPort } from "./drm";
import { join } from "node:path";
import type { Session } from "electron";
import type { Settings, SettingsPatch } from "@shared/settings";
import type { CollectionAdapter } from "@shared/sync/engine";
import type { Boost } from "@shared/boosts";
import { AutofillService } from "./autofill/service";
import { confirmCardReveal } from "./autofill/auth";
import { BoostService } from "./boosts/service";
import { CaptureService } from "./capture/service";
import { DownloadService } from "./downloads/service";
import { ExtensionService } from "./extensions/service";
import { DefaultBrowserService, type DefaultClientPort } from "./default-browser/service";
import { ImportService } from "./import/service";
import { browserLocations, detectSources, type BrowserLocation, type LocationEnv } from "./import/sources";
import { newPasswordId, PasswordVaultStore } from "./passwords/vault";
import { NotificationCenter, type ShownNotification } from "./notifications";
import { installPrivacy, isTabPage, permissionGranted } from "./privacy";
import { ReaderService } from "./reader";
import type { WindowDirectory } from "./ports";
import type { Profile } from "./profile";
import { SessionHardener } from "./session-hardener";
import { SecureDnsService } from "./secure-dns";
import type { HostResolverConfig } from "@shared/secure-dns";
import { SpellcheckService } from "./spellcheck";
import { PasskeyService } from "./webauthn";
import { setAppServices } from "./app-services-ref";
import { trackCertificates } from "./site-info/certificates";
import { StartImageCache } from "./start-image";
import type { AdapterDeps } from "./sync/adapters";
import { SyncService } from "./sync/service";
import { BackupService } from "./backup/service";
import { PrintService } from "./print/service";
import type { ProfileService } from "./profiles/service";
import { RecoveryService } from "./recovery/service";
import type { Session as SavedSession, SessionWindow } from "./storage/session";
import { TaskManagerService, type TaskManagerDeps } from "./tasks";
import { CrashReportService, type CrashReportDeps } from "./diagnostics/crash-reports";
import { spaces } from "./spaces";
import { EnergyService, type PowerPort } from "./energy";

export interface SessionOptions {
  /**
   * A private window's in-memory session (ADR-014): nothing it does is written to the profile
   * (downloads history, permission decisions, shields toggles), and extensions only load if allowed there.
   */
  ephemeral?: boolean;
}

/** A feature installed into every session tabs can use, when `SessionHardener` hardens it. Idempotent per session. */
export interface SessionService {
  install(session: Session, options?: SessionOptions): void;
  /** The session is going away (a private window closed). */
  release?(session: Session): void;
  /** The app is quitting. */
  dispose?(): void;
}

/**
 * Permissions granted without asking. Sensitive ones (camera, location…) are asked per site through
 * the permission bar; everything else is denied (see `src/main/privacy/permissions.ts`).
 */
const ALLOWED_PERMISSIONS = new Set(["fullscreen", "clipboard-sanitized-write", "pointerLock"]);

/** Content blocking, HTTPS-Only, Global Privacy Control, client hints and per-site permission prompts. */
const privacyService: SessionService = { install: (ses, options) => installPrivacy(ses, ALLOWED_PERMISSIONS, options) };
/** Certificates of verified hosts, for the site info popover (records only, never changes trust: ADR-021). */
const certificateService: SessionService = { install: (ses) => trackCertificates(ses) };

/** What the app services are built from, once the app is ready and the profile open. */
export interface AppConfig {
  paths: {
    /** The profile folder. */
    userData: string;
    /** The OS downloads folder. */
    downloads: string;
  };
  profile(): Profile;
  settings(): Settings;
  updateSettings(patch: SettingsPatch): Settings;
  onSettingsChanged(listener: (current: Settings) => void): unknown;
  /** The open browser windows (`BrowserController`), seen through their ports. */
  windows: WindowDirectory;
  /** The synced collections (`desktopAdapters`), passed in so this module stays out of the window graph. */
  syncAdapters(deps: AdapterDeps): CollectionAdapter[];
  appName: string;
  locale: string;
  /** The OS's default-app registration (Electron's `app`/`shell`), ADR-039. */
  defaultClient: DefaultClientPort;
  /** Where other browsers keep their data (home folder, Windows app data folders), ADR-039. */
  locationEnv: LocationEnv;
  /** castLabs' `components` API (Widevine, ADR-040), null with stock Electron. */
  components: ComponentsPort | null;
  platform: string;
  /** The user profiles and the open one (ADR-042). */
  profiles: ProfileService;
  /** Opens a browser window with saved tabs (`BrowserController`), ADR-042. */
  openWindow(saved: SessionWindow): unknown;
  /** The open windows as session.json holds them (ADR-042: backups). */
  session(): SavedSession;
  /** `app.getAppMetrics()` and `webContents.getAllWebContents()` (task manager, ADR-042). */
  processes: Pick<TaskManagerDeps, "metrics" | "allContents">;
  /** Crashpad and the build's crash endpoint (ADR-043). */
  crashReports: Pick<CrashReportDeps, "reporter" | "dumpsDir" | "endpoint" | "version">;
  /** Electron's `powerMonitor`: the energy saver (ADR-048). */
  power: PowerPort;
  /** `app.configureHostResolver`: secure DNS (ADR-046). */
  configureHostResolver(config: HostResolverConfig): void;
  /** Test hooks honored by an unpackaged app only (ADR-018). */
  testHooks?: {
    /** ADR-042: files used instead of the print and backup dialogs. */
    printPdfPath?: string;
    backupExportPath?: string;
    backupImportPath?: string;
    plainKeychain?: boolean;
    /** A Chromium "User Data" folder listed as an extra import source. */
    importChromiumDir?: string;
    /** Notifications shown are also recorded in `globalThis.__browserTestNotifications` (ADR-041). */
    notifications?: boolean;
  };
  /** macOS keychain access group for Touch ID passkeys (signed builds with the entitlement), ADR-041. */
  touchIdKeychainGroup?: string | null;
}

/**
 * The app's long-lived services, built once in `index.ts`. Features keep their exported function
 * facades (IPC handlers, windows), but the state lives in these instances.
 */
export class AppServices {
  readonly downloads: DownloadService;
  readonly extensions: ExtensionService;
  readonly passwords: PasswordVaultStore;
  readonly startImage: StartImageCache;
  readonly reader = new ReaderService();
  readonly boosts: BoostService;
  readonly capture: CaptureService;
  readonly sync: SyncService;
  readonly defaultBrowser: DefaultBrowserService;
  readonly imports: ImportService;
  readonly widevine: WidevineService;
  /** Crash recovery and recently closed windows (ADR-042). */
  readonly recovery: RecoveryService;
  readonly profiles: ProfileService;
  readonly tasks: TaskManagerService;
  readonly print: PrintService;
  readonly backup: BackupService;
  readonly autofill: AutofillService;
  readonly notifications: NotificationCenter;
  readonly spellcheck: SpellcheckService;
  readonly passkeys: PasskeyService;
  /** Crash reports (ADR-043). */
  readonly crashes: CrashReportService;
  /** DNS over HTTPS (ADR-046). */
  readonly secureDns: SecureDnsService;
  /** Energy saver (ADR-048). */
  readonly energy: EnergyService;
  /** Installed into each tab session, in this order. */
  readonly sessionServices: readonly SessionService[];
  readonly hardener: SessionHardener;

  constructor(config: AppConfig) {
    const { paths } = config;
    this.downloads = new DownloadService({
      history: () => config.profile(),
      settings: () => config.settings(),
      updateSettings: (patch) => config.updateSettings(patch),
      isTabPage,
      defaultFolder: paths.downloads,
      quarantineDir: join(paths.userData, "Unconfirmed downloads"),
    });
    this.extensions = new ExtensionService(paths.userData);
    this.passwords = new PasswordVaultStore({ profileDir: paths.userData, plainKeychain: config.testHooks?.plainKeychain });
    this.autofill = new AutofillService({
      profileDir: paths.userData,
      settings: () => config.settings(),
      confirmReveal: confirmCardReveal,
      plainKeychain: config.testHooks?.plainKeychain,
    });
    this.startImage = new StartImageCache();
    const { windows } = config;
    this.boosts = new BoostService({
      store: { list: () => config.profile().boosts, save: (next: readonly Boost[]) => config.profile().saveBoosts(next) },
      windows,
    });
    this.capture = new CaptureService({ windows, downloadsFolder: () => this.downloads.folder() });
    this.sync = new SyncService({
      userData: paths.userData,
      windows,
      onLocalChange: (listener) => {
        const stopProfile = config.profile().onChange(() => listener());
        // Saved addresses sync too when allowed (ADR-041); cards never do.
        const stopAutofill = this.autofill.onChanged(() => listener());
        return () => {
          stopProfile();
          stopAutofill();
        };
      },
      adapters: () => config.syncAdapters({ windows, boosts: this.boosts, autofill: this.autofill }),
    });
    this.defaultBrowser = new DefaultBrowserService(config.defaultClient);
    const testSource = config.testHooks?.importChromiumDir;
    const extraSources: (BrowserLocation & { id: string; name: string })[] = testSource
      ? [{ id: "test-chromium", browser: "chrome", family: "chromium", path: testSource, name: "Chrome (test)" }]
      : [];
    this.imports = new ImportService({
      profile: () => config.profile(),
      updateSettings: (patch) => config.updateSettings(patch),
      passwords: this.passwords,
      newPasswordId,
      detect: () => detectSources(browserLocations(config.locationEnv), extraSources),
      refreshAll: () => windows.refreshAll(),
    });
    this.widevine = new WidevineService({
      components: config.components,
      enabled: () => config.settings().privacy.protectedContent,
      platform: config.platform,
    });
    this.recovery = new RecoveryService({ windows, openWindow: (saved) => config.openWindow(saved) });
    this.profiles = config.profiles;
    this.tasks = new TaskManagerService({ windows, ...config.processes });
    this.print = new PrintService({ downloadsFolder: () => this.downloads.folder(), testSavePath: config.testHooks?.printPdfPath });
    this.backup = new BackupService({
      profile: () => config.profile(),
      profileName: () => this.profiles.info().name,
      replaceSettings: (next) => config.updateSettings(next),
      vault: this.passwords,
      session: () => config.session(),
      spaces,
      offerSession: (session) => this.recovery.offer(session),
      refreshAll: () => windows.refreshAll(),
      downloadsFolder: () => this.downloads.folder(),
      testExportPath: config.testHooks?.backupExportPath,
      testImportPath: config.testHooks?.backupImportPath,
    });
    const shownForTests: ShownNotification[] | null = config.testHooks?.notifications ? [] : null;
    if (shownForTests) (globalThis as { __browserTestNotifications?: ShownNotification[] }).__browserTestNotifications = shownForTests;
    this.notifications = new NotificationCenter({
      settings: () => config.settings(),
      allowed: (contents, origin) => permissionGranted(contents, origin, "notifications"),
      record: shownForTests ? (shown) => shownForTests.push(shown) : undefined,
    });
    this.spellcheck = new SpellcheckService({
      settings: () => config.settings(),
      onSettingsChanged: (listener) => config.onSettingsChanged(listener),
      locale: () => config.locale,
      platform: config.platform,
    });
    this.passkeys = new PasskeyService({ platform: config.platform, touchIdKeychainGroup: config.touchIdKeychainGroup });
    this.passkeys.configurePlatform();
    this.crashes = new CrashReportService({
      ...config.crashReports,
      productName: config.appName,
      settings: () => config.settings(),
      onSettingsChanged: (listener) => config.onSettingsChanged(listener),
    });
    this.secureDns = new SecureDnsService({
      configure: (resolver) => config.configureHostResolver(resolver),
      settings: () => config.settings(),
      onSettingsChanged: (listener) => config.onSettingsChanged(listener),
    });
    this.secureDns.start();
    this.energy = new EnergyService({
      power: config.power,
      settings: () => config.settings(),
      onSettingsChanged: (listener) => config.onSettingsChanged(listener),
      windows,
    });
    // Downloads: tab pages only, no automatic opening, dangerous types confirmed first (ADR-013); a
    // private session's ones never reach the history (ADR-014). Extensions: ADR-024.
    this.sessionServices = [privacyService, this.downloads, this.extensions, certificateService, this.spellcheck, this.passkeys];
    this.hardener = new SessionHardener({
      services: this.sessionServices,
      appName: () => config.appName,
      locale: () => config.locale,
      settings: () => config.settings(),
      onSettingsChanged: (listener) => config.onSettingsChanged(listener),
    });
  }

  dispose(): void {
    this.sync.stop();
    this.print.dispose();
    this.notifications.dispose();
    for (const service of this.sessionServices) service.dispose?.();
  }
}

/** Builds the app services (once, at startup); `appServices()` (./app-services-ref) then returns them. */
export function buildAppServices(config: AppConfig): AppServices {
  const services = new AppServices(config);
  setAppServices(services);
  return services;
}
