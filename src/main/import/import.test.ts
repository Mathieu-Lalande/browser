import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { History } from "@shared/history";
import { EMPTY_VAULT, type PasswordVault } from "@shared/passwords";
import { FIXTURE, makeChromiumUserData, makeFirefoxRoot } from "../../../tests/fixtures/import/profiles";
import { Bookmarks } from "../storage/bookmarks";
import { Favorites } from "../storage/organize";
import { ChromiumProfileReader, FirefoxProfileReader } from "./readers";
import { ImportService, type ImportTarget } from "./service";
import { browserLocations, detectSources } from "./sources";

const NOW = Date.UTC(2026, 10, 3, 12);
const dirs: string[] = [];
const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), "import-test-"));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function target(): ImportTarget & { saved: string[] } {
  const saved: string[] = [];
  return {
    saved,
    history: new History(),
    bookmarks: new Bookmarks(),
    favorites: new Favorites(),
    saveHistory: () => saved.push("history"),
    saveBookmarks: () => saved.push("bookmarks"),
    saveFavorites: () => saved.push("favorites"),
  };
}

function service(profile: ImportTarget, extra: Parameters<typeof detectSources>[1] = [], vault: { value: PasswordVault } = { value: EMPTY_VAULT }) {
  const settings: unknown[] = [];
  let ids = 0;
  const imports = new ImportService({
    profile: () => profile,
    updateSettings: (patch) => settings.push(patch),
    passwords: {
      status: () => ({ available: true, message: null, weak: false }),
      current: () => vault.value,
      write: (next) => ((vault.value = next), { ok: true }),
    },
    newPasswordId: () => `id${++ids}`,
    detect: () => detectSources([], extra),
    refreshAll: () => {},
    now: () => NOW,
  });
  return { imports, settings, vault };
}

describe("profile readers (SQLite copies)", () => {
  it("reads a Chromium profile's history, most recent first, web pages only", () => {
    const reader = new ChromiumProfileReader(join(makeChromiumUserData(tempDir(), NOW), "Default"));
    expect(reader.items).toEqual(["bookmarks", "history", "searchEngine"]);
    expect(reader.history()).toEqual([
      { url: "https://news.example.com/", title: "Actualités importées", visitCount: 5, lastVisit: NOW - 3_600_000 },
      { url: "https://example.com/", title: "Exemple", visitCount: 2, lastVisit: NOW - 86_400_000 },
    ]);
    expect(reader.searchEngine()).toBe("brave");
  });

  it("reads Firefox bookmarks (not tags) and visited places", () => {
    const root = makeFirefoxRoot(tempDir(), NOW);
    const reader = new FirefoxProfileReader(join(root, "Profiles", "abc.default-release"));
    expect(reader.bookmarks().map((bookmark) => [bookmark.url, bookmark.folder.join(" / ")])).toEqual([
      ["https://never.example/", "Barre personnelle"],
      ["https://mozilla.org/", "Barre personnelle / Lectures"],
    ]);
    expect(reader.history()).toEqual([{ url: "https://mozilla.org/", title: "Mozilla", visitCount: 3, lastVisit: NOW - 7_200_000 }]);
  });
});

describe("detection", () => {
  it("knows each OS's folders", () => {
    const windows = browserLocations({ platform: "win32", home: "C:\\Users\\a", localAppData: "L", appData: "R" });
    expect(windows.find((location) => location.browser === "edge")?.path).toContain(join("L", "Microsoft", "Edge", "User Data"));
    expect(browserLocations({ platform: "darwin", home: "/Users/a" }).find((location) => location.browser === "arc")?.path).toBe("/Users/a/Library/Application Support/Arc/StorableSidebar.json");
    expect(browserLocations({ platform: "linux", home: "/home/a" }).map((location) => location.browser)).toContain("firefox");
  });

  it("finds Chromium profiles by Local State and Firefox ones by profiles.ini", () => {
    const sources = detectSources(
      [
        { browser: "chrome", family: "chromium", path: makeChromiumUserData(tempDir(), NOW) },
        { browser: "firefox", family: "firefox", path: makeFirefoxRoot(tempDir(), NOW) },
        { browser: "edge", family: "chromium", path: join(tempDir(), "missing") },
        { browser: "arc", family: "arc", path: FIXTURE("StorableSidebar.json") },
      ],
    );
    expect(sources.map(({ source }) => [source.name, source.profiles.map((profile) => profile.name)])).toEqual([
      ["Google Chrome", ["Personnel"]],
      ["Mozilla Firefox", ["default-release"]],
      ["Arc", ["Barre latérale"]],
    ]);
  });
});

