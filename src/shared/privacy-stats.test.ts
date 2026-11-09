import { describe, expect, it } from "vitest";
import { MAX_SITES_PER_DAY, dayKey, formatSaved, emptyStats, forgetSite, periodDays, pruneStats, recordEvent, sanitizeStats, summarizeStats } from "./privacy-stats";

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date(2026, 10, 9, 15).getTime();

describe("privacy stats", () => {
  it("counts per day, per site and per tracker, without any URL", () => {
    const data = emptyStats();
    recordEvent(data, { counter: "trackers", site: "news.fr", tracker: "ads.example" }, NOW);
    recordEvent(data, { counter: "trackers", site: "news.fr", tracker: "ads.example" }, NOW);
    recordEvent(data, { counter: "trackers", site: "blog.org", tracker: "metrics.example" }, NOW);
    recordEvent(data, { counter: "cookieBanners", site: "news.fr" }, NOW);
    recordEvent(data, { counter: "httpsUpgrades", site: "blog.org", count: 3 }, NOW - DAY);
    recordEvent(data, { counter: "thirdPartyCookies", site: "" }, NOW);
    const today = data.days[dayKey(NOW)];
    expect(today.totals).toMatchObject({ trackers: 3, cookieBanners: 1, thirdPartyCookies: 1 });
    expect(today.sites["news.fr"]).toMatchObject({ trackers: 2, cookieBanners: 1 });
    expect(today.trackers).toEqual({ "ads.example": 2, "metrics.example": 1 });
    expect(JSON.stringify(data)).not.toMatch(/https?:/);

    const summary = summarizeStats(data, NOW);
    expect(summary.daily).toHaveLength(30);
    expect(summary.daily.at(-1)!.day).toBe(dayKey(NOW));
    expect(summary.totals).toMatchObject({ trackers: 3, httpsUpgrades: 3, cookieBanners: 1 });
    expect(summary.topSites.map((site) => site.name)).toEqual(["blog.org", "news.fr"]);
    expect(summary.topTrackers[0]).toEqual({ name: "ads.example", count: 2 });
    expect(summary.savedMs).toBe(3 * 50 + 2_000);
    expect(summarizeStats(data, NOW, { site: "news.fr" }).totals).toMatchObject({ trackers: 2, cookieBanners: 1, httpsUpgrades: 0 });
  });

  it("keeps 30 days and bounds the sites per day", () => {
    const data = emptyStats();
    recordEvent(data, { counter: "trackers", site: "old.fr" }, NOW - 40 * DAY);
    recordEvent(data, { counter: "trackers", site: "new.fr" }, NOW);
    expect(pruneStats(data, NOW)).toBe(true);
    expect(Object.keys(data.days)).toEqual([dayKey(NOW)]);
    for (let index = 0; index < MAX_SITES_PER_DAY + 20; index++) recordEvent(data, { counter: "trackers", site: `s${index}.fr` }, NOW);
    expect(Object.keys(data.days[dayKey(NOW)].sites)).toHaveLength(MAX_SITES_PER_DAY);
    expect(data.days[dayKey(NOW)].totals.trackers).toBe(MAX_SITES_PER_DAY + 21);
    forgetSite(data, "new.fr");
    expect(data.days[dayKey(NOW)].sites["new.fr"]).toBeUndefined();
    expect(periodDays(NOW, 3)).toEqual(["2026-11-07", "2026-11-08", "2026-11-09"]);
    expect([formatSaved(45_000), formatSaved(720_000), formatSaved(7_500_000)]).toEqual(["45 s", "12 min", "2 h 05"]);
  });

  it("validates the stored file", () => {
    const stored = sanitizeStats({
      days: {
        "2026-11-09": { totals: { trackers: 4, cookieBanners: -1, bogus: 3 }, sites: { "a.fr": { trackers: 4 }, "<b>": { trackers: 1 } }, trackers: { "t.com": 4, "x.com": "9" } },
        yesterday: { totals: {} },
      },
    });
    expect(Object.keys(stored.days)).toEqual(["2026-11-09"]);
    expect(stored.days["2026-11-09"].totals).toMatchObject({ trackers: 4, cookieBanners: 0 });
    expect(Object.keys(stored.days["2026-11-09"].sites)).toEqual(["a.fr"]);
    expect(stored.days["2026-11-09"].trackers).toEqual({ "t.com": 4 });
    expect(sanitizeStats(null)).toEqual(emptyStats());
  });
});
