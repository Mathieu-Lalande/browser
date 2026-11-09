import { app } from "electron";
import { getLocale, resolveLocale, setLocale, type Locale } from "@shared/i18n";
import type { Settings } from "@shared/settings";

/**
 * The UI language in main (ADR-052): the "Langue" setting, or the system's preferred languages
 * for "auto". Set before the first window and on every settings change, before the listeners
 * run (menus, Jump List and windows then rebuild in the new language: `onLocaleChange`).
 */

/** The system's preferred languages; `BROWSER_TEST_LOCALE` stands in for them in tests (unpackaged only). */
export function systemLanguages(): string[] {
  const forced = app.isPackaged ? undefined : process.env.BROWSER_TEST_LOCALE;
  if (forced) return [forced];
  try {
    return [...app.getPreferredSystemLanguages(), app.getLocale()];
  } catch {
    return [app.getLocale()];
  }
}

/** Applies the language of `settings`; returns the one now in use. */
export function applyUiLanguage(settings: Settings): Locale {
  setLocale(resolveLocale(settings.appearance.language, systemLanguages()));
  return getLocale();
}
