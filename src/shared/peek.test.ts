import { describe, expect, it } from "vitest";
import { PEEK_HEADER_HEIGHT, PEEK_INSET, isPeekAction, isPeekableUrl, peekLayout } from "./peek";

describe("peekLayout", () => {
  it("centers a card of 80% of the page area, the page below the header", () => {
    const { card, page } = peekLayout({ x: 280, y: 8, width: 1000, height: 800 });
    expect(card).toEqual({ x: 380, y: 88, width: 800, height: 640 });
    expect(page).toEqual({
      x: 380 + PEEK_INSET,
      y: 88 + PEEK_HEADER_HEIGHT,
      width: 800 - 2 * PEEK_INSET,
      height: 640 - PEEK_HEADER_HEIGHT - PEEK_INSET,
    });
  });

  it("keeps a minimum size, never larger than the area", () => {
    expect(peekLayout({ x: 0, y: 0, width: 400, height: 260 }).card).toEqual({ x: 20, y: 10, width: 360, height: 240 });
    expect(peekLayout({ x: 0, y: 0, width: 300, height: 100 }).card).toEqual({ x: 0, y: 0, width: 300, height: 100 });
    expect(peekLayout({ x: 0, y: 0, width: 0, height: 0 }).page.height).toBe(0);
  });
});

describe("peek rules", () => {
  it("only peeks what a page may open", () => {
    expect(isPeekableUrl("https://example.com/")).toBe(true);
    expect(isPeekableUrl("http://localhost:3000/a")).toBe(true);
    for (const url of ["file:///etc/passwd", "javascript:alert(1)", "data:text/html,x", "browser://settings", "app://browser/index.html"]) {
      expect(isPeekableUrl(url)).toBe(false);
    }
  });

  it("validates actions from the overlay", () => {
    expect(["open-tab", "open-split", "close"].every(isPeekAction)).toBe(true);
    expect(isPeekAction("navigate")).toBe(false);
    expect(isPeekAction(undefined)).toBe(false);
  });
});
