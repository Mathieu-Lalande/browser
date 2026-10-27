import * as fs from "node:fs";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JsonFile, flushAll, type FileSystem } from "./json-file";

interface Data {
  items: string[];
}

const parse = (data: unknown): Data | null =>
  typeof data === "object" && data !== null && Array.isArray((data as Data).items) ? (data as Data) : null;

let dir: string;
let path: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "json-file-"));
  path = join(dir, "nested", "store.json");
});
afterEach(() => {
  vi.useRealTimers();
  rmSync(dir, { recursive: true, force: true });
});

const make = (options: Partial<ConstructorParameters<typeof JsonFile<Data>>[0]> = {}) =>
  new JsonFile<Data>({ path, version: 2, parse, onError: () => {}, ...options });

describe("JsonFile", () => {
  it("returns null when the file does not exist", () => {
    expect(make().load()).toBeNull();
  });

  it("round-trips data with a version envelope, creating the directory", () => {
    expect(make().save({ items: ["a"] })).toBe(true);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ version: 2, data: { items: ["a"] } });
    expect(make().load()).toEqual({ items: ["a"] });
    // No temporary file is left behind.
    expect(readdirSync(join(dir, "nested"))).toEqual(["store.json"]);
  });

  it("passes the stored version to parse for migrations", () => {
    make({ version: 1 }).save({ items: ["old"] });
    const migrate = vi.fn((data: unknown, version: number) => (version === 1 ? { items: [...(data as Data).items, "migrated"] } : null));
    expect(make({ parse: migrate }).load()).toEqual({ items: ["old", "migrated"] });
    expect(migrate).toHaveBeenCalledWith({ items: ["old"] }, 1);
  });

  it.each([
    ["invalid JSON", "{ nope"],
    ["no envelope", JSON.stringify({ items: [] })],
    ["data rejected by parse", JSON.stringify({ version: 2, data: { items: 3 } })],
    ["a newer schema version", JSON.stringify({ version: 3, data: { items: [] } })],
  ])("backs up a corrupt file (%s) and starts fresh", (_label, content) => {
    make().save({ items: [] });
    writeFileSync(path, content);
    const store = make({ now: () => Date.UTC(2026, 0, 2, 3, 4, 5) });
    expect(store.load()).toBeNull();
    const files = readdirSync(join(dir, "nested"));
    expect(files).toEqual(["store.json.corrupt-2026-01-02T03-04-05-000Z"]);
    expect(readFileSync(join(dir, "nested", files[0]), "utf8")).toBe(content);
    // The store keeps working after that.
    store.save({ items: ["fresh"] });
    expect(make().load()).toEqual({ items: ["fresh"] });
  });

  it("debounces saves and evaluates the snapshot at write time", () => {
    vi.useFakeTimers();
    const store = make({ debounceMs: 500 });
    let items = ["a"];
    store.scheduleSave(() => ({ items }));
    vi.advanceTimersByTime(400);
    items = ["a", "b"];
    store.scheduleSave(() => ({ items }));
    vi.advanceTimersByTime(400);
    expect(make().load()).toBeNull();
    vi.advanceTimersByTime(100);
    expect(make().load()).toEqual({ items: ["a", "b"] });
  });

  it("flush writes a pending save immediately, and is a no-op otherwise", () => {
    vi.useFakeTimers();
    const store = make();
    store.flush();
    expect(make().load()).toBeNull();
    store.scheduleSave(() => ({ items: ["now"] }));
    store.flush();
    expect(make().load()).toEqual({ items: ["now"] });
  });

  it("skips writing unchanged content", () => {
    const writes = vi.fn();
    const spy: FileSystem = { ...fs, writeFileSync: (...args: Parameters<typeof fs.writeFileSync>) => (writes(), fs.writeFileSync(...args)) };
    const store = make({ fs: spy });
    store.save({ items: ["a"] });
    store.save({ items: ["a"] });
    expect(writes).toHaveBeenCalledTimes(1);
  });

  it("keeps the previous file intact when a write fails", () => {
    make().save({ items: ["safe"] });
    const onError = vi.fn();
    const failing: FileSystem = {
      ...fs,
      renameSync: () => {
        throw new Error("disk full");
      },
    };
    expect(make({ fs: failing, onError }).save({ items: ["lost"] })).toBe(false);
    expect(onError).toHaveBeenCalled();
    expect(make().load()).toEqual({ items: ["safe"] });
    expect(readdirSync(join(dir, "nested"))).toEqual(["store.json"]);
  });

  it("reports data that cannot be serialized instead of throwing (audit MEDIUM-4)", () => {
    make().save({ items: ["safe"] });
    const onError = vi.fn();
    const store = make({ onError });
    expect(store.save({ items: [10n as unknown as string] })).toBe(false);
    expect(onError).toHaveBeenCalledOnce();
    expect(make().load()).toEqual({ items: ["safe"] });
  });

  it("reports a snapshot that throws at flush time instead of throwing", () => {
    const onError = vi.fn();
    const store = make({ onError });
    store.scheduleSave(() => {
      throw new Error("broken snapshot");
    });
    expect(() => store.flush()).not.toThrow();
    expect(onError).toHaveBeenCalledOnce();
  });
});

describe("flushAll", () => {
  it("flushes every store even when one of them throws (audit MEDIUM-4)", () => {
    const flushed: string[] = [];
    const onError = vi.fn();
    const store = (name: string, fails = false) => ({
      flush: () => {
        if (fails) throw new Error(`${name} failed`);
        flushed.push(name);
      },
    });
    flushAll([store("history"), store("bookmarks", true), store("session"), store("settings", true), store("zoom")], onError);
    expect(flushed).toEqual(["history", "session", "zoom"]);
    expect(onError).toHaveBeenCalledTimes(2);
  });
});
