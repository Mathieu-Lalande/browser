/**
 * Spell checker languages (ADR-041), pure. Chromium names its dictionaries "fr", "en-US", "pt-BR"…;
 * on macOS the system checker is used and picks languages by itself.
 */

/** The dictionaries to load: the chosen ones Chromium has, else the closest to the app's locale. */
export function spellLanguagesFor(chosen: readonly string[], available: readonly string[], locale: string): string[] {
  const known = chosen.filter((code) => available.includes(code));
  if (known.length) return known;
  const exact = available.find((code) => code.toLowerCase() === locale.toLowerCase());
  if (exact) return [exact];
  const base = locale.split(/[-_]/)[0].toLowerCase();
  const sameLanguage = available.find((code) => code.toLowerCase() === base) ?? available.find((code) => code.toLowerCase().startsWith(`${base}-`));
  return sameLanguage ? [sameLanguage] : [];
}

/** "fr" → "Français", "en-US" → "Anglais (États-Unis)" (French UI), or the code itself. */
export function spellLanguageName(code: string): string {
  try {
    const name = new Intl.DisplayNames(["fr"], { type: "language" }).of(code);
    return name ? name.charAt(0).toUpperCase() + name.slice(1) : code;
  } catch {
    return code;
  }
}

/** A word the user adds to or removes from the dictionary: one word, no spaces, bounded. */
export const isDictionaryWord = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 64 && !/[\s\u0000-\u001f]/.test(value);
