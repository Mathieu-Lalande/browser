import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS,
  effectiveGutter,
  isSettingsSection,
  mergeSettings,
  pageRadius,
  resetSettings,
  sanitizeSettings,
  searchEngineOf,
  tabSleepDelayMs,
  type Settings,
} from "./settings";

const custom = (patch: (s: Settings) => void): Settings => {
  const settings = structuredClone(DEFAULT_SETTINGS);
  patch(settings);
  return settings;
};

describe("sanitizeSettings", () => {
  it("returns the defaults for anything that is not an object", () => {
    for (const value of [null, undefined, 42, "x", [], true]) expect(sanitizeSettings(value)).toEqual(DEFAULT_SETTINGS);
  });

  it("keeps valid values and round-trips its own output", () => {
    const settings = custom((s) => {
      s.appearance.mode = "dark";
      s.appearance.accent = "#10b981";
      s.layout.sidebarPosition = "right";
      s.search.engine = "google";
      s.startPage.greetingName = "Mathieu";
      s.behavior.closeTabActivates = "recent";
    });
    expect(sanitizeSettings(settings)).toEqual(settings);
    expect(sanitizeSettings(JSON.parse(JSON.stringify(settings)))).toEqual(settings);
  });

  it("replaces invalid fields by their default and drops unknown ones", () => {
    const result = sanitizeSettings({
      appearance: { mode: "neon", accent: "red", radius: "12", shadows: "yes", extra: 1 },
      layout: "nope",
      search: { engine: "evil" },
      behavior: { restoreSession: 0 },
      hacker: { x: 1 },
    });
    expect(result).toEqual(DEFAULT_SETTINGS);
    expect(Object.keys(result)).toEqual(Object.keys(DEFAULT_SETTINGS));
    expect(result.appearance).not.toHaveProperty("extra");
  });

  it("clamps and rounds numbers", () => {
    const result = sanitizeSettings({ appearance: { radius: 99.6 }, layout: { sidebarWidth: 10, gutter: 3.4 } });
    expect(result.appearance.radius).toBe(18);
    expect(result.layout.sidebarWidth).toBe(200);
    expect(result.layout.gutter).toBe(3);
    expect(sanitizeSettings({ appearance: { radius: Number.NaN } }).appearance.radius).toBe(DEFAULT_SETTINGS.appearance.radius);
    expect(sanitizeSettings({ appearance: { radius: -4 } }).appearance.radius).toBe(0);
  });

  it("normalizes hex colors", () => {
    expect(sanitizeSettings({ appearance: { accent: "#ABC", accent2: "  #A1B2C3 " } }).appearance).toMatchObject({
      accent: "#aabbcc",
      accent2: "#a1b2c3",
    });
    for (const bad of ["#abcd", "rgb(0,0,0)", "#ggg", "", 12]) {
      expect(sanitizeSettings({ appearance: { accent: bad } }).appearance.accent).toBe(DEFAULT_SETTINGS.appearance.accent);
    }
  });

  it("keeps the greeting as typed, bounded and without control characters", () => {
    expect(sanitizeSettings({ startPage: { greetingName: "Jean " } }).startPage.greetingName).toBe("Jean ");
    expect(sanitizeSettings({ startPage: { greetingName: "a\u0000b\nc" } }).startPage.greetingName).toBe("abc");
    expect(sanitizeSettings({ startPage: { greetingName: "x".repeat(500) } }).startPage.greetingName).toHaveLength(40);
  });

  it("only accepts https: background images", () => {
    const image = (value: unknown) => sanitizeSettings({ startPage: { backgroundImage: value } }).startPage.backgroundImage;
    expect(image("https://example.com/a.jpg")).toBe("https://example.com/a.jpg");
    for (const bad of [
      "http://example.com/a.jpg",
      "file:///etc/passwd",
      "javascript:alert(1)",
      "data:image/png;base64,x",
      "browser://settings",
      "nope",
    ]) {
      expect(image(bad)).toBe("");
    }
  });
});

describe("mergeSettings", () => {
  it("applies valid fields of a patch and keeps the rest", () => {
    const base = custom((s) => (s.appearance.accent = "#ff0000"));
    const merged = mergeSettings(base, { appearance: { mode: "light", radius: "bad" }, layout: { zenMode: true } });
    expect(merged.appearance).toEqual({ ...base.appearance, mode: "light" });
    expect(merged.layout).toEqual({ ...base.layout, zenMode: true });
    expect(merged.search).toEqual(base.search);
  });

  it("ignores garbage patches", () => {
    const base = custom((s) => (s.search.engine = "brave"));
    expect(mergeSettings(base, null)).toEqual(base);
    expect(mergeSettings(base, { search: { engine: "nope" } })).toEqual(base);
  });

  it("never mutates its input", () => {
    const base = structuredClone(DEFAULT_SETTINGS);
    mergeSettings(base, { appearance: { mode: "dark" } });
    expect(base).toEqual(DEFAULT_SETTINGS);
  });
});

describe("resetSettings", () => {
  const changed = custom((s) => {
    s.appearance.mode = "dark";
    s.search.engine = "google";
  });

  it("resets a single section", () => {
    const reset = resetSettings(changed, "appearance");
    expect(reset.appearance).toEqual(DEFAULT_SETTINGS.appearance);
    expect(reset.search.engine).toBe("google");
  });

  it("resets everything", () => {
    expect(resetSettings(changed)).toEqual(DEFAULT_SETTINGS);
  });

  it("returns copies of the defaults", () => {
    const reset = resetSettings(changed);
    reset.appearance.mode = "light";
    expect(DEFAULT_SETTINGS.appearance.mode).toBe("system");
  });
});

describe("derived values", () => {
  it("resolves the search engine", () => {
    expect(searchEngineOf(custom((s) => (s.search.engine = "brave"))).id).toBe("brave");
    expect(searchEngineOf(custom((s) => (s.search.engine = "unknown"))).id).toBe("duckduckgo");
  });

  it("puts the page edge to edge in zen mode", () => {
    expect(effectiveGutter(DEFAULT_SETTINGS)).toBe(8);
    expect(pageRadius(DEFAULT_SETTINGS)).toBe(10);
    const zen = custom((s) => (s.layout.zenMode = true));
    expect(effectiveGutter(zen)).toBe(0);
    expect(pageRadius(zen)).toBe(0);
    expect(pageRadius(custom((s) => (s.layout.gutter = 0)))).toBe(0);
  });

  it("puts tabs to sleep after 30 minutes by default, or never", () => {
    expect(tabSleepDelayMs(DEFAULT_SETTINGS)).toBe(30 * 60_000);
    expect(tabSleepDelayMs(custom((s) => (s.behavior.sleepTabsAfter = "2h")))).toBe(2 * 3600_000);
    expect(tabSleepDelayMs(custom((s) => (s.behavior.sleepTabsAfter = "never")))).toBeNull();
    // Older settings files (no such field) and bad values get the default.
    expect(sanitizeSettings({ behavior: { restoreSession: false } }).behavior.sleepTabsAfter).toBe("30m");
    expect(sanitizeSettings({ behavior: { sleepTabsAfter: 30 } }).behavior.sleepTabsAfter).toBe("30m");
    expect(sanitizeSettings({ privacy: { normalizeAcceptLanguage: "yes" } }).privacy.normalizeAcceptLanguage).toBe(false);
  });

  it("recognizes section names", () => {
    expect(isSettingsSection("privacy")).toBe(true);
    expect(isSettingsSection("appearance")).toBe(true);
    expect(isSettingsSection("__proto__")).toBe(false);
    expect(isSettingsSection(undefined)).toBe(false);
  });
});
