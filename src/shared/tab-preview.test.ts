import { describe, expect, it } from "vitest";
import { HoverIntent, TAB_PREVIEW, ThumbnailCache, isThumbnailUrl, previewCardBounds, previewViewBounds, thumbnailKey } from "./tab-preview";

const IMAGE = "data:image/jpeg;base64,AAAA";
const OTHER = "data:image/jpeg;base64,BBBB";

describe("ThumbnailCache", () => {
  it("keeps a thumbnail per tab and page, however old", () => {
    const cache = new ThumbnailCache({ ttlMs: 1000, maxEntries: 10 });
    cache.put("t1", "https://a.test/x#top", IMAGE, 0);
    expect(cache.get("t1", "https://a.test/x")).toBe(IMAGE);
    expect(cache.get("t1", "https://a.test/x#other")).toBe(IMAGE);
    expect(cache.get("t1", "https://a.test/y")).toBeNull();
    // Due for a new capture once expired, when the tab is on screen (still shown meanwhile).
    expect(cache.needsCapture("t1", "https://a.test/x", 999)).toBe(false);
    expect(cache.needsCapture("t1", "https://a.test/x", 1000)).toBe(true);
    expect(cache.get("t1", "https://a.test/x")).toBe(IMAGE);
    expect(cache.needsCapture("t1", "https://a.test/y", 10)).toBe(true);
    expect(cache.needsCapture("t2", "https://a.test/x", 10)).toBe(true);
  });

  it("drops a thumbnail once its tab shows another page", () => {
    const cache = new ThumbnailCache();
    cache.put("t1", "https://a.test/", IMAGE, 0);
    cache.navigated("t1", "https://a.test/#hash");
    expect(cache.get("t1", "https://a.test/")).toBe(IMAGE);
    cache.navigated("t1", "https://b.test/");
    expect(cache.size).toBe(0);
  });

  it("is bounded, least recently stored first, and forgets closed tabs", () => {
    const cache = new ThumbnailCache({ ttlMs: 1000, maxEntries: 2 });
    cache.put("t1", "https://a.test/", IMAGE, 0);
    cache.put("t2", "https://b.test/", IMAGE, 1);
    cache.put("t1", "https://a.test/", OTHER, 2);
    cache.put("t3", "https://c.test/", IMAGE, 3);
    expect(cache.get("t2", "https://b.test/")).toBeNull();
    expect(cache.get("t1", "https://a.test/")).toBe(OTHER);
    cache.retain(new Set(["t3"]));
    expect(cache.size).toBe(1);
  });

  it("only stores data: images", () => {
    const cache = new ThumbnailCache();
    cache.put("t1", "https://a.test/", "https://evil.test/x.png", 0);
    cache.put("t1", "https://a.test/", "data:text/html;base64,AAAA", 0);
    expect(cache.size).toBe(0);
    expect(isThumbnailUrl(IMAGE)).toBe(true);
    expect(thumbnailKey("https://a.test/p?q=1#h")).toBe("https://a.test/p?q=1");
  });
});

describe("previewCardBounds", () => {
  const area = { width: 1280, height: 800 };
  it("goes right of a left sidebar row, level with it", () => {
    const card = previewCardBounds({ x: 8, y: 120, width: 248, height: 36 }, area, true);
    expect(card).toEqual({ x: 264, y: 120, width: TAB_PREVIEW.width, height: TAB_PREVIEW.headerHeight + TAB_PREVIEW.thumbnailHeight });
  });
  it("goes left of a right sidebar row", () => {
    const card = previewCardBounds({ x: 1024, y: 120, width: 248, height: 36 }, area, false);
    expect(card.x + card.width + TAB_PREVIEW.gap).toBe(1024);
    expect(card.height).toBe(TAB_PREVIEW.headerHeight);
  });
  it("stays inside the window", () => {
    const card = previewCardBounds({ x: 8, y: 780, width: 248, height: 36 }, area, true);
    expect(card.y + card.height).toBeLessThanOrEqual(area.height - TAB_PREVIEW.gap);
    expect(previewViewBounds(card).width).toBe(card.width + 2 * TAB_PREVIEW.margin);
  });
});

describe("HoverIntent", () => {
  it("waits for the first card, then moves between rows at once", () => {
    const intent = new HoverIntent({ delayMs: 400, warmMs: 300 });
    expect(intent.delayFor(0)).toBe(400);
    intent.shown(400);
    expect(intent.delayFor(500)).toBe(0);
    intent.hidden(600);
    expect(intent.delayFor(700)).toBe(0);
    expect(intent.delayFor(1000)).toBe(400);
  });
  it("waits again after a scroll, drag, key or click", () => {
    const intent = new HoverIntent({ delayMs: 400, warmMs: 300 });
    intent.shown(0);
    intent.hidden(10, true);
    expect(intent.delayFor(20)).toBe(400);
    expect(intent.isShown).toBe(false);
  });
});
