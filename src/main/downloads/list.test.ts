import { describe, expect, it } from "vitest";
import type { DownloadEntry } from "@shared/downloads";
import { DownloadList, MAX_DOWNLOADS, applySnapshot, sanitizeEntry, type ItemSnapshot } from "./list";

const entry = (overrides: Partial<DownloadEntry> = {}): DownloadEntry => ({
  id: "d1",
  url: "https://example.com/file.pdf",
  filename: "file.pdf",
  path: "/home/me/Downloads/file.pdf",
  mimeType: "application/pdf",
  totalBytes: 1000,
  receivedBytes: 0,
  state: "progressing",
  speed: 0,
  dangerous: false,
  awaitingConfirmation: false,
  canResume: false,
  startedAt: 1_000,
  endedAt: null,
  ...overrides,
});

const snap = (overrides: Partial<ItemSnapshot> = {}): ItemSnapshot => ({
  state: "progressing",
  paused: false,
  receivedBytes: 500,
  totalBytes: 1000,
  bytesPerSecond: 250,
  canResume: true,
  ...overrides,
});

describe("applySnapshot (download state reducer)", () => {
  it("tracks progress and speed while running", () => {
    const next = applySnapshot(entry(), snap(), 2_000);
    expect(next).toMatchObject({ state: "progressing", receivedBytes: 500, speed: 250, endedAt: null, canResume: false });
  });

  it("maps a paused item to the paused state, without speed", () => {
    const next = applySnapshot(entry(), snap({ paused: true }), 2_000);
    expect(next).toMatchObject({ state: "paused", speed: 0, canResume: true });
  });

  it("stamps the end once, and fills the bar on completion", () => {
    const done = applySnapshot(entry(), snap({ state: "completed", receivedBytes: 999 }), 3_000);
    expect(done).toMatchObject({ state: "completed", receivedBytes: 1000, speed: 0, endedAt: 3_000 });
    expect(applySnapshot(done, snap({ state: "completed" }), 9_000).endedAt).toBe(3_000);
  });

  it("keeps resumability only for interrupted downloads that support it", () => {
    expect(applySnapshot(entry(), snap({ state: "interrupted", canResume: true }), 1).canResume).toBe(true);
    expect(applySnapshot(entry(), snap({ state: "interrupted", canResume: false }), 1).canResume).toBe(false);
    expect(applySnapshot(entry(), snap({ state: "cancelled", canResume: true }), 1).canResume).toBe(false);
  });

  it("keeps a dangerous file waiting for confirmation until it is decided, unless it failed", () => {
    const waiting = entry({ dangerous: true, awaitingConfirmation: true, path: "" });
    expect(applySnapshot(waiting, snap(), 1).awaitingConfirmation).toBe(true);
    expect(applySnapshot(waiting, snap({ state: "completed" }), 1).awaitingConfirmation).toBe(true);
    expect(applySnapshot(waiting, snap({ state: "cancelled" }), 1).awaitingConfirmation).toBe(false);
    expect(applySnapshot(waiting, snap({ state: "interrupted" }), 1).awaitingConfirmation).toBe(false);
  });

  it("treats unknown or negative sizes as unknown", () => {
    expect(applySnapshot(entry(), snap({ totalBytes: -1, receivedBytes: Number.NaN }), 1)).toMatchObject({ totalBytes: 0, receivedBytes: 0 });
  });
});

describe("sanitizeEntry", () => {
  it("round-trips a finished entry", () => {
    const done = entry({ state: "completed", receivedBytes: 1000, endedAt: 5_000 });
    expect(sanitizeEntry(JSON.parse(JSON.stringify(done)))).toEqual(done);
  });

  it("brings running downloads back as interrupted, without resume", () => {
    expect(sanitizeEntry(entry({ state: "progressing", canResume: true }))).toMatchObject({ state: "interrupted", canResume: false });
    expect(sanitizeEntry(entry({ state: "paused" }))).toMatchObject({ state: "interrupted" });
  });

  it("brings unconfirmed dangerous files back as cancelled (they are deleted at startup)", () => {
    expect(sanitizeEntry(entry({ dangerous: true, awaitingConfirmation: true, state: "completed" }))).toMatchObject({
      state: "cancelled",
      awaitingConfirmation: false,
      path: "",
    });
  });

  it("rejects junk", () => {
    for (const bad of [null, 42, "x", {}, { id: "" , filename: "a" }, { id: "a" }]) expect(sanitizeEntry(bad)).toBeNull();
    expect(sanitizeEntry({ id: "a", filename: "f", state: "exploded" })).toMatchObject({ state: "interrupted", totalBytes: 0 });
  });
});

