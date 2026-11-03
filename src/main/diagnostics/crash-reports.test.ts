import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseCrashEndpoint, type CrashReporterOptions } from "@shared/diagnostics";
import { mergeSettings, sanitizeSettings, type Settings } from "@shared/settings";
import { CrashReportService, type CrashReporterPort } from "./crash-reports";

class FakeReporter implements CrashReporterPort {
  started: CrashReporterOptions[] = [];
  upload = false;
  start(options: CrashReporterOptions): void {
    this.started.push(options);
    this.upload = options.uploadToServer;
  }
  setUploadToServer(upload: boolean): void {
    this.upload = upload;
  }
  getUploadToServer(): boolean {
    return this.upload;
  }
  getUploadedReports() {
    return [{ id: "server-1", date: new Date(0) }];
  }
}

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "crash-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function service(initial: Partial<Settings["diagnostics"]> = {}, endpoint = parseCrashEndpoint("https://relay.example.com/crash")) {
  let current = sanitizeSettings({ diagnostics: initial });
  const listeners: ((next: Settings) => void)[] = [];
  const reporter = new FakeReporter();
  const crashes = new CrashReportService({
    reporter,
    dumpsDir: dir,
    endpoint,
    productName: "Browser",
    version: "1.0.0",
    settings: () => current,
    onSettingsChanged: (listener) => listeners.push(listener),
  });
  const update = (crashReports: boolean) => {
    current = mergeSettings(current, { diagnostics: { crashReports } });
    for (const listener of listeners) listener(current);
  };
  return { crashes, reporter, update };
}

describe("CrashReportService", () => {
  it("starts Crashpad once, for local dumps only by default", () => {
    const { crashes, reporter } = service();
    crashes.start();
    crashes.start();
    expect(reporter.started).toHaveLength(1);
    expect(reporter.started[0]).toMatchObject({ uploadToServer: false, submitURL: "https://relay.example.com/crash" });
  });

  it("follows the opt-in live, and starts uploading when it was on", () => {
    const { crashes, reporter, update } = service();
    crashes.start();
    update(true);
    expect(reporter.upload).toBe(true);
    update(false);
    expect(reporter.upload).toBe(false);
    const again = service({ crashReports: true });
    again.crashes.start();
    expect(again.reporter.started[0].uploadToServer).toBe(true);
  });

  it("never uploads without an endpoint", () => {
    const { crashes, reporter, update } = service({ crashReports: true }, null);
    crashes.start();
    update(true);
    expect(reporter.upload).toBe(false);
    expect(crashes.info()).toMatchObject({ endpointHost: null, uploading: false });
  });

  it("lists the dumps on disk, newest first, and deletes them", () => {
    mkdirSync(join(dir, "completed"));
    mkdirSync(join(dir, "pending"));
    writeFileSync(join(dir, "completed", "old.dmp"), "x".repeat(10));
    writeFileSync(join(dir, "pending", "new.dmp"), "x".repeat(20));
    writeFileSync(join(dir, "pending", "new.meta"), "");
    writeFileSync(join(dir, "completed", "notes.txt"), "");
    utimesSync(join(dir, "completed", "old.dmp"), 1000, 1000);
    const { crashes } = service();
    crashes.start();
    const info = crashes.info();
    expect(info.crashes.map((crash) => [crash.id, crash.state, crash.sizeBytes])).toEqual([
      ["new", "pending", 20],
      ["old", "completed", 10],
    ]);
    expect(info.uploadedCount).toBe(1);
    expect(crashes.clear().crashes).toEqual([]);
  });
});
