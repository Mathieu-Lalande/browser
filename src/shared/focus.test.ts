import { describe, expect, it } from "vitest";
import { addSiteTime, dayKey, focusBlocks, focusMinutesLeft, parseFocusSites, startFocus, summarizeSiteTime } from "./focus";

const NOW = new Date(2026, 10, 16, 12).getTime();

describe("focus mode", () => {
  it("blocks listed sites and their subdomains while a session runs", () => {
    const state = startFocus(25, NOW);
    expect(focusBlocks(state, ["youtube.com"], "https://m.youtube.com/watch", NOW + 1000)).toBe(true);
    expect(focusBlocks(state, ["youtube.com"], "https://notyoutube.com/", NOW)).toBe(false);
    expect(focusBlocks(state, ["youtube.com"], "https://youtube.com/", NOW + 26 * 60_000)).toBe(false);
    expect(focusMinutesLeft(state, NOW + 60_001)).toBe(24);
  });

  it("parses typed site lists", () => {
    expect(parseFocusSites("https://www.YouTube.com/feed, reddit.com\nnot a site; x.com x.com")).toEqual(["youtube.com", "reddit.com", "x.com"]);
  });
});

describe("time per site", () => {
  it("adds capped ticks per day and summarizes the week", () => {
    let data = addSiteTime({}, "old.example", 20_000, NOW - 40 * 86_400_000);
    data = addSiteTime(data, "www.github.com", 30_000, NOW);
    data = addSiteTime(data, "github.com", 10 * 60_000, NOW);
    data = addSiteTime(data, "news.ycombinator.com", 20_000, NOW - 86_400_000);
    expect(data[dayKey(NOW)]).toEqual({ "github.com": 90_000 });
    expect(Object.keys(data)).toHaveLength(2);
    const summary = summarizeSiteTime(data, NOW);
    expect(summary.sites.map((entry) => entry.site)).toEqual(["github.com", "news.ycombinator.com"]);
    expect(summary.days).toHaveLength(7);
    expect(summary.totalMs).toBe(110_000);
  });
});