describe("DownloadList", () => {
  it("parses newest first, dropping duplicates and junk", () => {
    const list = DownloadList.parse([entry({ id: "old", startedAt: 1 }), 7, entry({ id: "new", startedAt: 9 }), entry({ id: "old" })]);
    expect(list?.map((e) => e.id)).toEqual(["new", "old"]);
    expect(DownloadList.parse({})).toBeNull();
  });

  it(`keeps at most ${MAX_DOWNLOADS} entries, dropping the oldest finished ones`, () => {
    const list = new DownloadList();
    list.add(entry({ id: "running", state: "progressing" }));
    for (let i = 0; i < MAX_DOWNLOADS; i++) list.add(entry({ id: `done-${i}`, state: "completed" }));
    expect(list.list()).toHaveLength(MAX_DOWNLOADS);
    expect(list.get("running")).toBeDefined();
    expect(list.get("done-0")).toBeUndefined();
    expect(list.add(entry({ id: "one-more", state: "completed" }))).toEqual(["done-1"]);
  });

  it("only forgets finished downloads", () => {
    const list = new DownloadList([
      entry({ id: "a", state: "progressing" }),
      entry({ id: "b", state: "completed" }),
      entry({ id: "c", state: "completed", awaitingConfirmation: true }),
      entry({ id: "d", state: "cancelled" }),
    ]);
    expect(list.remove("a")).toBe(false);
    expect(list.remove("c")).toBe(false);
    expect(list.remove("b")).toBe(true);
    expect(list.clearFinished()).toEqual(["d"]);
    expect(list.list().map((e) => e.id)).toEqual(["a", "c"]);
  });

  it("updates entries in place", () => {
    const list = new DownloadList([entry()]);
    expect(list.update("d1", (e) => ({ ...e, receivedBytes: 10 }))?.receivedBytes).toBe(10);
    expect(list.update("nope", (e) => e)).toBeUndefined();
  });

  it("never saves private windows' downloads (ADR-014)", () => {
    const list = new DownloadList([entry({ id: "old", startedAt: 1 })]);
    list.add(entry({ id: "secret", startedAt: 3 }), { owner: "private-1" });
    list.add(entry({ id: "normal", startedAt: 2 }));
    expect(list.isEphemeral("secret")).toBe(true);
    expect(list.toJSON().map((e) => e.id)).toEqual(["normal", "old"]);
  });

  it("shows each private window its own downloads only, and normal windows none of them (audit LOW-3)", () => {
    const list = new DownloadList([entry({ id: "old", startedAt: 1 })]);
    list.add(entry({ id: "secret", startedAt: 3 }), { owner: "private-1" });
    list.add(entry({ id: "other", startedAt: 4 }), { owner: "private-2" });
    list.add(entry({ id: "normal", startedAt: 2 }));
    expect(list.list(null).map((e) => e.id)).toEqual(["normal", "old"]);
    expect(list.list("private-1").map((e) => e.id)).toEqual(["secret"]);
    expect(list.list("private-2").map((e) => e.id)).toEqual(["other"]);
    expect(list.isVisibleTo("secret", null)).toBe(false);
    expect(list.isVisibleTo("secret", "private-2")).toBe(false);
    expect(list.isVisibleTo("secret", "private-1")).toBe(true);
    expect(list.isVisibleTo("normal", null)).toBe(true);
    expect(list.isVisibleTo("normal", "private-1")).toBe(false);
    expect(list.isVisibleTo("unknown", null)).toBe(false);
    // Clearing the list from one window leaves the others' entries alone.
    expect(list.clearFinished(null)).toEqual([]);
    list.update("secret", (e) => ({ ...e, state: "completed" }));
    list.update("normal", (e) => ({ ...e, state: "completed" }));
    expect(list.clearFinished("private-1")).toEqual(["secret"]);
    expect(list.list(null).map((e) => e.id)).toEqual(["normal", "old"]);
  });
});
