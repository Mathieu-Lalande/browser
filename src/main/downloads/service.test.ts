import { mkdtempSync, rmSync } from "node:fs";
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
  constructor(private readonly url: string) {
    super();
  }
  getURL = () => this.url;
  getFilename = () => "report.pdf";
  getMimeType = () => "application/pdf";
  getTotalBytes = () => 100;
  getReceivedBytes = () => (this.state === "completed" ? 100 : 0);
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

/** A session that only knows `will-download`. */
class FakeSession extends EventEmitter {
  download(item: FakeItem, contents: WebContents | null): { prevented: boolean } {
    const event = { prevented: false, preventDefault: () => (event.prevented = true) };
    this.emit("will-download", event, item, contents);
    return event;
  }
}

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "downloads-"));
  dirs.push(dir);
  const downloads = new DownloadList();
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
  return { service, downloads, saveDownloads, tabPage, changes };
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
