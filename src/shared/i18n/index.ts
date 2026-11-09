import { en } from "./en";
import { fr, type MessageKey } from "./fr";
import { formatMessage, type MessageParams } from "./format";
import { getLocale, LOCALES, SOURCE_LOCALE, type Locale } from "./locale";

/**
 * Internationalization (ADR-052), pure and shared by main, the UIs and the phone: typed
 * catalogs (`fr.ts` is the source, `en.ts` must have every key), ICU-lite formatting, `Intl`
 * helpers. UI text never lives in components: `t("key")` in the current language.
 */

export type { MessageKey } from "./fr";
export type { MessageParams } from "./format";
export * from "./locale";
export * from "./intl";
export { formatMessage, messageArguments, pluralCategory } from "./format";

export const CATALOGS: Readonly<Record<Locale, Readonly<Record<MessageKey, string>>>> = { fr, en };

/** The message `key` in `locale`, formatted with `params` (falls back to French, then the key). */
export function translate(locale: Locale, key: MessageKey, params?: MessageParams): string {
  const pattern = CATALOGS[locale][key] ?? CATALOGS[SOURCE_LOCALE][key] ?? key;
  return params || pattern.includes("{") ? formatMessage(pattern, params, locale) : pattern;
}

/** The message `key` in the current UI language. */
export function t(key: MessageKey, params?: MessageParams): string {
  return translate(getLocale(), key, params);
}

/**
 * Search terms in every language: a keywords entry is a comma-separated list, and commands or
 * settings are found by their French and English terms whatever the UI language.
 */
export function keywords(key: MessageKey): string[] {
  const terms = new Set<string>();
  for (const locale of LOCALES) {
    for (const term of CATALOGS[locale][key].split(",")) {
      const trimmed = term.trim();
      if (trimmed) terms.add(trimmed);
    }
  }
  return [...terms];
}

export function isMessageKey(value: unknown): value is MessageKey {
  return typeof value === "string" && Object.hasOwn(CATALOGS[SOURCE_LOCALE], value);
}
