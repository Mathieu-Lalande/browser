import { describe, expect, it } from "vitest";
import {
  MAX_FAVICON_BYTES,
  MAX_FAVICON_DATA_URL_LENGTH,
  MAX_STORED_FAVICON_LENGTH,
  faviconImageType,
  isFaviconDataUrl,
  storableFavicon,
} from "./favicon";

const PNG = "data:image/png;base64,iVBORw0KGgo=";

describe("isFaviconDataUrl", () => {
  it("accepts base64 raster images", () => {
    expect(isFaviconDataUrl(PNG)).toBe(true);
    expect(isFaviconDataUrl("data:image/x-icon;base64,AAABAA==")).toBe(true);
    expect(isFaviconDataUrl("data:image/vnd.microsoft.icon;base64,AAABAA==")).toBe(true);
    expect(isFaviconDataUrl("data:image/webp;base64,UklGRg==")).toBe(true);
  });

  it("refuses remote URLs, SVG, non-images and odd encodings", () => {
    expect(isFaviconDataUrl("https://a.com/favicon.ico")).toBe(false);
    expect(isFaviconDataUrl("data:image/svg+xml;base64,PHN2Zz4=")).toBe(false);
    expect(isFaviconDataUrl("data:image/svg+xml,<svg onload=alert(1)>")).toBe(false);
    expect(isFaviconDataUrl("data:text/html;base64,PGgxPg==")).toBe(false);
    expect(isFaviconDataUrl("data:image/png,raw")).toBe(false);
    expect(isFaviconDataUrl('data:image/png;base64,AA");background:url(https://x)')).toBe(false);
  });

  it("bounds the length", () => {
    const big = `data:image/png;base64,${"A".repeat(MAX_FAVICON_DATA_URL_LENGTH)}`;
    expect(isFaviconDataUrl(big)).toBe(false);
    expect(isFaviconDataUrl(PNG, 10)).toBe(false);
    expect(MAX_FAVICON_DATA_URL_LENGTH).toBeGreaterThanOrEqual(Math.ceil(MAX_FAVICON_BYTES / 3) * 4);
  });
});

describe("storableFavicon", () => {
  it("keeps small data: favicons only (history, bookmarks, session)", () => {
    expect(storableFavicon(PNG)).toBe(PNG);
    expect(storableFavicon("https://a.com/f.ico")).toBeNull();
    expect(storableFavicon(null)).toBeNull();
    expect(storableFavicon(42)).toBeNull();
    expect(storableFavicon(`data:image/png;base64,${"A".repeat(MAX_STORED_FAVICON_LENGTH)}`)).toBeNull();
  });
});

describe("faviconImageType", () => {
  it("takes raster image types from a Content-Type header", () => {
    expect(faviconImageType("image/png")).toBe("image/png");
    expect(faviconImageType("Image/X-Icon; charset=binary")).toBe("image/x-icon");
    expect(faviconImageType("image/svg+xml")).toBeNull();
    expect(faviconImageType("text/html")).toBeNull();
    expect(faviconImageType(null)).toBeNull();
  });
});
