/**
 * Languages of page translation (ADR-036): BCP 47 tags reduced to their primary subtag, French
 * names for the UI, the page's declared language and the default target. Pure (desktop and phone).
 */

/** Languages offered in the pickers (the three providers know all of them). */
export const LANGUAGES: readonly { code: string; name: string }[] = [
  { code: "fr", name: "Français" },
  { code: "en", name: "Anglais" },
  { code: "de", name: "Allemand" },
  { code: "es", name: "Espagnol" },
  { code: "it", name: "Italien" },
  { code: "pt", name: "Portugais" },
  { code: "nl", name: "Néerlandais" },
  { code: "pl", name: "Polonais" },
  { code: "ru", name: "Russe" },
  { code: "uk", name: "Ukrainien" },
  { code: "cs", name: "Tchèque" },
  { code: "sk", name: "Slovaque" },
  { code: "sl", name: "Slovène" },
  { code: "ro", name: "Roumain" },
  { code: "bg", name: "Bulgare" },
  { code: "el", name: "Grec" },
  { code: "hu", name: "Hongrois" },
  { code: "fi", name: "Finnois" },
  { code: "sv", name: "Suédois" },
  { code: "da", name: "Danois" },
  { code: "nb", name: "Norvégien" },
  { code: "et", name: "Estonien" },
  { code: "lv", name: "Letton" },
  { code: "lt", name: "Lituanien" },
  { code: "tr", name: "Turc" },
  { code: "ar", name: "Arabe" },
  { code: "he", name: "Hébreu" },
  { code: "hi", name: "Hindi" },
  { code: "id", name: "Indonésien" },
  { code: "ja", name: "Japonais" },
  { code: "ko", name: "Coréen" },
  { code: "zh", name: "Chinois" },
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
  if (!code) return "langue inconnue";
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
