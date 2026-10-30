import type { UpdateSettings } from "@shared/settings";
import {
  initialUpdateStatus,
  isUpdateBusy,
  reduceUpdateStatus,
  UPDATE_INTERVAL_MS,
  UPDATE_STARTUP_DELAY_MS,
  type UpdateEvent,
  type UpdateStatus,
} from "@shared/updates";

/**
 * Auto-update logic (ADR-030), free of Electron so it can be unit-tested: an `Updater` (the
 * electron-updater adapter, or a fake in dev/e2e) does the work; the service schedules checks,
 * starts downloads itself (the updater never downloads on its own) and keeps the status.
 */

/** What the service needs from an updater. Promises reject on failure; progress arrives as events. */
export interface Updater {
  /** `allowPrerelease`: the beta channel. */
  configure(options: { allowPrerelease: boolean }): void;
  /** Emits "checking", then "available" or "not-available". */
  check(): Promise<void>;
  /** Emits "progress" events then "downloaded". */
  download(): Promise<void>;
  /** Quits and installs the downloaded update. */
  install(): void;
  onEvent(listener: (event: UpdateEvent) => void): void;
}

export interface Timers {
  setTimeout(callback: () => void, ms: number): unknown;
  setInterval(callback: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

export interface UpdateServiceOptions {
  updater: Updater | null;
  currentVersion: string;
  /** The installation can replace itself (false: "manual", with a link to the release page). */
  canInstall: boolean;
  preferences: UpdateSettings;
  onStatus?: (status: UpdateStatus) => void;
  now?: () => number;
  timers?: Timers;
  startupDelayMs?: number;
  intervalMs?: number;
}

const realTimers: Timers = {
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  setInterval: (callback, ms) => setInterval(callback, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export const CHECK_FAILED = "Impossible de rechercher les mises à jour. Vérifiez votre connexion, puis réessayez.";
export const DOWNLOAD_FAILED = "Le téléchargement de la mise à jour a échoué. Réessayez plus tard.";

export class UpdateService {
  private state: UpdateStatus;
  private preferences: UpdateSettings;
  private readonly updater: Updater | null;
  private readonly onStatus?: (status: UpdateStatus) => void;
  private readonly now: () => number;
  private readonly timers: Timers;
  private readonly startupDelayMs: number;
  private readonly intervalMs: number;
  private handles: unknown[] = [];

  constructor(options: UpdateServiceOptions) {
    this.updater = options.updater;
    this.preferences = { ...options.preferences };
    this.onStatus = options.onStatus;
    this.now = options.now ?? Date.now;
    this.timers = options.timers ?? realTimers;
    this.startupDelayMs = options.startupDelayMs ?? UPDATE_STARTUP_DELAY_MS;
    this.intervalMs = options.intervalMs ?? UPDATE_INTERVAL_MS;
    this.state = initialUpdateStatus(options.currentVersion, { enabled: Boolean(this.updater), canInstall: options.canInstall });
    this.updater?.configure({ allowPrerelease: this.preferences.channel === "beta" });
    this.updater?.onEvent((event) => this.dispatch(event));
  }

  get status(): UpdateStatus {
    return this.state;
  }

  /** First check after a delay (startup must stay fast), then every `intervalMs`. */
  start(): void {
    if (!this.updater || this.handles.length) return;
    this.handles.push(
      this.timers.setTimeout(() => void this.check(), this.startupDelayMs),
      this.timers.setInterval(() => void this.check(), this.intervalMs),
    );
  }

  stop(): void {
    for (const handle of this.handles) this.timers.clear(handle);
    this.handles = [];
  }

  setPreferences(next: UpdateSettings): void {
    const previous = this.preferences;
    this.preferences = { ...next };
    if (!this.updater) return;
    if (previous.channel !== next.channel) {
      this.updater.configure({ allowPrerelease: next.channel === "beta" });
      // Another channel may offer another version: look again (unless an update is already downloaded).
      if (this.state.phase !== "ready") void this.check();
    } else if (!previous.autoDownload && next.autoDownload && this.state.phase === "available") {
      void this.download();
    }
  }

  async check(): Promise<void> {
    if (!this.updater || isUpdateBusy(this.state)) return;
    this.dispatch({ type: "checking" });
    try {
      await this.updater.check();
    } catch {
      this.dispatch({ type: "error", message: CHECK_FAILED });
      return;
    }
    // Some updaters resolve without any event (nothing configured): never stay "checking".
    if (this.state.phase === "checking") this.dispatch({ type: "not-available" });
    if (this.state.phase === "available" && this.preferences.autoDownload) await this.download();
  }

  async download(): Promise<void> {
    if (!this.updater || !this.state.canInstall || (this.state.phase !== "available" && this.state.phase !== "error") || !this.state.version) return;
    this.dispatch({ type: "download-started" });
    try {
      await this.updater.download();
    } catch {
      this.dispatch({ type: "error", message: DOWNLOAD_FAILED });
    }
  }

  /** Restarts into the downloaded update. */
  install(): boolean {
    if (!this.updater || this.state.phase !== "ready") return false;
    this.updater.install();
    return true;
  }

  private dispatch(event: UpdateEvent): void {
    const next = reduceUpdateStatus(this.state, event, this.now());
    if (next === this.state) return;
    this.state = next;
    this.onStatus?.(next);
  }
}
