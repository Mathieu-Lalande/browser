import { describe, expect, it, vi } from "vitest";
import { initialUpdateStatus, reduceUpdateStatus, releasePageUrl, updateStatusText, type UpdateEvent, type UpdateStatus } from "@shared/updates";
import { CHECK_FAILED, DOWNLOAD_FAILED, UpdateService, type Timers, type Updater } from "./service";

const base = () => initialUpdateStatus("1.0.0", { enabled: true, canInstall: true });
const run = (events: UpdateEvent[], state: UpdateStatus = base()) => events.reduce((s, e) => reduceUpdateStatus(s, e, 1000), state);

describe("update state machine", () => {
  it("goes from checking to ready", () => {
    const states = [{ type: "checking" }, { type: "available", version: "1.1.0" }, { type: "download-started" }, { type: "progress", percent: 42.4 }, { type: "downloaded", version: "1.1.0" }] as UpdateEvent[];
    const phases = states.map((_, i) => run(states.slice(0, i + 1)).phase);
    expect(phases).toEqual(["checking", "available", "downloading", "downloading", "ready"]);
    expect(run(states.slice(0, 4)).percent).toBe(42);
    const ready = run(states);
    expect(ready.lastCheck).toBe(1000);
    expect(ready.releaseUrl).toBe(releasePageUrl("1.1.0"));
    expect(updateStatusText(ready)).toContain("redémarrez");
    expect(updateStatusText(run(states.slice(0, 4)))).toBe("Téléchargement de la version 1.1.0 : 42 %");
  });

  it("reports up to date and errors", () => {
    expect(run([{ type: "checking" }, { type: "not-available" }]).phase).toBe("up-to-date");
    expect(updateStatusText(run([{ type: "not-available" }]))).toBe("Browser est à jour (version 1.0.0).");
    const failed = run([{ type: "checking" }, { type: "error", message: "Oups" }]);
    expect(failed).toMatchObject({ phase: "error", error: "Oups", lastCheck: 1000 });
  });

  it("keeps a downloaded update whatever later checks say", () => {
    const ready = run([{ type: "available", version: "1.1.0" }, { type: "downloaded", version: "1.1.0" }]);
    for (const event of [{ type: "checking" }, { type: "not-available" }, { type: "error", message: "x" }, { type: "progress", percent: 3 }] as UpdateEvent[])
      expect(run([event], ready).phase).toBe("ready");
  });

  it("asks for a manual update when the installation cannot replace itself", () => {
    const manual = run([{ type: "available", version: "1.1.0" }, { type: "download-started" }, { type: "progress", percent: 50 }], initialUpdateStatus("1.0.0", { enabled: true, canInstall: false }));
    expect(manual.phase).toBe("manual");
    expect(manual.releaseUrl).toBe("https://github.com/Mathieu-Lalande/browser/releases/tag/v1.1.0");
    expect(updateStatusText(manual)).toContain("mise à jour manuelle requise");
  });

  it("ignores everything when disabled, and builds safe release URLs", () => {
    const disabled = initialUpdateStatus("1.0.0", { enabled: false, canInstall: true });
    expect(run([{ type: "available", version: "2.0.0" }], disabled)).toBe(disabled);
    expect(releasePageUrl("../../evil")).toBe("https://github.com/Mathieu-Lalande/browser/releases/latest");
    expect(releasePageUrl("1.2.3-beta.1")).toMatch(/tag\/v1\.2\.3-beta\.1$/);
  });
});

class ScriptedUpdater implements Updater {
  listener: (event: UpdateEvent) => void = () => {};
  allowPrerelease = false;
  next: "available" | "none" | "fail" = "available";
  failDownload = false;
  checks = 0;
  downloads = 0;
  installs = 0;
  configure(options: { allowPrerelease: boolean }) {
    this.allowPrerelease = options.allowPrerelease;
  }
  onEvent(listener: (event: UpdateEvent) => void) {
    this.listener = listener;
  }
  async check() {
    this.checks++;
    this.listener({ type: "checking" });
    if (this.next === "fail") throw new Error("network");
    this.listener(this.next === "none" ? { type: "not-available" } : { type: "available", version: "2.0.0" });
  }
  async download() {
    this.downloads++;
    if (this.failDownload) throw new Error("disk");
    this.listener({ type: "progress", percent: 50 });
    this.listener({ type: "downloaded", version: "2.0.0" });
  }
  install() {
    this.installs++;
  }
}

function setup(preferences = { autoDownload: true, channel: "stable" as const }, canInstall = true) {
  const updater = new ScriptedUpdater();
  const timeouts: { callback: () => void; ms: number }[] = [];
  const intervals: { callback: () => void; ms: number }[] = [];
  const timers: Timers = {
    setTimeout: (callback, ms) => timeouts.push({ callback, ms }),
    setInterval: (callback, ms) => intervals.push({ callback, ms }),
    clear: vi.fn(),
  };
  const onStatus = vi.fn();
  const service = new UpdateService({ updater, currentVersion: "1.0.0", canInstall, preferences, onStatus, timers, now: () => 5 });
  return { updater, service, timeouts, intervals, onStatus, timers };
}

describe("UpdateService", () => {
  it("checks after a startup delay then every 6 hours, and downloads automatically", async () => {
    const { updater, service, timeouts, intervals } = setup();
    service.start();
    service.start();
    expect(timeouts).toHaveLength(1);
    expect(timeouts[0].ms).toBe(30_000);
    expect(intervals[0].ms).toBe(6 * 60 * 60 * 1000);
    timeouts[0].callback();
    await vi.waitFor(() => expect(service.status.phase).toBe("ready"));
    expect(updater.downloads).toBe(1);
    expect(service.install()).toBe(true);
    expect(updater.installs).toBe(1);
  });

  it("waits for the user when automatic download is off, and starts when it is turned on", async () => {
    const { updater, service } = setup({ autoDownload: false, channel: "stable" });
    await service.check();
    expect(service.status.phase).toBe("available");
    expect(updater.downloads).toBe(0);
    expect(service.install()).toBe(false);
    service.setPreferences({ autoDownload: true, channel: "stable" });
    await vi.waitFor(() => expect(service.status.phase).toBe("ready"));
  });

  it("never downloads what it cannot install", async () => {
    const { updater, service } = setup(undefined, false);
    await service.check();
    await service.download();
    expect(service.status.phase).toBe("manual");
    expect(updater.downloads).toBe(0);
  });

  it("switches to pre-releases on the beta channel and checks again", async () => {
    const { updater, service } = setup();
    expect(updater.allowPrerelease).toBe(false);
    updater.next = "none";
    service.setPreferences({ autoDownload: true, channel: "beta" });
    expect(updater.allowPrerelease).toBe(true);
    await vi.waitFor(() => expect(service.status.phase).toBe("up-to-date"));
    expect(updater.checks).toBe(1);
  });

  it("turns failures into French messages", async () => {
    const { updater, service } = setup();
    updater.next = "fail";
    await service.check();
    expect(service.status).toMatchObject({ phase: "error", error: CHECK_FAILED() });
    updater.next = "available";
    updater.failDownload = true;
    await service.check();
    expect(service.status).toMatchObject({ phase: "error", error: DOWNLOAD_FAILED(), version: "2.0.0" });
  });

  it("does nothing without an updater", async () => {
    const service = new UpdateService({ updater: null, currentVersion: "1.0.0", canInstall: true, preferences: { autoDownload: true, channel: "stable" } });
    service.start();
    await service.check();
    expect(service.status.phase).toBe("disabled");
  });
});
