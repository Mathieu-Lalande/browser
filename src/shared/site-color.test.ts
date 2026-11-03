import { describe, expect, it } from "vitest";
import { dominantColor, isAccentWorthy, mixHex, normalizeThemeColor, siteAccent } from "./site-color";
import { accentVariables, contrastRatio, derivePalette, parseHex, toOklch } from "./theme";

/** RGBA bytes of `count` pixels of each color. */
function pixels(...runs: [color: [number, number, number, number], count: number][]): Uint8ClampedArray {
  const out: number[] = [];
  for (const [color, count] of runs) for (let i = 0; i < count; i++) out.push(...color);
  return new Uint8ClampedArray(out);
}

describe("normalizeThemeColor", () => {
  it("accepts hex and rgb() forms", () => {
    expect(normalizeThemeColor("#E11D48")).toBe("#e11d48");
    expect(normalizeThemeColor("#fff")).toBe("#ffffff");
    expect(normalizeThemeColor("rgb(225, 29, 72)")).toBe("#e11d48");
    expect(normalizeThemeColor("rgba(225 29 72 / 0.5)")).toBe("#e11d48");
  });
  it("refuses anything else", () => {
    for (const value of [null, 42, "red", "rgb(300, 0, 0)", "url(x)", "#12345", "#".repeat(80)]) expect(normalizeThemeColor(value)).toBeNull();
  });
});

describe("isAccentWorthy", () => {
  it("rejects greys, white and black", () => {
    for (const hex of ["#ffffff", "#000000", "#808080", "#f5f5f7", "#1a1a1a"]) expect(isAccentWorthy(hex)).toBe(false);
  });
  it("accepts brand colors", () => {
    for (const hex of ["#e11d48", "#1877f2", "#ff9900", "#00a86b"]) expect(isAccentWorthy(hex)).toBe(true);
  });
});

describe("dominantColor", () => {
  it("ignores transparent, grey and white pixels", () => {
    const image = pixels([[255, 255, 255, 255], 200], [[0, 0, 0, 0], 100], [[128, 128, 128, 255], 50], [[24, 119, 242, 255], 30]);
    expect(dominantColor(image)).toBe("#1877f2");
  });
  it("picks the heaviest hue, chroma-weighted", () => {
    const image = pixels([[225, 29, 72, 255], 40], [[34, 197, 94, 255], 20]);
    expect(dominantColor(image)).toBe("#e11d48");
  });
  it("averages a hue family", () => {
    const color = dominantColor(pixels([[220, 30, 70, 255], 10], [[230, 28, 74, 255], 10]))!;
    expect(Math.abs(toOklch(parseHex(color)!).h - toOklch(parseHex("#e11d48")!).h)).toBeLessThan(3);
  });
  it("returns null for a monochrome icon", () => {
    expect(dominantColor(pixels([[0, 0, 0, 255], 64], [[255, 255, 255, 255], 64]))).toBeNull();
    expect(dominantColor(new Uint8ClampedArray())).toBeNull();
  });
});

describe("siteAccent", () => {
  it("prefers the theme-color, then the favicon color", () => {
    expect(siteAccent({ themeColor: "#e11d48", faviconColor: "#1877f2" })).toBe("#e11d48");
    expect(siteAccent({ themeColor: "#ffffff", faviconColor: "#1877f2" })).toBe("#1877f2");
    expect(siteAccent({ themeColor: null, faviconColor: null })).toBeNull();
    expect(siteAccent({ themeColor: "#000000", faviconColor: "#eeeeee" })).toBeNull();
  });
  it("gives AA accent text once through the contrast engine", () => {
    const accent = siteAccent({ themeColor: "#e11d48" })!;
    for (const mode of ["light", "dark"] as const) {
      const vars = accentVariables(accent, mode);
      const palette = derivePalette("#8b7bff", "#d77bff", mode);
      for (const bg of [palette.bg, palette.bgElevated]) expect(contrastRatio(parseHex(vars["--accent-text"])!, parseHex(bg)!)).toBeGreaterThanOrEqual(4.4);
      expect(contrastRatio(parseHex(vars["--on-accent"])!, parseHex(vars["--accent"])!)).toBeGreaterThanOrEqual(3);
    }
  });
});

describe("mixHex", () => {
  it("returns the ends and a midpoint between", () => {
    expect(mixHex("#e11d48", "#1877f2", 0)).toBe("#e11d48");
    expect(mixHex("#e11d48", "#1877f2", 1)).toBe("#1877f2");
    const mid = mixHex("#000000", "#ffffff", 0.5);
    expect(mid).not.toBe("#000000");
    expect(mid).not.toBe("#ffffff");
  });
});
