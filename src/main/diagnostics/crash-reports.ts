import { readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  crashReporterOptions,
  sortCrashes,
  type CrashEndpoint,
  type CrashEntry,
  type CrashReporterOptions,
  type CrashReportsInfo,
} from "@shared/diagnostics";
import type { Settings } from "@shared/settings";

/** Electron's `crashReporter`, narrowed to what the service uses (a fake in tests). */
export interface CrashReporterPort {
  start(options: CrashReporterOptions): void;
  setUploadToServer(upload: boolean): void;
  getUploadToServer(): boolean;
  getUploadedReports(): { id: string; date: Date }[];
}

export interface CrashReportDeps {
  reporter: CrashReporterPort;
  /** `app.getPath("crashDumps")`: Crashpad's database (per profile). */
  dumpsDir: string;
  /** The build's endpoint (`MAIN_VITE_CRASH_ENDPOINT`, or the test hook), null without one. */
  endpoint: CrashEndpoint | null;
  productName: string;
  version: string;
  settings(): Settings;
  onSettingsChanged(listener: (current: Settings) => void): unknown;
}

/** Crashpad's database folders holding dumps (`reports` on Windows). */
const DUMP_FOLDERS: Record<string, CrashEntry["state"]> = { pending: "pending", new: "pending", completed: "completed", reports: "other" };

/**
 * Crash reports (ADR-043). Crashpad always collects dumps on the device (the settings list them,
 * "Effacer" deletes them); uploads happen only while the user's opt-in is on and the build has an
 * endpoint. The opt-in is applied live (`setUploadToServer`), the reporter being started once.
 */
export class CrashReportService {
  private started = false;
  /** What `start` was given: read by the e2e test through its hook. */
  lastStart: CrashReporterOptions | null = null;

  constructor(private readonly deps: CrashReportDeps) {}

  private wanted(current: Settings): boolean {
    return current.diagnostics.crashReports && this.deps.endpoint !== null;
  }

  /** Starts Crashpad (once), then follows the opt-in. */
  start(): void {
    if (this.started) return;
    this.started = true;
    const current = this.deps.settings();
    this.lastStart = crashReporterOptions({
      enabled: this.wanted(current),
      endpoint: this.deps.endpoint,
      productName: this.deps.productName,
      version: this.deps.version,
      channel: current.updates.channel,
    });
    try {
      this.deps.reporter.start(this.lastStart);
    } catch {
      // A reporter that cannot start (sandboxed test runs…) must never stop the browser.
      return;
    }
    this.deps.onSettingsChanged((next) => {
      const upload = this.wanted(next);
      if (this.uploading() !== upload) this.deps.reporter.setUploadToServer(upload);
    });
  }

  uploading(): boolean {
    try {
      return this.started && this.deps.reporter.getUploadToServer();
    } catch {
      return false;
    }
  }

  /** The dumps on disk (newest first). */
  crashes(): CrashEntry[] {
    const entries: CrashEntry[] = [];
    for (const [folder, state] of Object.entries(DUMP_FOLDERS)) {
      const dir = join(this.deps.dumpsDir, folder);
      let names: string[];
      try {
        names = readdirSync(dir);
      } catch {
        continue;
      }
      for (const name of names) {
        if (!name.endsWith(".dmp")) continue;
        try {
          const stat = statSync(join(dir, name));
          entries.push({ id: name.slice(0, -4), date: stat.mtimeMs, sizeBytes: stat.size, state });
        } catch {
          // Removed meanwhile.
        }
      }
    }
    return sortCrashes(entries);
  }

  info(): CrashReportsInfo {
    let uploadedCount = 0;
    try {
      uploadedCount = this.started ? this.deps.reporter.getUploadedReports().length : 0;
    } catch {
      uploadedCount = 0;
    }
    return { endpointHost: this.deps.endpoint?.host ?? null, uploading: this.uploading(), uploadedCount, crashes: this.crashes() };
  }

  /** Deletes the dumps kept on the device ("Effacer les rapports"). */
  clear(): CrashReportsInfo {
    for (const folder of Object.keys(DUMP_FOLDERS)) {
      const dir = join(this.deps.dumpsDir, folder);
      let names: string[] = [];
      try {
        names = readdirSync(dir);
      } catch {
        continue;
      }
      for (const name of names) if (name.endsWith(".dmp") || name.endsWith(".meta")) rmSync(join(dir, name), { force: true });
    }
    return this.info();
  }
}
