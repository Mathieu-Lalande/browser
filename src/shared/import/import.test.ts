import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseArcSidebar } from "./arc";
import { chromiumSearchEngine, chromiumTime, parseChromiumBookmarks, parseChromiumProfiles, searchEngineForUrl } from "./chromium";
import { firefoxTime, parseProfilesIni } from "./firefox";
import { parseCsv, parsePasswordCsv } from "./passwords-csv";
import { folderLabel } from "./types";

const fixture = (name: string) => readFileSync(join(import.meta.dirname, "../../../tests/fixtures/import", name), "utf8");

describe("Chromium files", () => {
  it("converts Chromium timestamps (µs since 1601)", () => {
    expect(chromiumTime("11644473600000000")).toBe(0);
    expect(chromiumTime(11_644_473_600_000_000 + 1_000_000)).toBe(1000);
    expect(chromiumTime(11_644_473_600_000_000n + 2_000_000n)).toBe(2000);
    expect(chromiumTime("nope")).toBe(0);
  });

  it("reads every web bookmark with its folder path, skipping bookmarklets", () => {
    const bookmarks = parseChromiumBookmarks(JSON.parse(fixture("Bookmarks")));
    expect(bookmarks.map((bookmark) => [bookmark.url, bookmark.title, folderLabel(bookmark.folder)])).toEqual([
      ["https://example.com/", "Exemple", "Barre de favoris"],
      ["https://developer.mozilla.org/", "MDN", "Barre de favoris / Tech"],
      ["https://fr.wikipedia.org/", "Wikipédia", "Autres favoris"],
    ]);
    expect(bookmarks[0].addedAt).toBe(chromiumTime("13350000000000000"));
    expect(bookmarks[2].addedAt).toBe(0);
  });

  it("survives malformed files", () => {
    for (const bad of [null, 42, "x", { roots: [] }, { roots: { bookmark_bar: { children: [null, { type: "url", url: 5 }] } } }]) {
      expect(parseChromiumBookmarks(bad)).toEqual([]);
    }
  });

  it("lists profile names from Local State, never paths", () => {
    const profiles = parseChromiumProfiles({ profile: { info_cache: { Default: { name: "Perso" }, "Profile 2": {}, "../evil": { name: "x" } } } });
    expect([...profiles]).toEqual([
      ["Default", "Perso"],
      ["Profile 2", "Profile 2"],
    ]);
  });

  it("recognizes the default search engine by its site", () => {
    expect(chromiumSearchEngine({ default_search_provider_data: { template_url_data: { url: "https://duckduckgo.com/?q={searchTerms}" } } })).toBe("duckduckgo");
    expect(searchEngineForUrl("{google:baseURL}search?q={searchTerms}")).toBeNull();
    expect(searchEngineForUrl("https://www.google.com/search?q={searchTerms}")).toBe("google");
    expect(searchEngineForUrl("https://www.bing.com/search?q={searchTerms}")).toBeNull();
    expect(chromiumSearchEngine({})).toBeNull();
  });
});

describe("Firefox files", () => {
  it("lists profiles from profiles.ini, the default one first", () => {
    const ini = "[General]\nStartWithLastProfile=1\n\n[Profile1]\nName=other\nIsRelative=0\nPath=/abs/other\n\n[Profile0]\nName=default-release\nIsRelative=1\nPath=Profiles/x.default\nDefault=1\n\n[Install4F96D1932A9F858E]\nDefault=Profiles/x.default\n";
    expect(parseProfilesIni(ini)).toEqual([
      { name: "default-release", path: "Profiles/x.default", relative: true, isDefault: true },
      { name: "other", path: "/abs/other", relative: false, isDefault: false },
    ]);
  });

  it("converts Firefox timestamps (µs since 1970)", () => {
    expect(firefoxTime(1_700_000_000_000_000)).toBe(1_700_000_000_000);
    expect(firefoxTime(null)).toBe(0);
  });
});

describe("password CSV", () => {
  it("parses quoted cells, escaped quotes and line breaks", () => {
    expect(parseCsv('﻿a,"b,c","d ""e"""\r\n"f\ng",h\n')).toEqual([
      ["a", "b,c", 'd "e"'],
      ["f\ng", "h"],
    ]);
  });

  it("reads Chrome's export", () => {
    const csv = parsePasswordCsv(fixture("chrome-passwords.csv"));
    expect(csv.entries).toEqual([
      { origin: "https://example.com", username: "ada", password: "s3cr,et" },
      { origin: "https://accounts.example.org", username: "", password: "only-password" },
      { origin: "https://example.com", username: "grace", password: "multi\nline" },
    ]);
    expect(csv.invalid).toBe(1);
  });

  it("reads Firefox's export, without its own accounts", () => {
    const csv = parsePasswordCsv(fixture("firefox-passwords.csv"));
    expect(csv.entries).toEqual([
      { origin: "https://example.com", username: "ada", password: "firefox-pw" },
      { origin: "http://intranet.local:8080", username: "bob", password: "pw2" },
    ]);
    expect(csv.invalid).toBe(1);
  });

  it("reads this browser's own export back (defused cells)", () => {
    const csv = parsePasswordCsv('name,url,username,password\r\n"x","https://a.example","\'=cmd","=pw"\r\n');
    expect(csv.entries).toEqual([{ origin: "https://a.example", username: "=cmd", password: "=pw" }]);
  });

  it("refuses a file without the needed columns", () => {
    expect(parsePasswordCsv("title,notes\nx,y\n").error).toMatch(/colonnes/);
    expect(parsePasswordCsv("").error).toBeDefined();
  });
});

describe("Arc sidebar", () => {
  it("files pinned tabs under their space and folders, favorites apart", () => {
    const sidebar = parseArcSidebar(JSON.parse(fixture("StorableSidebar.json")));
    expect(sidebar.spaces).toEqual([{ title: "Travail", pinned: 2 }]);
    expect(sidebar.bookmarks.map((bookmark) => [bookmark.url, bookmark.title, folderLabel(bookmark.folder)])).toEqual([
      ["https://board.example.com/", "Tableau", "Arc / Travail"],
      ["https://docs.example.com/", "Docs Example", "Arc / Travail / Docs"],
    ]);
    expect(sidebar.favorites).toEqual([{ url: "https://mail.example.com/", title: "Mail" }]);
  });

  it("returns nothing for an unknown layout", () => {
    expect(parseArcSidebar({ sidebar: { containers: [{}] } })).toEqual({ spaces: [], bookmarks: [], favorites: [] });
    expect(parseArcSidebar(null).bookmarks).toEqual([]);
  });
});
