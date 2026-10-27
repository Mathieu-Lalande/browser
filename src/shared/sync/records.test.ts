import { describe, expect, it } from "vitest";
import { buildPalette, REMOTE_TABS_TITLE } from "../palette";
import { DEFAULT_SETTINGS, mergeSettings } from "../settings";
import { DEFAULT_SPACE } from "../spaces";
import type { TabState } from "../types";
import {
  bookmarkLocalId,
  clientRecord,
  historyInScope,
  mergeHistoryEntry,
  mergeSpaces,
  pickSyncedSettings,
  sanitizeSyncedBookmark,
  sanitizeSyncedClient,
  sanitizeSyncedHistory,
  sanitizeSyncedSettings,
  sanitizeSyncedSpace,
  syncedSettingsPatch,
} from "./records";

const DAY = 24 * 60 * 60 * 1000;

describe("synced records", () => {
  it("syncs theme, accent, search engine and start page, not layout nor device-only options", () => {
    const settings = mergeSettings(DEFAULT_SETTINGS, {
      appearance: { mode: "dark", accent: "#3b82f6", radius: 4 },
      layout: { sidebarWidth: 380 },
      search: { engine: "brave" },
      startPage: { greetingName: "Mathieu" },
      downloads: { folder: "/home/me/dl" },
    });
    const synced = pickSyncedSettings(settings);
    expect(synced).toMatchObject({ mode: "dark", accent: "#3b82f6", engine: "brave", startPage: { greetingName: "Mathieu" } });
    expect(JSON.stringify(synced)).not.toMatch(/sidebarWidth|radius|folder|zenMode/);
    const applied = mergeSettings(DEFAULT_SETTINGS, syncedSettingsPatch(synced));
    expect(applied.appearance.radius).toBe(DEFAULT_SETTINGS.appearance.radius);
    expect(applied.search.engine).toBe("brave");
    // Garbage from another device falls back to valid values.
    expect(sanitizeSyncedSettings({ mode: "neon", accent: "red", engine: 3, startPage: { backgroundImage: "javascript:x" } })).toEqual(
      pickSyncedSettings(DEFAULT_SETTINGS),
    );
  });

  it("merges space definitions, keeping the icon as an opaque string and never emptying the list", () => {
    const local = [{ ...DEFAULT_SPACE }, { id: "work", name: "Travail", icon: "briefcase", color: null, isolated: false }];
    const merged = mergeSpaces(
      local,
      [
        ["work", { name: "Boulot", icon: "briefcase", color: "#ff7ba9", isolated: true, position: 0 }],
        ["space-123", { name: "Lecture", icon: "book-open", color: null, isolated: false, position: 2 }],
      ],
      ["personal"],
      12,
    );
    expect(merged.map((space) => [space.id, space.name, space.icon])).toEqual([
      ["work", "Boulot", "briefcase"],
      ["space-123", "Lecture", "book-open"],
    ]);
    expect(mergeSpaces(local, [], ["personal", "work"], 12)).toHaveLength(1);
    expect(sanitizeSyncedSpace({ name: "x".repeat(100), icon: "star", color: "nope", isolated: "yes" })).toMatchObject({ color: null, isolated: false });
  });

  it("keys bookmarks by URL and refuses mismatched or non-web records", () => {
    const url = "https://example.com/a";
    expect(sanitizeSyncedBookmark({ kind: "bookmark", url, title: "A", createdAt: 5 }, bookmarkLocalId(url))).toMatchObject({ url, title: "A" });
    expect(sanitizeSyncedBookmark({ kind: "bookmark", url, title: "A" }, bookmarkLocalId("https://other.example/"))).toBeNull();
    expect(sanitizeSyncedBookmark({ kind: "bookmark", url: "javascript:alert(1)" }, "b:javascript:alert(1)")).toBeNull();
    expect(sanitizeSyncedBookmark({ kind: "folder", name: "Lectures" }, "f:abc")).toMatchObject({ kind: "folder", name: "Lectures" });
  });

  it("bounds history to 90 days and 5 000 pages, and merges visits", () => {
    const now = 1000 * DAY;
    const entries = Array.from({ length: 6000 }, (_, i) => ({ url: `https://s${i}.example/`, title: "", favicon: null, visitCount: 1, lastVisit: now - i * 1000 }));
    entries.push({ url: "https://old.example/", title: "", favicon: null, visitCount: 9, lastVisit: now - 91 * DAY });
    const scoped = historyInScope(entries, now);
    expect(scoped).toHaveLength(5000);
    expect(scoped[0].url).toBe("https://s0.example/");
    expect(scoped.some((entry) => entry.url === "https://old.example/")).toBe(false);

    const local = { url: "https://a.example/", title: "Old", favicon: "data:x", visitCount: 4, lastVisit: 10 };
    expect(mergeHistoryEntry(local, { url: local.url, title: "New", visitCount: 2, lastVisit: 20 })).toEqual({
      url: local.url,
      title: "New",
      favicon: "data:x",
      visitCount: 4,
      lastVisit: 20,
    });
    expect(sanitizeSyncedHistory({ url: "https://a.example/", visitCount: -3, lastVisit: 1 }, "https://a.example/")).toMatchObject({ visitCount: 1 });
    expect(sanitizeSyncedHistory({ url: "file:///etc/passwd", lastVisit: 1 }, "file:///etc/passwd")).toBeNull();
  });

  it("lists a device's web tabs only, deduplicated and bounded", () => {
    const record = clientRecord("PC", "desktop", [
      { url: "", title: "Accueil" },
      { url: "browser://settings", title: "Paramètres" },
      { url: "https://a.example/", title: "A" },
      { url: "https://a.example/", title: "A again" },
      ...Array.from({ length: 200 }, (_, i) => ({ url: `https://t${i}.example/`, title: "" })),
    ]);
    expect(record.tabs[0]).toEqual({ url: "https://a.example/", title: "A" });
    expect(record.tabs).toHaveLength(100);
    expect(sanitizeSyncedClient({ name: "x", kind: "toaster", tabs: [{ url: "javascript:1" }] })).toEqual({ name: "x", kind: "desktop", tabs: [] });
  });
});

describe("palette: tabs of my other devices", () => {
  const tab = (id: string, url: string): TabState =>
    ({ id, url, title: id, favicon: null, isLoading: false, lastActiveAt: 0 }) as unknown as TabState;
  const remoteTabs = [
    { device: "iPhone", url: "https://recette.example/tarte", title: "Tarte aux pommes" },
    { device: "iPhone", url: "https://open.example/", title: "Déjà ouvert" },
  ];

  it("shows them in their own section, skipping pages already open here", () => {
    const sections = buildPalette({ query: "", tabs: [tab("t", "https://open.example/")], activeTabId: "t", suggestions: [], context: {}, remoteTabs });
    const remote = sections.find((section) => section.id === "remote");
    expect(remote?.title).toBe(REMOTE_TABS_TITLE);
    expect(remote?.items.map((item) => item.title)).toEqual(["Tarte aux pommes"]);
    expect(remote?.items[0].detail).toContain("iPhone");
  });

  it("matches them by title or address while typing", () => {
    const sections = buildPalette({ query: "tarte", tabs: [], activeTabId: null, suggestions: [], context: {}, remoteTabs });
    expect(sections.find((section) => section.id === "remote")?.items).toHaveLength(1);
    expect(buildPalette({ query: "zzzz", tabs: [], activeTabId: null, suggestions: [], context: {}, remoteTabs }).some((section) => section.id === "remote")).toBe(false);
  });
});
