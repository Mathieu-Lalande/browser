import { DEFAULT_SETTINGS, sanitizeSettings } from "@shared/settings";
import { THEME_GALLERY, isCurrentTheme, themeFile } from "@shared/theme-share";
import { currentThemeCode, importTheme, previewColors, shareMessage } from "./themeShare";

describe("shareable themes on the phone", () => {
  const desktop = sanitizeSettings({ appearance: { mode: "dark", accent: "#10b981", accent2: "#a3e635", font: "mono", radius: 4 } });

  it("imports a code shared from the desktop, even inside a message", () => {
    const result = importTheme(shareMessage(desktop), DEFAULT_SETTINGS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.patch.appearance).toMatchObject({ mode: "dark", accent: "#10b981", accent2: "#a3e635", font: "mono", radius: 4 });
    const applied = sanitizeSettings({ ...DEFAULT_SETTINGS, appearance: { ...DEFAULT_SETTINGS.appearance, ...result.patch.appearance } });
    expect(currentThemeCode(applied)).toBe(currentThemeCode(desktop));
  });

  it("imports a .browsertheme file's contents and refuses garbage", () => {
    expect(importTheme(themeFile(THEME_GALLERY[3]), DEFAULT_SETTINGS)).toMatchObject({ ok: true, theme: THEME_GALLERY[3] });
    expect(importTheme("browser-theme:v1:%%%", DEFAULT_SETTINGS)).toMatchObject({ ok: false, error: expect.any(String) });
    expect(importTheme("bonjour", DEFAULT_SETTINGS).ok).toBe(false);
  });

  it("previews a theme with the phone's colors", () => {
    const dark = THEME_GALLERY.find((theme) => theme.mode === "dark")!;
    const colors = previewColors(DEFAULT_SETTINGS, dark, "light");
    expect(colors.scheme).toBe("dark");
    expect(isCurrentTheme(DEFAULT_SETTINGS, THEME_GALLERY[0])).toBe(true);
  });
});
