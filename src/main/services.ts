import { join } from "node:path";
import type { Session } from "electron";
import type { Settings, SettingsPatch } from "@shared/settings";
import type { CollectionAdapter } from "@shared/sync/engine";
import type { Boost } from "@shared/boosts";
import { BoostService } from "./boosts/service";
import { CaptureService } from "./capture/service";
import { DownloadService } from "./downloads/service";
import { ExtensionService } from "./extensions/service";
import { PasswordVaultStore } from "./passwords/vault";
import { installPrivacy, isTabPage } from "./privacy";
import { ReaderService } from "./reader";
import type { WindowDirectory } from "./ports";
import type { Profile } from "./profile";
import { SessionHardener } from "./session-hardener";
import { trackCertificates } from "./site-info/certificates";
import { StartImageCache } from "./start-image";
import type { AdapterDeps } from "./sync/adapters";
import { SyncService } from "./sync/service";

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
  /** Test hooks honored by an unpackaged app only (ADR-018). */
  testHooks?: { plainKeychain?: boolean };
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
      onLocalChange: (listener) => config.profile().onChange(() => listener()),
      adapters: () => config.syncAdapters({ windows, boosts: this.boosts }),
    });
    // Downloads: tab pages only, no automatic opening, dangerous types confirmed first (ADR-013); a
    // private session's ones never reach the history (ADR-014). Extensions: ADR-024.
    this.sessionServices = [privacyService, this.downloads, this.extensions, certificateService];
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
    for (const service of this.sessionServices) service.dispose?.();
  }
}

let current: AppServices | null = null;

/** Builds the app services (once, at startup). */
export function buildAppServices(config: AppConfig): AppServices {
  if (current) throw new Error("App services are already built");
  current = new AppServices(config);
  return current;
}

/** The app services; only once `buildAppServices` ran (the app is ready). */
export function appServices(): AppServices {
  if (!current) throw new Error("App services used before startup (buildAppServices)");
  return current;
}
