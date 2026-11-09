/**
 * The UI language (ADR-052), pure: French (the source catalog) and English. "auto" follows the
 * system (Electron `app.getPreferredSystemLanguages()`, expo-localization on the phone).
 */

export type Locale = "fr" | "en";
/** The "Langue" setting. */
export type LanguageSetting = "auto" | Locale;

export const LOCALES: readonly Locale[] = ["fr", "en"];
export const LANGUAGE_SETTINGS: readonly LanguageSetting[] = ["auto", "fr", "en"];
/** The source catalog: every other one is typed against it, and it is the fallback. */
export const SOURCE_LOCALE: Locale = "fr";
/** An "auto" language when the system speaks none of `LOCALES`. */
export const FALLBACK_LOCALE: Locale = "en";

export function isLocale(value: unknown): value is Locale {
  return value === "fr" || value === "en";
}

export function isLanguageSetting(value: unknown): value is LanguageSetting {
  return value === "auto" || isLocale(value);
}

/** The first supported language of a system list ("fr-CA" → "fr"), or null. */
export function matchLocale(tags: readonly (string | null | undefined)[]): Locale | null {
  for (const tag of tags) {
    const base = (tag ?? "").trim().toLowerCase().split(/[-_]/)[0];
    if (isLocale(base)) return base;
  }
  return null;
}

/** The language the UI shows for a setting and the system's preferred languages. */
export function resolveLocale(setting: LanguageSetting | undefined, system: readonly (string | null | undefined)[]): Locale {
  if (isLocale(setting)) return setting;
  return matchLocale(system) ?? FALLBACK_LOCALE;
}

let current: Locale = SOURCE_LOCALE;
const listeners = new Set<(locale: Locale) => void>();

export function getLocale(): Locale {
  return current;
}

/** Sets the process-wide UI language; listeners run only on a change. */
export function setLocale(locale: Locale): void {
  if (locale === current || !isLocale(locale)) return;
  current = locale;
  for (const listener of [...listeners]) listener(locale);
}

export function onLocaleChange(listener: (locale: Locale) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
