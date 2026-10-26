import { describe, expect, it } from "vitest";
import { buildPalette, type PaletteInput } from "./palette";
import type { TabState } from "./types";

const tab = (id: string, title: string, url: string, lastActiveAt = 0): TabState => ({
  id,
  url,
  title,
  favicon: null,
  isLoading: false,
  canGoBack: false,
  canGoForward: false,
  isPinned: false,
  isBookmarked: false,
  blockedCount: 0,
  shieldsEnabled: true,
  permissionRequest: null,
  interstitial: null,
  lastActiveAt,
  isAudible: false,
  isMuted: false,
  zoom: 100,
  find: null,
});

const tabs = [
  tab("a", "GitHub", "https://github.com/", 30),
  tab("b", "Wikipédia", "https://fr.wikipedia.org/", 20),
  tab("c", "Nouvel onglet", "", 10),
];

const input = (query: string, overrides: Partial<PaletteInput> = {}): PaletteInput => ({
  query,
  tabs,
  activeTabId: "a",
  suggestions: [],
  context: { activeTab: tabs[0] },
  ...overrides,
});

const keys = (query: string, overrides?: Partial<PaletteInput>) =>
  buildPalette(input(query, overrides)).map((section) => [section.id, section.items.map((item) => item.key)]);

describe("buildPalette", () => {
  it("shows recent tabs (without the active one) and all actions before typing", () => {
    const [recent, actions] = buildPalette(input(""));
    expect(recent.title).toBe("Onglets récents");
    expect(recent.items.map((item) => item.key)).toEqual(["tab:b", "tab:c"]);
    expect(actions.id).toBe("commands");
    expect(actions.items.some((item) => item.key === "command:duplicate-tab")).toBe(true);
    expect(actions.items.some((item) => item.key === "command:command-palette")).toBe(false);
  });

  it("puts the best-matching section first and the web search last", () => {
    expect(keys("dupl")).toEqual([
      ["commands", ["command:duplicate-tab"]],
      ["web", ["search"]],
    ]);
    const sections = keys("wiki");
    expect(sections[0]).toEqual(["tabs", ["tab:b"]]);
    expect(sections.at(-1)).toEqual(["web", ["search"]]);
  });

  it("offers to go to an address first", () => {
    const [go] = buildPalette(input("example.org"));
    expect(go.id).toBe("go");
    expect(go.items[0]).toMatchObject({ kind: "navigate", url: "https://example.org/", title: "Aller à example.org" });
  });

  it("highlights tab titles and URLs separately", () => {
    const [tabsSection] = buildPalette(input("wiki fr"));
    const [item] = tabsSection.items;
    expect(item.titleRanges).toEqual([[0, 4]]);
    expect(item.detailRanges).toEqual([[0, 2]]);
  });

  it("never matches one token across the title and the URL", () => {
    const notes = [tab("n", "Page notes", "http://127.0.0.1/notes")];
    expect(buildPalette(input("on", { tabs: notes })).some((section) => section.id === "tabs")).toBe(false);
    expect(buildPalette(input("not", { tabs: notes }))[0].items[0].titleRanges).toEqual([[5, 8]]);
  });

  it("finds actions by keyword and labels toggles", () => {
    expect(keys("unpin")[0]).toEqual(["commands", ["command:toggle-pin"]]);
    const pinned = { ...tabs[0], isPinned: true };
    const [actions] = buildPalette(input("épingl", { tabs: [pinned], context: { activeTab: pinned } }));
    expect(actions.items[0].title).toBe("Désépingler l'onglet");
  });

  it("lists history and bookmarks without pages already open in a tab", () => {
    const sections = buildPalette(
      input("git", {
        suggestions: [
          { kind: "bookmark", url: "https://github.com/", title: "GitHub", favicon: null },
          { kind: "history", url: "https://git-scm.com/", title: "Git", favicon: "https://git-scm.com/favicon.ico" },
        ],
      }),
    );
    const pages = sections.find((section) => section.id === "suggestions");
    expect(pages?.items).toHaveLength(1);
    expect(pages?.items[0]).toMatchObject({ kind: "history", url: "https://git-scm.com/", titleRanges: [[0, 3]] });
  });
});
