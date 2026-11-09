import {
  blockedEvents,
  bannerEvent,
  cookieBannerScript,
  CookieBannerGuard,
  cosmeticCssFor,
  cosmeticScript,
  shieldBanners,
  shieldCss,
  shieldOffFor,
  shieldSiteOf,
  toggleShieldSite,
  type TabShield,
} from "./shields";

const SHIELD: TabShield = { blocker: true, sitesOff: ["off.com"], cookieBanners: true, bannerExceptions: ["keep.fr"] };

describe("shield", () => {
  it("keys sites by registrable domain and toggles them", () => {
    expect(shieldSiteOf("www.news.bbc.co.uk")).toBe("bbc.co.uk");
    expect(shieldOffFor("m.off.com", ["off.com"])).toBe(true);
    expect(shieldOffFor("notoff.com", ["off.com"])).toBe(false);
    expect(toggleShieldSite(["b.com"], "a.com", true)).toEqual(["a.com", "b.com"]);
    expect(toggleShieldSite(["a.com", "b.com"], "a.com", false)).toEqual(["b.com"]);
  });

  it("hides elements unless the shield is off", () => {
    const index = { generic: [".ad"], hosts: { "x.com": [".promo"] }, exceptions: { "y.com": [".ad"] } };
    expect(cosmeticCssFor("www.x.com", index)).toBe(".ad,.promo{display:none!important}");
    expect(cosmeticCssFor("y.com", index)).toBe("");
    expect(shieldCss(SHIELD, "off.com")).toBe("");
    expect(shieldCss({ ...SHIELD, blocker: false }, "a.com")).toBe("");
    expect(cosmeticScript(".a{}")).toContain(JSON.stringify(".a{}"));
  });

  it("runs the cookie banner agent except where the user keeps banners", () => {
    expect(shieldBanners(SHIELD, "a.com")).toBe(true);
    expect(shieldBanners(SHIELD, "www.keep.fr")).toBe(false);
    expect(shieldBanners(SHIELD, "off.com")).toBe(false);
    expect(shieldBanners({ ...SHIELD, cookieBanners: false }, "a.com")).toBe(false);
    expect(cookieBannerScript("n", "")).toBeNull();
    // Valid JavaScript with a stand-in agent.
    expect(() => new Function(cookieBannerScript("n", "function(){return Promise.resolve(null)}")!)).not.toThrow();
  });

  it("accepts one result per document, with its nonce and origin", () => {
    const guard = new CookieBannerGuard(() => "nonce1");
    expect(guard.loadEnded("https://a.com/page")).not.toBeNull();
    expect(guard.loadEnded("https://a.com/other")).toBeNull();
    const message = (nonce: string) => JSON.stringify({ type: "cookie-banner", nonce, result: { cmp: "didomi", outcome: "rejected" } });
    expect(guard.parse(message("bad"), "https://a.com/", "https://a.com/")).toBeUndefined();
    expect(guard.parse(message("nonce1"), "https://b.com/", "https://a.com/")).toBeUndefined();
    expect(guard.parse(message("nonce1"), "https://a.com/x", "https://a.com/page")).toEqual({ cmp: "didomi", outcome: "rejected" });
    expect(guard.parse(message("nonce1"), "https://a.com/x", "https://a.com/page")).toBeUndefined();
    expect(bannerEvent("www.a.com", { cmp: null, outcome: "hidden" })).toEqual({ counter: "cookieBanners", site: "a.com" });
    expect(bannerEvent("a.com", { cmp: null, outcome: "failed" })).toBeNull();
  });

  it("turns native batches into privacy events, private pages excluded", () => {
    const events = blockedEvents(
      [
        { page: "www.a.com", tracker: "stats.g.doubleclick.net", count: 3 },
        { page: "secret.com", tracker: "t.io", count: 1 },
        { page: "a.com", tracker: "x.io", count: -1 },
      ],
      new Set(["secret.com"]),
    );
    expect(events).toEqual([{ counter: "trackers", site: "a.com", tracker: "doubleclick.net", count: 3 }]);
  });
});
