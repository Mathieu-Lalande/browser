import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import type { Session, WebContents } from "electron";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "@shared/settings";
import { DownloadList } from "./list";

vi.mock("electron", () => ({ dialog: {}, shell: {} }));
const { DownloadService } = await import("./service");

/** A DownloadItem that downloads nothing: its state changes when the test says so. */
class FakeItem extends EventEmitter {
  state: "progressing" | "completed" | "cancelled" | "interrupted" = "progressing";
  savePath = "";
  received = 0;
  etag = '"v1"';
  resumed = false;
  constructor(private readonly url: string) {
    super();
  }
  getURL = () => this.url;
  getURLChain = () => [this.url];
  getETag = () => this.etag;
  getLastModifiedTime = () => "";
  getStartTime = () => 1_700_000_000;
  resume = () => {
    this.resumed = true;
    this.state = "progressing";
  };
  getFilename = () => "report.pdf";
  getMimeType = () => "application/pdf";
  getTotalBytes = () => 100;
  getReceivedBytes = () => (this.state === "completed" ? 100 : this.received);
  getCurrentBytesPerSecond = () => 0;
  getState = () => this.state;
  isPaused = () => false;
  canResume = () => false;
  getSavePath = () => this.savePath;
  setSavePath = (path: string) => (this.savePath = path);
  setSaveDialogOptions = () => {};
  cancel = () => {
    this.state = "cancelled";
    this.emit("done");
  };
}

/** A session that only knows `will-download` (and how a download starts again). */
class FakeSession extends EventEmitter {
  readonly interrupted: { path: string; offset: number; eTag: string; urlChain: string[] }[] = [];
  readonly urls: string[] = [];
  readonly items: FakeItem[] = [];
  download(item: FakeItem, contents: WebContents | null): { prevented: boolean } {
    const event = { prevented: false, preventDefault: () => (event.prevented = true) };
    this.emit("will-download", event, item, contents);
    return event;
  }
  createInterruptedDownload(options: { path: string; offset: number; eTag: string; urlChain: string[] }): void {
    this.interrupted.push(options);
    const item = new FakeItem(options.urlChain.at(-1)!);
    item.state = "interrupted";
    item.savePath = options.path;
    item.received = options.offset;
    this.items.push(item);
    this.download(item, null);
  }
  downloadURL(url: string): void {
    this.urls.push(url);
  }
}

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function setup(downloads = new DownloadList(), dir = mkdtempSync(join(tmpdir(), "downloads-"))) {
  dirs.push(dir);
  const saveDownloads = vi.fn();
  const tabPage = {} as WebContents;
  const service = new DownloadService({
    history: () => ({ downloads, saveDownloads }),
    settings: () => DEFAULT_SETTINGS,
    updateSettings: () => DEFAULT_SETTINGS,
    isTabPage: (contents) => contents === tabPage,
    defaultFolder: join(dir, "Downloads"),
    quarantineDir: join(dir, "quarantine"),
  });
  const changes: string[][] = [];
  service.onChanged((change) => changes.push(change.removed));
  return { service, downloads, saveDownloads, tabPage, changes, dir };
}

/** The app quits and starts again: downloads.json is read back into a new service. */
function restart(previous: DownloadList, dir: string) {
  return setup(new DownloadList(DownloadList.parse(JSON.parse(JSON.stringify(previous.toJSON()))) ?? []), dir);
}

const asSession = (ses: FakeSession) => ses as unknown as Session;

describe("DownloadService", () => {
  it("only lets tab pages download", () => {
    const { service, downloads, tabPage } = setup();
    const ses = new FakeSession();
    service.install(asSession(ses));
    expect(ses.download(new FakeItem("https://a.example/x"), null).prevented).toBe(true);
    expect(ses.download(new FakeItem("https://a.example/x"), {} as WebContents).prevented).toBe(true);
    expect(ses.download(new FakeItem("https://a.example/x"), tabPage).prevented).toBe(false);
    expect(downloads.list()).toHaveLength(1);
  });

  it("is idempotent per session", () => {
    const { service, downloads, tabPage } = setup();
    const ses = new FakeSession();
    service.install(asSession(ses));
    service.install(asSession(ses));
    ses.download(new FakeItem("https://a.example/x"), tabPage);
    expect(downloads.list()).toHaveLength(1);
  });

  it("keeps a private session's downloads to that window, and forgets them when it closes", () => {
    const { service, downloads, tabPage, changes } = setup();
    const normal = new FakeSession();
    const secret = new FakeSession();
    service.install(asSession(normal));
    service.install(asSession(secret), { ephemeral: true });
    const viewer = service.viewerOf(asSession(secret));
    expect(viewer).toEqual(expect.any(String));
    expect(service.viewerOf(asSession(normal))).toBeNull();

    normal.download(new FakeItem("https://a.example/public"), tabPage);
    const running = new FakeItem("https://a.example/secret");
    secret.download(running, tabPage);
    const [privateEntry, publicEntry] = downloads.list();
    expect(service.isVisible(privateEntry.id, viewer)).toBe(true);
    expect(service.isVisible(privateEntry.id, null)).toBe(false);
    expect(service.list(null).map((entry) => entry.id)).toEqual([publicEntry.id]);
    // Never written to downloads.json.
    expect(downloads.toJSON().map((entry) => entry.id)).toEqual([publicEntry.id]);

    service.release(asSession(secret));
    expect(running.state).toBe("cancelled");
    expect(downloads.list().map((entry) => entry.id)).toEqual([publicEntry.id]);
    expect(changes.at(-1)).toEqual([privateEntry.id]);
    expect(service.viewerOf(asSession(secret))).toBeNull();
  });

  it("names downloads uniquely in the downloads folder", () => {
    const { service, downloads, tabPage } = setup();
    const ses = new FakeSession();
    service.install(asSession(ses));
    ses.download(new FakeItem("https://a.example/1"), tabPage);
    ses.download(new FakeItem("https://a.example/2"), tabPage);
    const names = downloads.list().map((entry) => entry.filename).sort();
    expect(names).toEqual(["report (1).pdf", "report.pdf"]);
  });
});

