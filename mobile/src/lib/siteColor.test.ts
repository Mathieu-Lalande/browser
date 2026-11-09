import { contrastRatio, derivePalette, parseCssColor } from "@shared/theme";
import { appColors } from "./colors";
import { ThemeColorGuard, THEME_COLOR_MESSAGE, themeColorWatchScript, withSiteAccent } from "./siteColor";

const message = (nonce: string, color: unknown) => JSON.stringify({ type: THEME_COLOR_MESSAGE, nonce, color });

describe("dynamic theme on the phone (ADR-050)", () => {
  it("accepts this document's nonce only, on the injected origin, through the shared site color rules", () => {
    let n = 0;
    const guard = new ThemeColorGuard(() => `nonce${++n}`);
    const script = guard.loadEnded("https://shop.example/page")!;
    expect(script).toContain('"nonce1"');
    expect(guard.parse(message("nonce1", "#1a73e8"), "https://shop.example/page", "https://shop.example/page")).toBe("#1a73e8");
    expect(guard.parse(message("nonce1", "rgb(26, 115, 232)"), "https://shop.example/x", "https://shop.example/x")).toBe("#1a73e8");
    // Greys, garbage and other nonces or origins.
    expect(guard.parse(message("nonce1", "#ffffff"), "https://shop.example/", "https://shop.example/")).toBeNull();
    expect(guard.parse(message("nonce1", "url(javascript:alert(1))"), "https://shop.example/", "https://shop.example/")).toBeNull();
    expect(guard.parse(message("forged", "#1a73e8"), "https://shop.example/", "https://shop.example/")).toBeUndefined();
    expect(guard.parse(message("nonce1", "#1a73e8"), "https://ads.example/", "https://shop.example/")).toBeUndefined();
    guard.loadStarted();
    expect(guard.parse(message("nonce1", "#1a73e8"), "https://shop.example/", "https://shop.example/")).toBeUndefined();
    expect(guard.loadEnded("about:blank")).toBeNull();
    expect(themeColorWatchScript("x")).toContain("MutationObserver");
  });

  it("keeps the accent text at WCAG AA on the backgrounds, even for a pale site color", () => {
    for (const mode of ["light", "dark"] as const) {
      const base = appColors("#8b7bff", "#6d28d9", mode);
      const themed = withSiteAccent(base, "#ffe600", mode);
      expect(themed.accent).not.toBe(base.accent);
      const bg = parseCssColor(derivePalette("#8b7bff", "#6d28d9", mode).bg)!.color;
      expect(contrastRatio(parseCssColor(themed.accentText)!.color, bg)).toBeGreaterThanOrEqual(4.5);
      expect(withSiteAccent(base, null, mode)).toBe(base);
    }
  });
});
