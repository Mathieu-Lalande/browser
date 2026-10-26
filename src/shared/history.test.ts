import { describe, expect, it } from "vitest";
import { History, REVISIT_MS } from "./history";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 5, 1);

describe("History", () => {
  it("records http(s) visits only", () => {
    const history = new History();
    expect(history.recordVisit("https://a.com/", NOW)).toBe(true);
    expect(history.recordVisit("about:blank", NOW)).toBe(false);
    expect(history.recordVisit("data:text/html,hi", NOW)).toBe(false);
    expect(history.recordVisit("file:///etc/passwd", NOW)).toBe(false);
    expect(history.recordVisit("browser://settings", NOW)).toBe(false);
    expect(history.size).toBe(1);
  });

  it("counts visits, but not quick repeats (reloads, redirects back)", () => {
    const history = new History();
    history.recordVisit("https://a.com/", NOW);
    history.recordVisit("https://a.com/", NOW + 1000);
    expect(history.get("https://a.com/")?.visitCount).toBe(1);
    history.recordVisit("https://a.com/", NOW + 1000 + REVISIT_MS);
    expect(history.get("https://a.com/")).toMatchObject({ visitCount: 2, lastVisit: NOW + 1000 + REVISIT_MS });
  });

  it("fills title and favicon after the visit", () => {
    const history = new History();
    history.recordVisit("https://a.com/", NOW);
    expect(history.updatePage("https://a.com/", { title: "A" })).toBe(true);
    expect(history.updatePage("https://a.com/", { title: "A" })).toBe(false);
    expect(history.updatePage("https://a.com/", { favicon: "https://a.com/f.ico" })).toBe(true);
    expect(history.updatePage("https://unknown.com/", { title: "X" })).toBe(false);
    expect(history.get("https://a.com/")).toMatchObject({ title: "A", favicon: "https://a.com/f.ico" });
  });

  it("prunes the least recently visited entries beyond the cap", () => {
    const history = new History([], 3);
    for (const [i, url] of ["https://1.com/", "https://2.com/", "https://3.com/"].entries()) history.recordVisit(url, NOW + i);
    history.recordVisit("https://1.com/", NOW + REVISIT_MS); // 1 becomes the most recent
    history.recordVisit("https://4.com/", NOW + REVISIT_MS + 1);
    expect(history.toJSON().map((entry) => entry.url)).toEqual(["https://3.com/", "https://1.com/", "https://4.com/"]);
  });

  it("searches by url and title, ranked by match quality and frecency", () => {
    const history = new History();
    history.recordVisit("https://github.com/", NOW - 1000, { title: "GitHub" });
    history.recordVisit("https://example.com/git-tutorial", NOW, { title: "Learn git" });
    history.recordVisit("https://news.com/", NOW, { title: "News" });
    expect(history.search("git", 10, NOW).map((entry) => entry.url)).toEqual([
      "https://github.com/",
      "https://example.com/git-tutorial",
    ]);
    expect(history.search("learn git", 10, NOW).map((entry) => entry.url)).toEqual(["https://example.com/git-tutorial"]);
    expect(history.search("", 10, NOW)).toEqual([]);
    expect(history.search("git", 1, NOW)).toHaveLength(1);
  });

  it("returns copies, so callers cannot mutate the history", () => {
    const history = new History();
    history.recordVisit("https://a.com/", NOW, { title: "A" });
    history.search("a", 1, NOW)[0].title = "changed";
    expect(history.get("https://a.com/")?.title).toBe("A");
  });

  it("lists top sites by frecency, one per host", () => {
    const history = new History([
      { url: "https://a.com/1", title: "", favicon: null, visitCount: 50, lastVisit: NOW - 2 * DAY },
      { url: "https://a.com/2", title: "", favicon: null, visitCount: 40, lastVisit: NOW - 2 * DAY },
      { url: "https://b.com/", title: "", favicon: null, visitCount: 2, lastVisit: NOW },
      { url: "https://old.com/", title: "", favicon: null, visitCount: 100, lastVisit: NOW - 365 * DAY },
    ]);
    expect(history.topSites(8, NOW).map((entry) => entry.url)).toEqual(["https://a.com/1", "https://b.com/", "https://old.com/"]);
    expect(history.topSites(1, NOW)).toHaveLength(1);
  });

  it("clears everything", () => {
    const history = new History();
    history.recordVisit("https://a.com/", NOW);
    history.clear();
    expect(history.size).toBe(0);
  });

  it("parses stored data, dropping invalid entries", () => {
    expect(History.parse({})).toBeNull();
    expect(
      History.parse([
        { url: "https://a.com/", title: "A", favicon: null, visitCount: 3, lastVisit: NOW },
        { url: "javascript:alert(1)", lastVisit: NOW },
        { url: "https://b.com/", lastVisit: "yesterday" },
        { url: "https://c.com/", lastVisit: NOW, visitCount: -2 },
        null,
      ]),
    ).toEqual([
      { url: "https://a.com/", title: "A", favicon: null, visitCount: 3, lastVisit: NOW },
      { url: "https://c.com/", title: "", favicon: null, visitCount: 1, lastVisit: NOW },
    ]);
  });

  it("orders loaded entries by last visit and applies the cap", () => {
    const history = new History(
      [
        { url: "https://new.com/", title: "", favicon: null, visitCount: 1, lastVisit: NOW },
        { url: "https://old.com/", title: "", favicon: null, visitCount: 1, lastVisit: NOW - DAY },
      ],
      1,
    );
    expect(history.toJSON().map((entry) => entry.url)).toEqual(["https://new.com/"]);
  });
});
