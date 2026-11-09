import { describe, expect, it } from "vitest";
import {
  allowlistRule,
  approximateSite,
  buildBlocklists,
  buildCosmeticIndex,
  buildNetworkIndex,
  buildWebKitLists,
  compileIndex,
  cosmeticCss,
  cosmeticSelectors,
  matchRequest,
  parseFilterList,
  sanitizeCosmeticIndex,
  toWebKitRule,
  urlFilter,
} from "./index";

const LIST = `[Adblock Plus 2.0]
! Title: test
||doubleclick.net^
||ads.example.com^$third-party
||cdn.example.org/ads/banner^
||tracker.io^$domain=news.com|~sports.news.com
||analytics.site.fr^$~third-party
||pixel.io^$script,image
||wild.io/*/track
@@||doubleclick.net/ok/^
||google.*/ads^
/banner-ad.
||evil.com^$redirect=noop.js
||sub.ads.net^$popup
##.ad-banner
example.com,~shop.example.com##.sponsored
example.com#@#.ad-banner
#@#.global-exception
example.com#?#div:has-text(Ad)
##+js(nobab)
##div{color:red}
example.com##.x:-abp-has(.y)
`;

describe("parseFilterList", () => {
  const parsed = parseFilterList(LIST);

  it("keeps domain-anchored rules with supported options", () => {
    const hosts = parsed.network.map((rule) => rule.host);
    expect(hosts).toEqual(["doubleclick.net", "ads.example.com", "cdn.example.org", "tracker.io", "analytics.site.fr", "pixel.io", "wild.io", "doubleclick.net"]);
    expect(parsed.network[1]).toMatchObject({ thirdParty: true, path: "", exception: false });
    expect(parsed.network[2]).toMatchObject({ path: "/ads/banner^" });
    expect(parsed.network[3]).toMatchObject({ include: ["news.com"], exclude: ["sports.news.com"] });
    expect(parsed.network[4]).toMatchObject({ thirdParty: false });
    expect(parsed.network[5].types).toEqual(["script", "image"]);
    expect(parsed.network[7]).toMatchObject({ exception: true, path: "/ok/^" });
  });

  it("keeps plain element hiding and its exceptions, skips the rest", () => {
    expect(parsed.cosmetic).toEqual([
      { selector: ".ad-banner", exception: false },
      { selector: ".sponsored", include: ["example.com"], exclude: ["shop.example.com"], exception: false },
      { selector: ".ad-banner", include: ["example.com"], exception: true },
    ]);
    // google.*, /banner-ad., redirect, popup, #@# without domain, #?#, +js, braces, -abp-.
    expect(parsed.skipped).toBe(9);
  });
});

describe("Android index", () => {
  const parsed = parseFilterList(LIST);
  const index = buildNetworkIndex(parsed.network);
  const compiled = compileIndex(index);
  const blocked = (url: string, page: string) => {
    const request = new URL(url);
    return matchRequest(compiled, { host: request.hostname, path: request.pathname + request.search, pageHost: page }) !== null;
  };

  it("drops typed rules and wildcard paths, omits default fields", () => {
    expect(index.block.map((entry) => entry[0])).not.toContain("pixel.io");
    expect(index.block.map((entry) => entry[0])).not.toContain("wild.io");
    expect(index.block[0]).toEqual(["doubleclick.net"]);
    expect(index.block[1]).toEqual(["ads.example.com", "", 1]);
    expect(index.allow).toEqual([["doubleclick.net", "/ok/"]]);
  });

  it("matches hosts, subdomains, paths, party and page domains; exceptions win", () => {
    expect(blocked("https://doubleclick.net/x.js", "a.com")).toBe(true);
    expect(blocked("https://stats.g.doubleclick.net/x.js", "a.com")).toBe(true);
    expect(blocked("https://notdoubleclick.net/x.js", "a.com")).toBe(false);
    expect(blocked("https://doubleclick.net/ok/x.js", "a.com")).toBe(false);
    expect(blocked("https://ads.example.com/x", "news.com")).toBe(true);
    expect(blocked("https://ads.example.com/x", "www.example.com")).toBe(false);
    expect(blocked("https://cdn.example.org/ads/banner.png", "a.com")).toBe(true);
    expect(blocked("https://cdn.example.org/img/banner.png", "a.com")).toBe(false);
    expect(blocked("https://tracker.io/t", "www.news.com")).toBe(true);
    expect(blocked("https://tracker.io/t", "sports.news.com")).toBe(false);
    expect(blocked("https://tracker.io/t", "other.com")).toBe(false);
    expect(blocked("https://analytics.site.fr/t", "www.site.fr")).toBe(true);
    expect(blocked("https://analytics.site.fr/t", "other.fr")).toBe(false);
  });

  it("approximates sites without the public suffix list", () => {
    expect(approximateSite("a.b.example.com")).toBe("example.com");
    expect(approximateSite("www.bbc.co.uk")).toBe("bbc.co.uk");
    expect(approximateSite("192.168.1.10")).toBe("192.168.1.10");
    expect(approximateSite("localhost")).toBe("localhost");
  });
});