describe("ImportService", () => {
  it("imports bookmarks, history and search engine once, without duplicates", () => {
    const profile = target();
    profile.bookmarks.add({ url: "https://example.com/" }, NOW);
    profile.history.recordVisit("https://example.com/", NOW);
    const { imports, settings } = service(profile, [{ id: "test", name: "Test", browser: "chrome", family: "chromium", path: makeChromiumUserData(tempDir(), NOW) }]);
    const [source] = imports.sources();
    const progress: string[] = [];
    const summary = imports.run(source.profiles[0].id, ["bookmarks", "history", "searchEngine"], (step) => progress.push(step.step));
    expect(summary).toEqual({ ok: true, bookmarks: { added: 2, skipped: 1 }, history: { added: 1, merged: 1 }, searchEngine: "Brave Search" });
    expect(progress).toEqual(["bookmarks", "history", "searchEngine", "done"]);
    expect(settings).toEqual([{ search: { engine: "brave" } }]);
    const folders = profile.bookmarks.folderList().map((folder) => folder.name);
    expect(folders.sort()).toEqual(["Autres favoris", "Barre de favoris / Tech"]);
    // The known page kept its newer visit.
    expect(profile.history.get("https://example.com/")?.lastVisit).toBe(NOW);
    expect(profile.history.get("https://news.example.com/")?.title).toBe("Actualités importées");

    expect(imports.run(source.profiles[0].id, ["bookmarks", "history"])).toEqual({ ok: true, bookmarks: { added: 0, skipped: 3 }, history: { added: 0, merged: 2 } });
    expect(profile.bookmarks.folderList()).toHaveLength(2);
  });

  it("imports Arc favorites into the grid and pinned tabs as bookmarks", () => {
    const profile = target();
    const { imports } = service(profile, [{ id: "arc", name: "Arc", browser: "arc", family: "arc", path: FIXTURE("StorableSidebar.json") }]);
    const [source] = imports.sources();
    expect(imports.run(source.profiles[0].id, ["bookmarks", "favorites", "history"])).toEqual({ ok: true, bookmarks: { added: 2, skipped: 0 }, favorites: { added: 1 } });
    expect(profile.favorites.list().map((favorite) => favorite.url)).toEqual(["https://mail.example.com/"]);
  });

  it("refuses an unknown profile", () => {
    expect(service(target()).imports.run("nope:0", ["bookmarks"]).ok).toBe(false);
  });

  it("merges a password CSV: new accounts added, changed ones updated, same ones skipped", () => {
    const vault = {
      value: { entries: [{ id: "x", origin: "https://example.com", username: "ada", password: "old", createdAt: 1, updatedAt: 1, lastUsedAt: null }], never: [] },
    };
    const { imports } = service(target(), [], vault);
    const csv = "name,url,username,password\nx,https://example.com,ada,new\ny,https://b.example,bob,pw\nz,https://b.example,bob,pw\n";
    expect(imports.importPasswordCsv(csv)).toEqual({ ok: true, added: 1, updated: 1, skipped: 0, invalid: 0 });
    expect(vault.value.entries.map((entry) => [entry.origin, entry.username, entry.password])).toEqual([
      ["https://example.com", "ada", "new"],
      ["https://b.example", "bob", "pw"],
    ]);
    expect(imports.importPasswordCsv(csv)).toEqual({ ok: true, added: 0, updated: 0, skipped: 2, invalid: 0 });
    expect(imports.importPasswordCsv("a,b\n1,2").ok).toBe(false);
  });
});
