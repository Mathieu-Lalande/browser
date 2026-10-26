import { describe, expect, it } from "vitest";
import { frecency, matchScore, mergeSuggestions, rankHistory, tokenize, topSites } from "./search";
import type { Bookmark, HistoryEntry } from "./types";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 5, 1);

const entry = (url: string, title = "", visitCount = 1, lastVisit = NOW): HistoryEntry => ({
  url,
  title,
  favicon: null,
  visitCount,
  lastVisit,
});
const bookmark = (url: string, title: string, createdAt = NOW): Bookmark => ({ id: url, url, title, favicon: null, createdAt });

describe("tokenize", () => {
  it("lower-cases and splits on whitespace", () => {
    expect(tokenize("  Hello   World ")).toEqual(["hello", "world"]);
    expect(tokenize("   ")).toEqual([]);
  });
});

describe("matchScore", () => {
  const score = (query: string, url: string, title = "") => matchScore(tokenize(query), url, title);

  it("prefers domain prefixes, then word starts, then substrings", () => {
    expect(score("git", "https://www.github.com/")).toBe(4);
    expect(score("hub", "https://example.com/", "Docker Hub")).toBe(2);
    expect(score("hub", "https://www.github.com/")).toBe(1);
    expect(score("xyz", "https://github.com/")).toBe(0);
  });

  it("requires every token and averages their quality", () => {
    expect(score("git docs", "https://github.com/docs")).toBe(3);
    expect(score("git nope", "https://github.com/docs")).toBe(0);
    expect(score("", "https://github.com/")).toBe(0);
  });

  it("does not match the scheme", () => {
    expect(score("https", "https://a.com/")).toBe(0);
  });

  it("is case-insensitive and handles accents in titles", () => {
    expect(score("ÉTÉ", "https://a.com/", "Recettes d'été")).toBe(2);
  });
});

describe("frecency", () => {
  it("grows with visits and decays with age", () => {
    expect(frecency(1, NOW, NOW)).toBe(1);
    expect(frecency(10, NOW, NOW)).toBeGreaterThan(frecency(2, NOW, NOW));
    expect(frecency(1, NOW - 14 * DAY, NOW)).toBeCloseTo(0.5);
    expect(frecency(1, NOW + DAY, NOW)).toBe(1);
  });
});

describe("rankHistory", () => {
  it("ranks by match quality × frecency", () => {
    const entries = [
      entry("https://example.com/github-tips", "Tips", 1),
      entry("https://github.com/", "GitHub", 1, NOW - 60 * DAY),
      entry("https://gitlab.com/", "GitLab", 20),
    ];
    expect(rankHistory(entries, "git", 10, NOW).map((e) => e.url)).toEqual([
      "https://gitlab.com/",
      "https://example.com/github-tips",
      "https://github.com/",
    ]);
  });

  it("breaks ties by recency and honours the limit", () => {
    const entries = [entry("https://a.com/1", "", 1, NOW - DAY), entry("https://a.com/2", "", 1, NOW - DAY)];
    entries[1].lastVisit += 1;
    expect(rankHistory(entries, "a.com", 1, NOW).map((e) => e.url)).toEqual(["https://a.com/2"]);
    expect(rankHistory(entries, "a.com", 0, NOW)).toEqual([]);
  });
});

describe("topSites", () => {
  it("keeps the best entry per host", () => {
    const entries = [entry("https://www.a.com/x", "", 5), entry("https://a.com/", "", 1), entry("https://b.com/", "", 2)];
    expect(topSites(entries, 8, NOW).map((e) => e.url)).toEqual(["https://www.a.com/x", "https://b.com/"]);
  });
});

describe("mergeSuggestions", () => {
  it("puts matching bookmarks first and removes duplicates", () => {
    const history = [entry("https://github.com/", "GitHub"), entry("https://git-scm.com/", "Git")];
    const bookmarks = [bookmark("https://git-scm.com/", "Git docs"), bookmark("https://news.com/", "News")];
    expect(mergeSuggestions("git", history, bookmarks, 6)).toEqual([
      { kind: "bookmark", url: "https://git-scm.com/", title: "Git docs", favicon: null },
      { kind: "history", url: "https://github.com/", title: "GitHub", favicon: null },
    ]);
  });

  it("limits bookmarks so history stays visible, and honours the total limit", () => {
    const bookmarks = ["1", "2", "3", "4", "5"].map((n) => bookmark(`https://a${n}.com/`, `A ${n}`));
    const history = [entry("https://a-history.com/")];
    const result = mergeSuggestions("a", history, bookmarks, 6);
    expect(result.filter((s) => s.kind === "bookmark")).toHaveLength(3);
    expect(result.at(-1)?.url).toBe("https://a-history.com/");
    expect(mergeSuggestions("a", history, bookmarks, 2)).toHaveLength(2);
    expect(mergeSuggestions(" ", history, bookmarks, 6)).toEqual([]);
  });
});
