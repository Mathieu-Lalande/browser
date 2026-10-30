import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, sanitizeSettings } from "./settings";
import { toBase64Url, utf8Encode } from "./sync/bytes";
import {
  MAX_THEME_CODE,
  THEME_CODE_PREFIX,
  THEME_GALLERY,
  applyTheme,
  decodeTheme,
  encodeTheme,
  isCurrentTheme,
  parseThemeFile,
  parseThemeInput,
  themeFile,
  themeFileName,
  themeFromSettings,
  themePatch,
  validateTheme,
} from "./theme-share";

const custom = sanitizeSettings({
  appearance: { mode: "dark", accent: "#3b82f6", accent2: "#22d3ee", background: "mesh", density: "compact", radius: 4, font: "mono", shadows: false },
  startPage: { background: "aurora" },
});
const raw = (value: unknown) => THEME_CODE_PREFIX + toBase64Url(utf8Encode(JSON.stringify(value)));

describe("theme codec", () => {
  it("round-trips the current look through a code and a file", () => {
    const theme = themeFromSettings(custom, "Océan nocturne");
    const code = encodeTheme(theme);
    expect(code.startsWith(THEME_CODE_PREFIX)).toBe(true);
    expect(code.length).toBeLessThan(400);
    expect(decodeTheme(code)).toEqual({ ok: true, theme });
    expect(parseThemeFile(themeFile(theme))).toEqual({ ok: true, theme });
    expect(parseThemeInput(`  ${code.slice(0, 30)}\n${code.slice(30)}  `)).toEqual({ ok: true, theme });
    expect(parseThemeInput(themeFile(theme))).toEqual({ ok: true, theme });
  });

  it("applies a theme to other settings", () => {
    const theme = themeFromSettings(custom);
    const applied = applyTheme(DEFAULT_SETTINGS, theme);
    expect(isCurrentTheme(applied, theme)).toBe(true);
    expect(isCurrentTheme(DEFAULT_SETTINGS, theme)).toBe(false);
    expect(applied.appearance.pageZoom).toBe(DEFAULT_SETTINGS.appearance.pageZoom);
    expect(applied.layout).toEqual(DEFAULT_SETTINGS.layout);
  });

  it("never exports nor overwrites a start image", () => {
    const withImage = sanitizeSettings({ startPage: { background: "image", backgroundImage: "https://exemple.fr/a.jpg" } });
    const theme = themeFromSettings(withImage);
    expect(theme.startBackground).toBe("theme");
    expect(encodeTheme(theme)).not.toContain("exemple");
    expect(themeFile(theme)).not.toContain("exemple");
    expect(themePatch(theme, withImage).startPage).toBeUndefined();
    expect(themePatch({ ...theme, startBackground: "aurora" }, withImage).startPage).toEqual({ background: "aurora" });
  });

  it("refuses foreign, malformed and oversized input", () => {
    expect(decodeTheme("bonjour").ok).toBe(false);
    expect(decodeTheme("browser-theme:v2:abc")).toMatchObject({ ok: false, error: expect.stringContaining("Version") });
    expect(decodeTheme(`${THEME_CODE_PREFIX}!!!`).ok).toBe(false);
    expect(decodeTheme(`${THEME_CODE_PREFIX}${"A".repeat(MAX_THEME_CODE)}`).ok).toBe(false);
    expect(parseThemeFile("{}").ok).toBe(false);
    expect(parseThemeFile(`{"format":"browser-theme","version":1,"theme":{},"pad":"${"x".repeat(5000)}"}`).ok).toBe(false);
    expect(parseThemeInput("").ok).toBe(false);
  });

  it("validates every field strictly", () => {
    const good = themeFromSettings(custom, "Ok");
    expect(validateTheme(good).ok).toBe(true);
    for (const bad of [
      { ...good, accent: "red" },
      { ...good, accent: "#3B82F6" }, // valid once normalized, but not as given
      { ...good, radius: 99 },
      { ...good, radius: 4.5 },
      { ...good, density: "huge" },
      { ...good, startBackground: "image" },
      { ...good, backgroundImage: "https://exemple.fr/a.jpg" },
      { ...good, name: "x".repeat(41) },
      { ...good, name: "a\u0000b" },
      { ...good, shadows: "yes" },
      { name: "Partiel", accent: "#000000" },
    ]) {
      expect(decodeTheme(raw(bad)).ok).toBe(false);
    }
  });

  it("names export files safely", () => {
    expect(themeFileName(themeFromSettings(custom, "Thème Ardoise / été"))).toBe("theme-ardoise-ete.browsertheme");
    expect(themeFileName(themeFromSettings(custom))).toBe("theme.browsertheme");
  });

  it("ships a valid, distinct gallery", () => {
    expect(THEME_GALLERY.length).toBeGreaterThanOrEqual(6);
    expect(THEME_GALLERY.length).toBeLessThanOrEqual(8);
    expect(new Set(THEME_GALLERY.map((theme) => theme.name)).size).toBe(THEME_GALLERY.length);
    for (const theme of THEME_GALLERY) expect(decodeTheme(encodeTheme(theme))).toEqual({ ok: true, theme });
    expect(isCurrentTheme(DEFAULT_SETTINGS, THEME_GALLERY[0])).toBe(true);
  });
});
