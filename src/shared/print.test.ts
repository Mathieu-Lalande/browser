import { describe, expect, it } from "vitest";
import { DEFAULT_PRINT_OPTIONS, isPrintOptions, parsePageRanges, pdfOptions, printLayout, printerOptions } from "./print";

describe("print options", () => {
  it("parses page ranges", () => {
    expect(parsePageRanges("")).toEqual([]);
    expect(parsePageRanges("1-3, 5")).toEqual([
      { from: 0, to: 2 },
      { from: 4, to: 4 },
    ]);
    expect(parsePageRanges("3-1")).toBeNull();
    expect(parsePageRanges("0")).toBeNull();
    expect(parsePageRanges("a")).toBeNull();
  });

  it("validates and converts", () => {
    expect(isPrintOptions(DEFAULT_PRINT_OPTIONS)).toBe(true);
    expect(isPrintOptions({ ...DEFAULT_PRINT_OPTIONS, scale: 500 })).toBe(false);
    expect(isPrintOptions({ ...DEFAULT_PRINT_OPTIONS, pages: "x" })).toBe(false);
    const options = { ...DEFAULT_PRINT_OPTIONS, orientation: "landscape" as const, margins: "none" as const, scale: 80, pages: "2-3" };
    expect(pdfOptions(options)).toMatchObject({ landscape: true, scale: 0.8, pageRanges: "2-3", margins: { top: 0 } });
    expect(printerOptions({ ...options, destination: "Bureau" })).toMatchObject({ deviceName: "Bureau", silent: true, pageRanges: [{ from: 1, to: 2 }] });
  });

  it("lays the dialog out inside the window", () => {
    const { card, preview, panel } = printLayout(1200, 800);
    expect(card.x + card.width).toBeLessThanOrEqual(1200);
    expect(preview.x + preview.width).toBeLessThanOrEqual(panel.x);
    expect(panel.width).toBe(300);
  });
});
