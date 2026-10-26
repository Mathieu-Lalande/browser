import { describe, expect, it } from "vitest";
import { downloadStatus, formatBytes, formatDuration, isOpenable, overallProgress, type DownloadEntry } from "./downloads";

const entry = (overrides: Partial<DownloadEntry> = {}): DownloadEntry => ({
  id: "d1",
  url: "https://example.com/file.pdf",
  filename: "file.pdf",
  path: "/tmp/file.pdf",
  mimeType: "application/pdf",
  totalBytes: 10 * 1024 * 1024,
  receivedBytes: 0,
  state: "progressing",
  speed: 0,
  dangerous: false,
  awaitingConfirmation: false,
  canResume: false,
  startedAt: 0,
  endedAt: null,
  ...overrides,
});

describe("formatting", () => {
  it("formats sizes with French units", () => {
    expect(formatBytes(0)).toBe("0 o");
    expect(formatBytes(512)).toBe("512 o");
    expect(formatBytes(1536)).toBe("1,5 Ko");
    expect(formatBytes(3.2 * 1024 * 1024)).toBe("3,2 Mo");
    expect(formatBytes(750 * 1024 * 1024)).toBe("750 Mo");
    expect(formatBytes(Number.NaN)).toBe("0 o");
  });

  it("formats remaining times", () => {
    expect(formatDuration(0.2)).toBe("1 s");
    expect(formatDuration(42)).toBe("42 s");
    expect(formatDuration(150)).toBe("3 min");
    expect(formatDuration(2 * 3600 + 5 * 60)).toBe("2 h 05");
  });
});

describe("downloadStatus", () => {
  it("describes a running download with speed and time left", () => {
    const status = downloadStatus(entry({ receivedBytes: 5 * 1024 * 1024, speed: 1024 * 1024 }));
    expect(status).toBe("5 Mo / 10 Mo · 1 Mo/s · 5 s");
    expect(downloadStatus(entry({ totalBytes: 0, receivedBytes: 2048 }))).toBe("2 Ko");
  });

  it("describes the other states", () => {
    expect(downloadStatus(entry({ state: "completed", receivedBytes: 10 * 1024 * 1024 }))).toBe("Terminé · 10 Mo");
    expect(downloadStatus(entry({ state: "cancelled" }))).toBe("Annulé");
    expect(downloadStatus(entry({ state: "interrupted", canResume: true }))).toBe("Interrompu · peut reprendre");
    expect(downloadStatus(entry({ state: "interrupted" }))).toBe("Échec du téléchargement");
    expect(downloadStatus(entry({ state: "paused", receivedBytes: 1024 }))).toBe("En pause · 1 Ko / 10 Mo");
    expect(downloadStatus(entry({ state: "completed", awaitingConfirmation: true }))).toMatch(/dangereux · à confirmer/);
  });
});

describe("overallProgress and isOpenable", () => {
  it("averages running downloads by bytes", () => {
    expect(overallProgress([])).toBeNull();
    expect(overallProgress([entry({ state: "completed" })])).toBeNull();
    expect(overallProgress([entry({ totalBytes: 100, receivedBytes: 50 }), entry({ totalBytes: 300, receivedBytes: 50 })])).toBe(0.25);
    // One unknown size makes the whole ring indeterminate.
    expect(overallProgress([entry({ totalBytes: 0 }), entry({ totalBytes: 100 })])).toBeNull();
  });

  it("only opens complete, confirmed files", () => {
    expect(isOpenable(entry({ state: "completed" }))).toBe(true);
    expect(isOpenable(entry({ state: "progressing" }))).toBe(false);
    expect(isOpenable(entry({ state: "completed", awaitingConfirmation: true }))).toBe(false);
    expect(isOpenable(entry({ state: "completed", path: "" }))).toBe(false);
  });
});
