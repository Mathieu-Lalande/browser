import { describe, expect, it } from "vitest";
import { GLYPH_SIZE, drawGlyph } from "./glyphs";

const alphaAt = (pixels: Buffer, x: number, y: number) => pixels[(y * GLYPH_SIZE + x) * 4 + 3];

describe("taskbar glyphs", () => {
  it("draws BGRA bitmaps of the toolbar's size", () => {
    const plus = drawGlyph("new-tab");
    expect(plus).toHaveLength(GLYPH_SIZE * GLYPH_SIZE * 4);
    expect(alphaAt(plus, 8, 8)).toBeGreaterThan(200);
    expect(alphaAt(plus, 1, 1)).toBe(0);
  });

  it("mirrors back and forward, and fills the badge's disc", () => {
    expect(alphaAt(drawGlyph("back"), 4, 8)).toBeGreaterThan(0);
    expect(alphaAt(drawGlyph("forward"), 4, 4)).toBe(0);
    const badge = drawGlyph("download", [255, 255, 255], [37, 99, 235]);
    expect(alphaAt(badge, 3, 8)).toBe(255);
    expect(alphaAt(badge, 0, 0)).toBe(0);
  });
});
