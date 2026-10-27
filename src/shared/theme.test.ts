import { describe, expect, it } from "vitest";
import { ACCENT_PRESETS, DEFAULT_SETTINGS } from "./settings";
import { CONTRAST, accentVariables, blend, clampAccentLightness, contrastRatio, derivePalette, parseCssColor, parseHex, themeVariables, toHex, type Palette, type Rgb } from "./theme";

const ACCENTS = [
  "#8b7bff",
  "#ff3b30",
  "#ffd60a",
  "#34c759",
  "#0a84ff",
  "#000000",
  "#ffffff",
  "#7f7f7f",
  "#00ffff",
  ...ACCENT_PRESETS.map((preset) => preset.accent),
];
const MODES = ["light", "dark"] as const;

function solid(value: string): Rgb {
  const parsed = parseCssColor(value);
  if (!parsed || parsed.alpha !== 1) throw new Error(`not opaque: ${value}`);
  return parsed.color;
}

/** Every opaque background text can be drawn on: base, elevated, and the translucent surfaces over both. */
function grounds(palette: Palette): Rgb[] {
  const bases = [solid(palette.bg), solid(palette.bgElevated)];
  const layers = [palette.surface, palette.surfaceHover, palette.surfaceActive].map((value) => parseCssColor(value)!);
  return [...bases, ...bases.flatMap((base) => layers.map(({ color, alpha }) => blend(color, alpha, base)))];
}

describe("color helpers", () => {
  it("parses and prints colors", () => {
    expect(parseHex("#fff")).toEqual({ r: 1, g: 1, b: 1 });
    expect(toHex(parseHex("#8b7bff")!)).toBe("#8b7bff");
    expect(parseHex("nope")).toBeNull();
    expect(parseCssColor("rgb(10 20 30 / 0.5)")).toEqual({ color: { r: 10 / 255, g: 20 / 255, b: 30 / 255 }, alpha: 0.5 });
  });

  it("computes WCAG contrast ratios", () => {
    expect(contrastRatio(parseHex("#000")!, parseHex("#fff")!)).toBeCloseTo(21, 5);
    expect(contrastRatio(parseHex("#777")!, parseHex("#777")!)).toBe(1);
    expect(contrastRatio(parseHex("#767676")!, parseHex("#fff")!)).toBeCloseTo(4.54, 1);
  });
});

describe("derivePalette", () => {
  for (const mode of MODES) {
    it.each(ACCENTS)(`meets WCAG AA in ${mode} mode with accent %s`, (accent) => {
      const palette = derivePalette(accent, "#d77bff", mode);
      expect(palette.scheme).toBe(mode);
      for (const ground of grounds(palette)) {
        expect(contrastRatio(solid(palette.text), ground)).toBeGreaterThanOrEqual(7);
        expect(contrastRatio(solid(palette.textMuted), ground)).toBeGreaterThanOrEqual(CONTRAST.text);
        expect(contrastRatio(solid(palette.textFaint), ground)).toBeGreaterThanOrEqual(CONTRAST.faint);
      }
      for (const ground of [solid(palette.bg), solid(palette.bgElevated)]) {
        expect(contrastRatio(solid(palette.accentText), ground)).toBeGreaterThanOrEqual(CONTRAST.text);
      }
      expect(contrastRatio(solid(palette.onAccent), solid(palette.accent))).toBeGreaterThanOrEqual(CONTRAST.text);
    });
  }

  it("keeps the chosen accents as they are and follows the mode", () => {
    const dark = derivePalette("#10b981", "#a3e635", "dark");
    const light = derivePalette("#10b981", "#a3e635", "light");
    expect(dark.accent).toBe("#10b981");
    expect(dark.accent2).toBe("#a3e635");
    const sum = (value: string) => Object.values(solid(value)).reduce((a, b) => a + b, 0);
    expect(sum(dark.bg)).toBeLessThan(0.5);
    expect(sum(light.bg)).toBeGreaterThan(2.5);
  });

  it("tints neutrals with the accent hue, but keeps grey accents neutral", () => {
    const red = solid(derivePalette("#ff0000", "#ff0000", "dark").bg);
    expect(red.r).toBeGreaterThan(red.b);
    const grey = solid(derivePalette("#808080", "#808080", "dark").bg);
    expect(Math.abs(grey.r - grey.b)).toBeLessThan(2 / 255);
  });

  it("falls back to the default accent for invalid input", () => {
    expect(derivePalette("bogus", "bogus", "dark")).toEqual(derivePalette("#8b7bff", "#8b7bff", "dark"));
  });
});

describe("themeVariables", () => {
  it("maps settings to CSS variables", () => {
    const vars = themeVariables(DEFAULT_SETTINGS, "dark");
    expect(vars["--accent"]).toBe("#8b7bff");
    expect(vars["--radius"]).toBe("10px");
    expect(vars["--gutter"]).toBe("8px");
    expect(vars["--sidebar-width"]).toBe("264px");
    expect(vars["--tab-height"]).toBe("36px");
    expect(vars["color-scheme"]).toBe("dark");
  });

  it("follows density, zen mode, shadows and background style", () => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.appearance.density = "compact";
    settings.appearance.shadows = false;
    settings.appearance.background = "solid";
    settings.layout.zenMode = true;
    const vars = themeVariables(settings, "light");
    expect(vars["--tab-height"]).toBe("30px");
    expect(vars["--gutter"]).toBe("0px");
    expect(vars["--viewport-shadow"]).not.toContain("30px");
    expect(vars["--backdrop"]).toBe("var(--bg)");
    expect(vars["color-scheme"]).toBe("light");
  });
});

describe("accentVariables (space colors)", () => {
  const EXTREMES = ["#fff200", "#ffffff", "#ffff00", "#101010", "#000000", "#00ffff", "#7f7f7f", "#e5484d"];
  for (const mode of MODES) {
    for (const color of EXTREMES) {
      it(`keeps ${color} readable in ${mode} mode`, () => {
        const vars = accentVariables(color, mode);
        const palette = derivePalette(DEFAULT_SETTINGS.appearance.accent, DEFAULT_SETTINGS.appearance.accent2, mode);
        const accent = solid(vars["--accent"]);
        const accentText = solid(vars["--accent-text"]);
        for (const ground of [solid(palette.bg), solid(palette.bgElevated)]) {
          expect(contrastRatio(accentText, ground)).toBeGreaterThanOrEqual(CONTRAST.text - 0.05);
        }
        expect(contrastRatio(solid(vars["--on-accent"]), accent)).toBeGreaterThanOrEqual(CONTRAST.text);
      });
    }
  }

  it("clamps the lightness of user-picked colors, keeping mid colors as they are", () => {
    expect(clampAccentLightness("#8b7bff")).toBe("#8b7bff");
    const light = clampAccentLightness("#ffffff")!;
    const dark = clampAccentLightness("#000000")!;
    expect(light).not.toBe("#ffffff");
    expect(dark).not.toBe("#000000");
    expect(contrastRatio(solid(light), solid("#ffffff"))).toBeGreaterThan(1.3);
    expect(contrastRatio(solid(dark), solid("#000000"))).toBeGreaterThan(1.3);
    expect(clampAccentLightness("nope")).toBeNull();
  });
});