describe("DownloadService: continuing after a restart (ADR-054)", () => {
  it("keeps what continuing needs and continues from the partial file", () => {
    const first = setup();
    const ses = new FakeSession();
    first.service.install(asSession(ses));
    const item = new FakeItem("https://a.example/big.pdf");
    ses.download(item, first.tabPage);
    item.received = 40;
    item.emit("updated");
    const [running] = first.downloads.toJSON();
    expect(running.resume).toMatchObject({ urlChain: ["https://a.example/big.pdf"], etag: '"v1"' });
    // The UI never gets the redirects and validators.
    expect(first.service.list(null)[0]).not.toHaveProperty("resume");
    writeFileSync(running.path, "x".repeat(40));

    // The app quits while it runs: next time it is interrupted, ready to continue.
    const second = restart(first.downloads, first.dir);
    const [stored] = second.service.list(null);
    expect(stored).toMatchObject({ id: running.id, state: "interrupted", canResume: true });
    const nextSession = new FakeSession();
    second.service.install(asSession(nextSession));
    second.service.resume(running.id, asSession(nextSession));
    expect(nextSession.interrupted).toEqual([expect.objectContaining({ path: running.path, offset: 40, eTag: '"v1"', urlChain: ["https://a.example/big.pdf"] })]);
    expect(nextSession.urls).toEqual([]);
    const continued = nextSession.items[0];
    expect(continued.resumed).toBe(true);
    expect(second.downloads.get(running.id)).toMatchObject({ state: "progressing" });
    continued.state = "completed";
    continued.emit("done");
    expect(second.downloads.get(running.id)).toMatchObject({ state: "completed", receivedBytes: 100 });
    expect(second.downloads.get(running.id)).not.toHaveProperty("resume");
  });

  it("starts over when the server gave no validator, or the partial file is gone", () => {
    const first = setup();
    const ses = new FakeSession();
    first.service.install(asSession(ses));
    const item = new FakeItem("https://a.example/plain.pdf");
    item.etag = "";
    ses.download(item, first.tabPage);
    item.emit("updated");
    expect(first.downloads.toJSON()[0].resume).toBeUndefined();
    const second = restart(first.downloads, first.dir);
    const [stored] = second.service.list(null);
    expect(stored.canResume).toBe(false);
    const nextSession = new FakeSession();
    second.service.install(asSession(nextSession));
    second.service.retry(stored.id, asSession(nextSession));
    expect(nextSession.interrupted).toEqual([]);
    expect(nextSession.urls).toEqual(["https://a.example/plain.pdf"]);
  });

  it("a cancel the user did not ask for keeps it resumable; the user's own does not", () => {
    const { service, downloads, tabPage } = setup();
    const ses = new FakeSession();
    service.install(asSession(ses));
    const shutdown = new FakeItem("https://a.example/1");
    const cancelled = new FakeItem("https://a.example/2");
    ses.download(shutdown, tabPage);
    ses.download(cancelled, tabPage);
    const [second, first] = downloads.list();
    shutdown.cancel();
    service.cancel(second.id);
    expect(downloads.get(first.id)).toMatchObject({ state: "interrupted", canResume: true });
    expect(downloads.get(second.id)?.state).toBe("cancelled");
    expect(downloads.get(second.id)?.resume).toBeUndefined();
  });

  it("keeps the partial file under another name when the app quits, and puts it back to continue", () => {
    const first = setup();
    const ses = new FakeSession();
    first.service.install(asSession(ses));
    const item = new FakeItem("https://a.example/big.pdf");
    ses.download(item, first.tabPage);
    item.received = 30;
    item.emit("updated");
    const [running] = first.downloads.list();
    writeFileSync(running.path, "y".repeat(30));
    first.service.keepForRestart();
    expect(first.downloads.get(running.id)).toMatchObject({ state: "interrupted", canResume: true, receivedBytes: 30 });
    // Chromium deletes the file at shutdown; an item ending now changes nothing.
    rmSync(running.path);
    item.cancel();
    expect(first.downloads.get(running.id)?.state).toBe("interrupted");
    expect(readFileSync(`${running.path}.crdownload`, "utf8")).toBe("y".repeat(30));

    const second = restart(first.downloads, first.dir);
    const nextSession = new FakeSession();
    second.service.install(asSession(nextSession));
    second.service.retry(running.id, asSession(nextSession));
    expect(nextSession.interrupted[0]).toMatchObject({ path: running.path, offset: 30 });
    expect(existsSync(running.path)).toBe(true);
  });

  it("never keeps anything for a private window", () => {
    const { service, downloads, tabPage } = setup();
    const secret = new FakeSession();
    service.install(asSession(secret), { ephemeral: true });
    const item = new FakeItem("https://a.example/secret");
    secret.download(item, tabPage);
    item.emit("updated");
    expect(downloads.list()[0].resume).toBeUndefined();
  });
});
