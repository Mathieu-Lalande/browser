/**
 * Languages of page translation (ADR-036): BCP 47 tags reduced to their primary subtag, French
 * names for the UI, the page's declared language and the default target. Pure (desktop and phone).
 */

/** Languages offered in the pickers (the three providers know all of them). */
import { t as tr, t } from "../i18n";

export const LANGUAGES: readonly { code: string; name: string }[] = [
  { code: "fr", get name() { return t("translateLanguages.french") } },
  { code: "en", get name() { return t("translateLanguages.english") } },
  { code: "de", get name() { return t("translateLanguages.german") } },
  { code: "es", get name() { return t("translateLanguages.spanish") } },
  { code: "it", get name() { return t("translateLanguages.italian") } },
  { code: "pt", get name() { return t("translateLanguages.portuguese") } },
  { code: "nl", get name() { return t("translateLanguages.dutch") } },
  { code: "pl", get name() { return t("translateLanguages.polish") } },
  { code: "ru", get name() { return t("translateLanguages.russian") } },
  { code: "uk", get name() { return t("translateLanguages.ukrainian") } },
  { code: "cs", get name() { return t("translateLanguages.czech") } },
  { code: "sk", get name() { return t("translateLanguages.slovak") } },
  { code: "sl", get name() { return t("translateLanguages.slovenian") } },
  { code: "ro", get name() { return t("translateLanguages.romanian") } },
  { code: "bg", get name() { return t("translateLanguages.bulgarian") } },
  { code: "el", get name() { return t("translateLanguages.greek") } },
  { code: "hu", get name() { return t("translateLanguages.hungarian") } },
  { code: "fi", get name() { return t("translateLanguages.finnish") } },
  { code: "sv", get name() { return t("translateLanguages.swedish") } },
  { code: "da", get name() { return t("translateLanguages.danish") } },
  { code: "nb", get name() { return t("translateLanguages.norwegian") } },
  { code: "et", get name() { return t("translateLanguages.estonian") } },
  { code: "lv", get name() { return t("translateLanguages.latvian") } },
  { code: "lt", get name() { return t("translateLanguages.lithuanian") } },
  { code: "tr", get name() { return t("translateLanguages.turkish") } },
  { code: "ar", get name() { return t("translateLanguages.arabic") } },
  { code: "he", get name() { return t("translateLanguages.hebrew") } },
  { code: "hi", name: "Hindi" },
  { code: "id", get name() { return t("translateLanguages.indonesian") } },
  { code: "ja", get name() { return t("translateLanguages.japanese") } },
  { code: "ko", get name() { return t("translateLanguages.korean") } },
  { code: "zh", get name() { return t("translateLanguages.chinese") } },
];

const NAMES = new Map(LANGUAGES.map((language) => [language.code, language.name]));

/** Deprecated or macro-language codes → the one the providers know. */
const ALIASES: Record<string, string> = { iw: "he", in: "id", ji: "yi", no: "nb", nn: "nb" };

/**
 * A language tag ("en-US", "PT_br", " zh-Hant ") → its primary subtag ("en", "pt", "zh"), or null
 * when it is not one ("", "x-klingon", "*", "und").
 */
export function normalizeLanguage(tag: unknown): string | null {
  if (typeof tag !== "string") return null;
  const primary = tag.trim().toLowerCase().split(/[-_]/, 1)[0];
  if (!/^[a-z]{2,3}$/.test(primary) || primary === "und" || primary === "mul" || primary === "zxx") return null;
  return ALIASES[primary] ?? primary;
}

export const isLanguageCode = (value: unknown): value is string => typeof value === "string" && normalizeLanguage(value) === value;

/** "Anglais", or the code in capitals for a language without a French name here. */
export function languageName(code: string | null | undefined): string {
  if (!code) return tr("translateLanguages.unknownLanguage");
  return NAMES.get(code) ?? code.toUpperCase();
}

/**
 * The language a page declares: `<html lang>`, else its `Content-Language` (first one). Null when
 * it declares none: the provider then detects it from the text sent (source "auto").
 */
export function pageLanguage(declared: { lang?: unknown; contentLanguage?: unknown }): string | null {
  const contentLanguage = typeof declared.contentLanguage === "string" ? declared.contentLanguage.split(",", 1)[0] : null;
  return normalizeLanguage(declared.lang) ?? normalizeLanguage(contentLanguage);
}

/**
 * The target language: the user's choice, else the first known UI/system language, else French
 * (the UI's own language).
 */
export function targetLanguage(chosen: string, preferred: readonly string[]): string {
  const own = normalizeLanguage(chosen);
  if (own) return own;
  for (const tag of preferred) {
    const code = normalizeLanguage(tag);
    if (code) return code;
  }
  return "fr";
}

/** Deduplicated, normalized language list (settings rules), at most `max` entries. */
export function sanitizeLanguageList(value: unknown, max = 100): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const codes = new Set<string>();
  for (const item of value) {
    const code = normalizeLanguage(item);
    if (code) codes.add(code);
  }
  return [...codes].sort().slice(0, max);
}
