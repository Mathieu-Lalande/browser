import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { getCommand } from "../commands";
import { DEFAULT_SEARCH_ENGINE, SEARCH_ENGINES } from "../url";
import { Omnibox, sharedProviders } from "./omnibox";
import { CalculatorProvider, ConversionProvider, NumberBaseProvider, TimeZoneProvider } from "./providers/answers";
import { CommandsProvider, SettingsProvider } from "./providers/commands";
import { ArchivedTabsProvider, BookmarksProvider, FavoritesProvider, HistoryProvider, RemoteTabsProvider } from "./providers/pages";
import { TabsProvider } from "./providers/tabs";
import { searchQueryOf, WebProvider } from "./providers/web";
import { SETTINGS_INDEX } from "./settings-index";
import type { OmniboxData, OmniboxTab, QueryContext } from "./types";

const NOW = Date.UTC(2026, 10, 2, 12);

const tab = (id: string, title: string, url: string, spaceId = "home", lastActiveAt = 0): OmniboxTab => ({
  id,
  title,
  url,
  favicon: null,
  lastActiveAt,
  spaceId,
  spaceName: spaceId === "home" ? "Personnel" : "Travail",
});

const data = (overrides: Partial<OmniboxData> = {}): OmniboxData => ({
  tabs: [tab("a", "GitHub", "https://github.com/", "home", 30), tab("b", "Wikipédia", "https://fr.wikipedia.org/", "home", 20), tab("c", "Jira board", "https://jira.example.com/", "work", 10)],
  activeTabId: "a",
  activeSpaceId: "home",
  favorites: [],
  bookmarks: [],
  history: [],
  remoteTabs: [],
  archived: [],
  commandContext: {},
  settings: SETTINGS_INDEX,
  engine: DEFAULT_SEARCH_ENGINE,
  now: NOW,
  ...overrides,
});

const ctx = (overrides: Partial<QueryContext> = {}): QueryContext => ({ ...data(), scope: null, ...overrides });
const keys = (rows: { key: string }[]) => rows.map((row) => row.key);

describe("TabsProvider", () => {
  const provider = new TabsProvider();

  it("finds tabs of every space, naming the other spaces", () => {
    const [jira] = provider.query("jira", ctx());
    expect(jira).toMatchObject({ key: "tab:c", section: "tabs", detail: "Travail · jira.example.com", verb: "Aller à l'onglet" });
    expect(jira.action).toEqual({ type: "tab", tabId: "c", spaceId: "work" });
    expect(provider.query("github", ctx())[0].detail).toBe("github.com");
  });

  it("lists recent tabs before typing, not the one on screen (all of them when scoped)", () => {
    expect(keys(provider.query("", ctx()))).toEqual(["tab:b", "tab:c"]);
    expect(keys(provider.query("", ctx({ scope: "tabs" })))).toEqual(["tab:a", "tab:b", "tab:c"]);
  });
});

describe("page providers", () => {
  const favorites = [{ url: "https://news.example/", title: "News", favicon: null }];
  const bookmarks = [
    { id: "1", url: "https://news.example/", title: "News", favicon: null, createdAt: 1 },
    { id: "2", url: "https://docs.example/", title: "Docs", favicon: null, createdAt: 2 },
    { id: "3", url: "https://github.com/", title: "GitHub", favicon: null, createdAt: 3 },
  ];

  it("favorites show their tab; bookmarks skip favorites and open tabs", () => {
    expect(new FavoritesProvider().query("news", ctx({ favorites }))[0].action).toEqual({ type: "favorite", url: "https://news.example/" });
    expect(keys(new BookmarksProvider().query("", ctx({ favorites, bookmarks, scope: "favorites" })))).toEqual(["bookmark:2"]);
    expect(new BookmarksProvider().query("", ctx({ bookmarks }))).toEqual([]);
  });

  it("history keeps main's order as a boost and skips pages offered elsewhere and search pages", () => {
    const history = [
      { url: "https://docs.example/", title: "Docs", favicon: null },
      { url: "https://example.org/a", title: "Page A", favicon: null },
      { url: "https://example.org/b", title: "Page B", favicon: null },
      { url: "https://duckduckgo.com/?q=page+tests", title: "page tests", favicon: null },
    ];
    const rows = new HistoryProvider().query("page", ctx({ history, bookmarks }));
    expect(keys(rows)).toEqual(["history:https://example.org/a", "history:https://example.org/b"]);
    expect(rows[0].score).toBeGreaterThan(rows[1].score);
  });

  it("remote tabs skip pages open here and duplicates; archived tabs restore", () => {
    const remoteTabs = [
      { device: "Téléphone", url: "https://github.com/", title: "GitHub" },
      { device: "Téléphone", url: "https://recipes.example/", title: "Recettes" },
      { device: "Tablette", url: "https://recipes.example/", title: "Recettes" },
    ];
    const rows = new RemoteTabsProvider().query("", ctx({ remoteTabs }));
    expect(rows.map((row) => row.detail)).toEqual(["Téléphone · recipes.example"]);
    const archived = [{ id: "x", url: "https://old.example/", title: "Old article", favicon: null, archivedAt: 1 }];
    expect(new ArchivedTabsProvider().query("old", ctx({ archived: archived as never }))[0].action).toEqual({
      type: "archived",
      archiveId: "x",
      url: "https://old.example/",
    });
  });
});

