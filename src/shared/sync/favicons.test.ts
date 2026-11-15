import { describe, expect, it } from "vitest";
import {
  MAX_SITE_ICONS,
  applySiteIcons,
  collectSiteIcons,
  faviconOrigin,
  fillFavicons,
  isSyncableFavicon,
  sanitizeSiteIcons,
  sanitizeSyncedFavicon,
  siteIconFor,
  siteIconRecords,
} from "./favicons";

/** A PNG data URL of `bytes` bytes (signature first). */
const png = (bytes: number) => {
  const data = Buffer.alloc(bytes, 7);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(data);
  return `data:image/png;base64,${data.toString("base64")}`;
};
const small = png(300);

describe("synced site icons (ADR-057)", () => {
  it("only lets small PNGs travel", () => {
    expect(isSyncableFavicon(small)).toBe(true);
    expect(isSyncableFavicon(png(4096))).toBe(true);
    expect(isSyncableFavicon(png(4097))).toBe(false);
    expect(isSyncableFavicon("data:image/svg+xml;base64,PHN2Zz4=")).toBe(false);
    expect(isSyncableFavicon(`data:image/png;base64,${Buffer.from("GIF89a....").toString("base64")}`)).toBe(false);
    expect(isSyncableFavicon(`${small}"><script>`)).toBe(false);
  });

  it("keys records by http(s) origin and validates them", () => {
    expect(faviconOrigin("https://www.example.com/a?b")).toBe("https://www.example.com");
    expect(faviconOrigin("http://localhost:8080/")).toBe("http://localhost:8080");
    expect(faviconOrigin("file:///etc/passwd")).toBeNull();
    expect(sanitizeSyncedFavicon({ icon: small }, "https://example.com")).toEqual({ icon: small });
    expect(sanitizeSyncedFavicon({ icon: small }, "https://example.com/page")).toBeNull();
    expect(sanitizeSyncedFavicon({ icon: png(5000) }, "https://example.com")).toBeNull();
  });

  it("collects the device's own icons without overwriting one it has (no ping-pong)", () => {
    const store = collectSiteIcons({}, [{ url: "https://a.example/x", favicon: small }, { url: "https://b.example/", favicon: null }], 10);
    expect(Object.keys(store)).toEqual(["https://a.example"]);
    const other = png(200);
    expect(collectSiteIcons(store, [{ url: "https://a.example/y", favicon: other }], 20)).toBe(store);
    // A non-PNG icon goes through the normalizer (the desktop resizes it to a small PNG).
    const normalized = collectSiteIcons(store, [{ url: "https://c.example/", favicon: "data:image/x-icon;base64,AAA=" }], 30, () => other);
    expect(normalized["https://c.example"]?.icon).toBe(other);
    expect([...siteIconRecords(normalized).keys()]).toEqual(["https://a.example", "https://c.example"]);
  });

  it("applies other devices' icons (theirs replaces ours), removes deleted ones, stays bounded", () => {
    const mine = png(200);
    const store = { "https://a.example": { icon: mine, at: 1 }, "https://gone.example": { icon: mine, at: 1 } };
    const next = applySiteIcons(store, [{ id: "https://a.example", data: { icon: small } }], ["https://gone.example"], 5);
    expect(next).toEqual({ "https://a.example": { icon: small, at: 5 } });
    const many = Object.fromEntries(Array.from({ length: MAX_SITE_ICONS + 10 }, (_, i) => [`https://s${i}.example`, { icon: small, at: i }]));
    const bounded = sanitizeSiteIcons(many);
    expect(Object.keys(bounded)).toHaveLength(MAX_SITE_ICONS);
    expect(bounded["https://s0.example"]).toBeUndefined();
    expect(sanitizeSiteIcons({ "https://x.example": { icon: "javascript:1" } })).toEqual({});
  });

  it("fills bookmarks without an icon, and those whose icon another device replaced", () => {
    const store = { "https://a.example": { icon: small, at: 1 } };
    const old = png(100);
    const list = [
      { url: "https://a.example/1", favicon: null },
      { url: "https://a.example/2", favicon: old },
      { url: "https://a.example/3", favicon: png(120) },
      { url: "https://b.example/", favicon: null },
    ];
    const filled = fillFavicons(list, store, new Map([["https://a.example", old]]));
    expect(filled.map((item) => item.favicon)).toEqual([small, small, list[2]!.favicon, null]);
    const unchanged = [{ url: "https://b.example/", favicon: null }];
    expect(fillFavicons(unchanged, store)).toBe(unchanged);
    expect(siteIconFor(store, "https://a.example/deep")).toBe(small);
  });
});
