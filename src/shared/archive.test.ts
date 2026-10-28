import { describe, expect, it } from "vitest";
import { MAX_ARCHIVED, addArchived, archiveBlocker, removeArchived, sanitizeArchive, searchArchive, tabsToArchive, type ArchiveCandidate, type ArchivedTab } from "./archive";
import { DEFAULT_SETTINGS, mergeSettings, sanitizeSettings, tabArchiveDelayMs } from "./settings";

const NOW = 100 * 24 * 3600_000;
const DAY = 24 * 3600_000;
const week = { now: NOW, idleMs: 7 * DAY };

const tab = (overrides: Partial<ArchiveCandidate> = {}): ArchiveCandidate => ({
  id: "t",
  url: "https://example.com/",
  shown: false,
  pinned: false,
  audible: false,
  inSplit: false,
  favorite: false,
  lastSeenAt: NOW - 8 * DAY,
  ...overrides,
});

const entry = (id: string, url: string, archivedAt: number, title = url): ArchivedTab => ({ id, url, title, favicon: null, spaceId: null, archivedAt });

describe("archive policy", () => {
  it("archives web pages left alone longer than the delay", () => {
    expect(archiveBlocker(tab(), week)).toBeNull();
    expect(archiveBlocker(tab({ lastSeenAt: NOW - 6 * DAY }), week)).toBe("recent");
    // No known date (0): never archived on a guess.
    expect(archiveBlocker(tab({ lastSeenAt: 0 }), week)).toBe("recent");
  });

  it("never archives pinned, favorite, audible, split or shown tabs, nor start/internal pages", () => {
    expect(archiveBlocker(tab({ pinned: true }), week)).toBe("pinned");
    expect(archiveBlocker(tab({ favorite: true }), week)).toBe("favorite");
    expect(archiveBlocker(tab({ audible: true }), week)).toBe("audible");
    expect(archiveBlocker(tab({ inSplit: true }), week)).toBe("split");
    expect(archiveBlocker(tab({ shown: true }), week)).toBe("shown");
    expect(archiveBlocker(tab({ url: "" }), week)).toBe("not-web");
    expect(archiveBlocker(tab({ url: "browser://settings" }), week)).toBe("not-web");
  });

  it("lists eligible tabs, oldest first", () => {
    const tabs = [tab({ id: "a", lastSeenAt: NOW - 8 * DAY }), tab({ id: "pinned", pinned: true }), tab({ id: "b", lastSeenAt: NOW - 20 * DAY })];
    expect(tabsToArchive(tabs, week)).toEqual(["b", "a"]);
  });

  it("follows the setting (7 days by default, never on request)", () => {
    expect(DEFAULT_SETTINGS.behavior.archiveTabsAfter).toBe("7d");
    expect(tabArchiveDelayMs(DEFAULT_SETTINGS)).toBe(7 * DAY);
    expect(tabArchiveDelayMs(mergeSettings(DEFAULT_SETTINGS, { behavior: { archiveTabsAfter: "12h" } }))).toBe(12 * 3600_000);
    expect(tabArchiveDelayMs(mergeSettings(DEFAULT_SETTINGS, { behavior: { archiveTabsAfter: "never" } }))).toBeNull();
    expect(sanitizeSettings({ behavior: { archiveTabsAfter: "1y" } }).behavior.archiveTabsAfter).toBe("7d");
  });
});

describe("archive list", () => {
  it("keeps the newest entry per URL, newest first, bounded", () => {
    const list = addArchived([entry("1", "https://a.com/", 1)], [entry("2", "https://a.com/", 5), entry("3", "https://b.com/", 3)]);
    expect(list.map((e) => e.id)).toEqual(["2", "3"]);
    const many = Array.from({ length: MAX_ARCHIVED + 5 }, (_, i) => entry(`e${i}`, `https://s${i}.com/`, i));
    expect(addArchived([], many)).toHaveLength(MAX_ARCHIVED);
    expect(removeArchived(list, "2").map((e) => e.id)).toEqual(["3"]);
  });

  it("searches titles and addresses, ignoring case and accents", () => {
    const list = [entry("1", "https://cuisine.fr/", 2, "Recette de crêpes"), entry("2", "https://docs.dev/", 1, "Documentation")];
    expect(searchArchive(list, "CREPES").map((e) => e.id)).toEqual(["1"]);
    expect(searchArchive(list, "docs documentation").map((e) => e.id)).toEqual(["2"]);
    expect(searchArchive(list, "  ")).toHaveLength(2);
  });

  it("sanitizes stored archives", () => {
    expect(
      sanitizeArchive([{ id: "x", url: "https://a.com/", archivedAt: 1, spaceId: "bad id" }, { id: "y", url: "javascript:1" }, { id: "z", url: "https://a.com/" }]),
    ).toEqual([{ id: "x", url: "https://a.com/", title: "a.com", favicon: null, spaceId: null, archivedAt: 1 }]);
  });
});