describe("CommandsProvider and SettingsProvider", () => {
  it("lists available commands with their effective shortcut, filtered by the platform", () => {
    const shortcut = (id: string) => (id === "duplicate-tab" ? ["Ctrl", "Maj", "D"] : []);
    const [first] = new CommandsProvider().query("dupli", ctx({ shortcut, commandContext: { activeTab: { url: "https://x/" } as never } }));
    expect(first).toMatchObject({ title: "Dupliquer l'onglet", shortcut: ["Ctrl", "Maj", "D"], verb: "Exécuter" });
    expect(first.action).toEqual({ type: "command", command: getCommand("duplicate-tab") });
    const none = new CommandsProvider().query("dupli", ctx({ commandFilter: (command) => command.id !== "duplicate-tab" }));
    expect(keys(none)).not.toContain("command:duplicate-tab");
  });

  it("deep-links settings rows, by label, section or keyword", () => {
    const [zoom] = new SettingsProvider().query("zoom", ctx({ scope: "settings" }));
    expect(zoom).toMatchObject({ title: "Zoom par défaut", detail: "Paramètres › Apparence", action: { type: "open", url: "browser://settings#appearance/page-zoom" } });
    expect(keys(new SettingsProvider().query("sombre", ctx()))).toContain("setting:appearance/theme");
    expect(new SettingsProvider().query("", ctx())).toEqual([]);
  });
});

describe("WebProvider", () => {
  const provider = new WebProvider();

  it("offers an address first, else a search with the chosen engine", () => {
    expect(provider.query("example.org", ctx())).toMatchObject([{ section: "go", title: "Aller à example.org", action: { url: "https://example.org/" } }]);
    const brave = SEARCH_ENGINES.find((engine) => engine.id === "brave")!;
    expect(provider.query("chats mignons", ctx({ engine: brave }))).toMatchObject([
      { section: "web", title: "Rechercher « chats mignons »", detail: "Brave Search", action: { url: "https://search.brave.com/search?q=chats%20mignons" } },
    ]);
  });

  it("suggests earlier searches that start with the text", () => {
    const history = [
      { url: "https://duckduckgo.com/?q=svelte+runes", title: "", favicon: null },
      { url: "https://duckduckgo.com/?q=svelte", title: "", favicon: null },
      { url: "https://duckduckgo.com/?q=react", title: "", favicon: null },
    ];
    const rows = provider.query("svelte", ctx({ history }));
    expect(rows.map((row) => row.title)).toEqual(["Rechercher « svelte »", "Rechercher « svelte runes »"]);
    expect(rows[1].titleRanges).toEqual([[19, 25]]);
    expect(searchQueryOf("https://duckduckgo.com/?q=a%20b&t=h", DEFAULT_SEARCH_ENGINE)).toBe("a b");
    expect(searchQueryOf("https://example.org/?q=a", DEFAULT_SEARCH_ENGINE)).toBeNull();
  });
});

describe("instant answers", () => {
  it("compute locally and copy their result", () => {
    expect(new CalculatorProvider().query("2*(3+4)")).toMatchObject([{ section: "answer", title: "14", detail: "2*(3+4) =", action: { type: "copy", text: "14" } }]);
    expect(new CalculatorProvider().query("github")).toEqual([]);
    expect(new ConversionProvider().query("1,5 km en m")[0].title).toBe("1500 m");
    expect(new TimeZoneProvider().query("heure à Tokyo", ctx())[0]).toMatchObject({ title: "21:00", icon: "clock" });
    expect(new NumberBaseProvider().query("255 en hexa")[0]).toMatchObject({ title: "FF", detail: "255 en hexadécimal" });
  });
});

describe("Omnibox", () => {
  const omnibox = new Omnibox(sharedProviders());

  it("puts the answer first and the web search last", () => {
    const result = omnibox.query("2*(3+4)", data());
    expect(result.items[0].title).toBe("14");
    expect(result.sections.at(-1)?.id).toBe("web");
  });

  it("shows recent tabs and actions before typing", () => {
    const result = omnibox.query("", data());
    expect(result.sections[0]).toMatchObject({ id: "tabs", title: "Onglets récents" });
    expect(result.sections.map((section) => section.id)).toContain("commands");
  });

  it("restricts a scoped query to its providers, from the chip or the typed prefix", () => {
    const typed = omnibox.query("@r zoom", data());
    expect(typed.scope).toBe("settings");
    expect(typed.sections.map((section) => section.id)).toEqual(["settings"]);
    expect(typed.items[0].title).toBe("Zoom par défaut");
    expect(omnibox.query("zoom", data(), "settings").items[0].title).toBe("Zoom par défaut");
    expect(omnibox.query("", data(), "tabs").items).toHaveLength(3);
  });

  it("offers matching scopes while a prefix is typed", () => {
    const result = omnibox.query("@o", data());
    expect(result.sections.map((section) => section.id)).toEqual(["scopes"]);
    expect(result.items[0]).toMatchObject({ title: "@onglets", completion: "@onglets ", action: { type: "scope", scope: "tabs" } });
  });

  it("ranks a tab of another space above history for its title", () => {
    const result = omnibox.query("jira", data({ history: [{ url: "https://jira.example.com/browse/X-1", title: "X-1 jira", favicon: null }] }));
    expect(result.items[0].key).toBe("tab:c");
  });
});

describe("settings index", () => {
  it("names anchors that exist in the settings page", () => {
    const dir = resolve(import.meta.dirname, "../../renderer/src/components/settings");
    const files = ["SettingsPage", "DataSection", "DownloadsSection", "SiteDataSection", "TranslateSection", "SyncSection"].map((name) => readFileSync(`${dir}/${name}.svelte`, "utf8")).join("\n");
    for (const entry of SETTINGS_INDEX) {
      const [section, row] = entry.anchor.split("/");
      expect(files, entry.anchor).toContain(`id="${section}"`);
      if (row) expect(files.includes(`anchor="${row}"`) || files.includes(`data-setting="${row}"`), entry.anchor).toBe(true);
    }
  });
});
