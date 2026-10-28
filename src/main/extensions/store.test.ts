import { describe, expect, it } from "vitest";
import { ExtensionStore, toInfo, type ExtensionRecord } from "./store";

const record = (overrides: Partial<ExtensionRecord> = {}): ExtensionRecord => ({
  id: "a".repeat(32),
  path: "/ext/a",
  managed: false,
  enabled: true,
  allowPrivate: false,
  name: "A",
  version: "1.0",
  description: "",
  manifestVersion: 3,
  icon: null,
  ...overrides,
});

describe("ExtensionStore", () => {
  it("parses stored data, dropping invalid and duplicate entries", () => {
    const b = record({ id: "b".repeat(32), path: "/ext/b", enabled: false, allowPrivate: true, icon: "data:image/png;base64,AA==" });
    const parsed = ExtensionStore.parse([
      record(),
      b,
      record({ id: "c".repeat(32) }), // same path as the first
      { ...record({ id: "z".repeat(32) }) }, // not an a–p id
      { ...record({ id: "d".repeat(32), path: "/ext/d" }), manifestVersion: 4 },
      { ...record({ id: "e".repeat(32), path: "/ext/e" }), icon: "https://example.com/icon.png" },
      "junk",
    ]);
    expect(parsed?.map((entry) => entry.id)).toEqual(["a".repeat(32), "b".repeat(32), "e".repeat(32)]);
    expect(parsed?.[1]).toMatchObject({ enabled: false, allowPrivate: true, icon: "data:image/png;base64,AA==" });
    expect(parsed?.[2].icon).toBeNull();
    expect(ExtensionStore.parse({})).toBeNull();
  });

  it("adds, updates and removes", () => {
    const store = new ExtensionStore();
    store.add(record());
    expect(() => store.add(record())).toThrow();
    expect(() => store.add(record({ id: "b".repeat(32) }))).toThrow();
    expect(store.update("a".repeat(32), { enabled: false })).toBe(true);
    expect(store.update("a".repeat(32), { enabled: false })).toBe(false);
    expect(store.update("b".repeat(32), { enabled: false })).toBe(false);
    expect(store.update("a".repeat(32), { allowPrivate: true })).toBe(true);
    expect(store.get("a".repeat(32))).toMatchObject({ enabled: false, allowPrivate: true });
    expect(ExtensionStore.parse(JSON.parse(JSON.stringify(store.toJSON())))).toEqual(store.toJSON());
    expect(store.remove("a".repeat(32))?.path).toBe("/ext/a");
    expect(store.list()).toEqual([]);
  });

  it("never exposes the path to the UI", () => {
    const info = toInfo(record(), "Erreur");
    expect(info).not.toHaveProperty("path");
    expect(info.error).toBe("Erreur");
    expect(toInfo(record())).not.toHaveProperty("error");
  });
});
