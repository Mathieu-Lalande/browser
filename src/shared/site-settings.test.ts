import { describe, expect, it } from "vitest";
import { buildSiteSettings, filterSiteSettings, hasSiteSettings, originHost, resetSitePatch, siteListPatch, type SiteSettingsSources } from "./site-settings";

/** "www.a.fr" → "a.fr" (enough for the tests; main uses the public suffix list). */
const siteOf = (host: string) => host.split(".").slice(-2).join(".");

const privacy: SiteSettingsSources["privacy"] = {
  javascriptBlockedSites: ["b.org"],
  mutedSites: ["a.fr"],
  cookieBannerExceptions: [],
  thirdPartyCookieExceptions: ["a.fr"],
};

describe("site settings", () => {
  it("groups every per-site decision by site", () => {
    const entries = buildSiteSettings(
      {
        permissions: [
          { origin: "https://www.a.fr", topOrigin: "https://www.a.fr", kind: "camera", decision: "allow" },
          { origin: "https://widget.c.net", topOrigin: "https://a.fr", kind: "geolocation", decision: "deny" },
        ],
        zoom: { "www.a.fr": 1.25, "browser://": 1.1 },
        shieldsOff: ["news.b.org"],
        privacy,
      },
      (host) => (host.includes("/") ? "" : siteOf(host)),
    );
    expect(entries.map((entry) => entry.site)).toEqual(["a.fr", "b.org"]);
    const [a, b] = entries;
    expect(a.permissions).toHaveLength(2);
    expect(a.zoom).toEqual([{ host: "www.a.fr", zoom: 125 }]);
    expect(a).toMatchObject({ muted: true, thirdPartyCookies: true, javascript: false });
    expect(b).toMatchObject({ shieldsOff: ["news.b.org"], javascript: true });
    expect(filterSiteSettings(entries, "WIDGET").map((entry) => entry.site)).toEqual(["a.fr"]);
    expect(filterSiteSettings(entries, "news").map((entry) => entry.site)).toEqual(["b.org"]);
    expect(hasSiteSettings({ ...b, shieldsOff: [], javascript: false })).toBe(false);
    expect(originHost("https://A.example:8443")).toBe("a.example");
  });

  it("edits the site lists", () => {
    expect(siteListPatch(privacy, "javascript", "a.fr", true)).toEqual({ javascriptBlockedSites: ["a.fr", "b.org"] });
    expect(siteListPatch(privacy, "muted", "a.fr", false)).toEqual({ mutedSites: [] });
    expect(siteListPatch(privacy, "cookieBanners", "not a site", true)).toEqual({ cookieBannerExceptions: [] });
    expect(resetSitePatch(privacy, "a.fr")).toEqual({
      javascriptBlockedSites: ["b.org"],
      mutedSites: [],
      cookieBannerExceptions: [],
      thirdPartyCookieExceptions: [],
    });
  });
});
