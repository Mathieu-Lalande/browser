import { getLocale, resolveLocale, setLocale, type LanguageSetting, type Locale } from "@shared/i18n";

/**
 * The UI language on the phone (ADR-052): the shared "Langue" setting, or the phone's language
 * for "auto". Hermes' `Intl` reports the device locale, so no native module is needed (the
 * desktop uses `app.getPreferredSystemLanguages()`).
 */

/** The phone's preferred languages, best first. */
export function systemLanguages(): string[] {
  const tags: string[] = [];
  try {
    tags.push(Intl.DateTimeFormat().resolvedOptions().locale);
  } catch {
    // No Intl: the fallback language applies.
  }
  const nav = (globalThis as { navigator?: { languages?: readonly string[]; language?: string } }).navigator;
  if (nav?.languages) tags.push(...nav.languages);
  if (nav?.language) tags.push(nav.language);
  return tags;
}

/** Sets the language for `setting`; returns it (the root re-mounts on a change). */
export function applyLanguage(setting: LanguageSetting | undefined, system: readonly string[] = systemLanguages()): Locale {
  setLocale(resolveLocale(setting, system));
  return getLocale();
}