describe("WebKit rules", () => {
  it("anchors on the host and its subdomains", () => {
    const filter = new RegExp(urlFilter("doubleclick.net", ""));
    expect(filter.test("https://doubleclick.net/x")).toBe(true);
    expect(filter.test("https://ad.doubleclick.net/x")).toBe(true);
    expect(filter.test("https://notdoubleclick.net/x")).toBe(false);
    expect(filter.test("https://doubleclick.net.evil.com/x")).toBe(false);
    const path = new RegExp(urlFilter("wild.io", "/*/track"));
    expect(path.test("https://wild.io/a/b/track?x")).toBe(true);
    expect(urlFilter("a.io", "/x^y|")).toBe("^[^:]+://+([^:/]+\\.)?a\\.io/x[/:?&=]y$");
  });

  it("converts options, and refuses mixed domain lists", () => {
    const [, third, , tracker, first, typed] = parseFilterList(LIST).network;
    expect(toWebKitRule(third)?.trigger["load-type"]).toEqual(["third-party"]);
    expect(toWebKitRule(first)?.trigger["load-type"]).toEqual(["first-party"]);
    expect(toWebKitRule(typed)?.trigger["resource-type"]).toEqual(["script", "image"]);
    expect(toWebKitRule(tracker)).toBeNull();
    expect(toWebKitRule({ host: "t.io", path: "", include: ["a.com"], exception: false })?.trigger["if-domain"]).toEqual(["*a.com"]);
  });

  it("splits lists and repeats the exceptions after each chunk", () => {
    const rules = Array.from({ length: 7 }, (_, index) => ({ host: `h${index}.com`, path: "", exception: false }));
    const lists = buildWebKitLists([...rules, { host: "h1.com", path: "/ok", exception: true }], 4);
    expect(lists.map((list) => list.length)).toEqual([3, 3, 3, 2]); // 2 blocking + 1 exception + 1 free slot (allowlist)
    for (const list of lists) expect(list[list.length - 1].action.type).toBe("ignore-previous-rules");
  });

  it("builds the per-site allowlist rule", () => {
    expect(allowlistRule([])).toBeNull();
    expect(allowlistRule(["a.com", "bad site"])).toEqual({ trigger: { "url-filter": ".*", "if-domain": ["*a.com"] }, action: { type: "ignore-previous-rules" } });
  });
});

describe("cosmetics", () => {
  const index = buildCosmeticIndex(parseFilterList(LIST).cosmetic);

  it("applies generic and site selectors minus exceptions", () => {
    expect(cosmeticSelectors(index, "news.com")).toEqual([".ad-banner"]);
    expect(cosmeticSelectors(index, "www.example.com")).toEqual([".sponsored"]);
    expect(cosmeticSelectors(index, "shop.example.com")).toEqual([]);
  });

  it("caps, groups and re-checks selectors", () => {
    const capped = buildCosmeticIndex(parseFilterList("##.a\n##.b\n##.c\nx.com##.d\nx.com##.e").cosmetic, { generic: 2, specific: 1 });
    expect(capped.generic).toEqual([".a", ".b"]);
    expect(capped.hosts).toEqual({ "x.com": [".d"] });
    expect(cosmeticCss([".a", ".b", "x{}", ".c"], 2)).toBe(".a,.b{display:none!important}\n.c{display:none!important}");
    expect(sanitizeCosmeticIndex({ generic: [".a", 3], hosts: { "x.com": [".b"] } })).toEqual({ version: 1, generic: [".a"], hosts: { "x.com": [".b"] }, exceptions: {} });
  });
});

describe("buildBlocklists", () => {
  it("merges lists without duplicates", () => {
    const build = buildBlocklists(["||a.com^\n##.ad", "||a.com^\n||b.com^"]);
    expect(build.stats.network).toBe(2);
    expect(build.android.block).toEqual([["a.com"], ["b.com"]]);
    expect(build.webkit).toHaveLength(1);
    expect(build.webkit[0]).toHaveLength(2);
    expect(build.cosmetic.generic).toEqual([".ad"]);
  });
});
