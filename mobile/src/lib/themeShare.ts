import { t } from "@shared/i18n";
import type { Settings, SettingsPatch } from "@shared/settings";
import {
  THEME_CODE_PREFIX,
  applyTheme,
  encodeTheme,
  parseThemeInput,
  themeFromSettings,
  themePatch,
  type SharedTheme,
} from "@shared/theme-share";
import { colorsFor, type AppColors } from "./colors";

/**
 * Shareable themes on the phone (ADR-030): the shared codec (`@shared/theme-share`), adapted to
 * the share sheet, the QR scanner and the phone's theme (accent, accent 2 and mode; the other
 * fields are kept in the settings and used by the desktop once synced or shared back).
 */

export const THEME_QR_PREFIX = THEME_CODE_PREFIX;

/** Code of the current look (the phone has no start image, nothing else to leave out). */
export function currentThemeCode(settings: Settings): string {
  return encodeTheme(themeFromSettings(settings));
}

/** Text for the share sheet: a line for people, then the code. */
export function shareMessage(settings: Settings): string {
  return t("mobile.themeShare.myBrowserThemePaste", { p: currentThemeCode(settings) });
}

export type ThemeImport = { ok: true; theme: SharedTheme; patch: SettingsPatch } | { ok: false; error: string };

/** Pasted text (a code, possibly inside a shared message, or a file's JSON) or a scanned QR code. */
export function importTheme(text: string, settings: Settings): ThemeImport {
  const trimmed = text.trim();
  const at = trimmed.indexOf(THEME_CODE_PREFIX);
  const input = at > 0 && !trimmed.startsWith("{") ? trimmed.slice(at).split(/\s/)[0] : trimmed;
  const result = parseThemeInput(input);
  return result.ok ? { ok: true, theme: result.theme, patch: themePatch(result.theme, settings) } : result;
}

/** The phone's colors with the theme applied (preview card). */
export function previewColors(settings: Settings, theme: SharedTheme, system: "light" | "dark" | null | undefined): AppColors {
  return colorsFor(applyTheme(settings, theme), system, null, false);
}
