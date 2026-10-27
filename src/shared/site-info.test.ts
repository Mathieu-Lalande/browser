import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, sanitizeSettings } from "./settings";
import { cookieCount, filterSites, hostInSite, isSiteName, sanitizeSiteList } from "./site-info";

describe("site info helpers", () => {
  it("validates site names", () => {
    expect(isSiteName("example.com")).toBe(true);
    expect(isSiteName("127.0.0.1")).toBe(true);
    expect(isSiteName("Example.com")).toBe(false);
    expect(isSiteName("a b")).toBe(false);
    expect(isSiteName("https://example.com")).toBe(false);
    expect(isSiteName(42)).toBe(false);
  });

  it("cleans the third-party cookie exceptions", () => {
    expect(sanitizeSiteList([" B.com", "a.com", "a.com", "bad site", 3])).toEqual(["a.com", "b.com"]);
    expect(sanitizeSiteList("a.com")).toBeUndefined();
    expect(DEFAULT_SETTINGS.privacy.blockThirdPartyCookies).toBe(false);
    const settings = sanitizeSettings({ privacy: { blockThirdPartyCookies: true, thirdPartyCookieExceptions: ["x.org", "<script>"] } });
    expect(settings.privacy).toMatchObject({ blockThirdPartyCookies: true, thirdPartyCookieExceptions: ["x.org"] });
  });

  it("matches hosts to sites and filters the list", () => {
    expect(hostInSite(".mail.example.com", "example.com")).toBe(true);
    expect(hostInSite("notexample.com", "example.com")).toBe(false);
    expect(filterSites([{ site: "a.com" }, { site: "b.org" }], " B ")).toEqual([{ site: "b.org" }]);
    expect(cookieCount(1)).toBe("1 cookie");
    expect(cookieCount(2)).toBe("2 cookies");
  });
});
