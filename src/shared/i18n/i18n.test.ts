import { afterEach, describe, expect, it } from "vitest";
import {
  CATALOGS,
  formatDate,
  formatList,
  formatMessage,
  formatNumber,
  formatRelativeTime,
  getLocale,
  intlLocale,
  isMessageKey,
  keywords,
  LOCALES,
  matchLocale,
  messageArguments,
  onLocaleChange,
  pluralCategory,
  resolveLocale,
  setLocale,
  t,
  translate,
  type MessageKey,
} from ".";

afterEach(() => setLocale("fr"));

describe("catalogs", () => {
  const keys = Object.keys(CATALOGS.fr) as MessageKey[];

  it("every locale has every key, and no extra one", () => {
    for (const locale of LOCALES) {
      expect(Object.keys(CATALOGS[locale]).sort()).toEqual([...keys].sort());
    }
  });

  it("placeholders and arguments match between locales", () => {
    const mismatches = keys.filter((key) => LOCALES.some((locale) => messageArguments(CATALOGS[locale][key]).join() !== messageArguments(CATALOGS.fr[key]).join()));
    expect(mismatches).toEqual([]);
  });

  it("no message is empty and braces are balanced", () => {
    for (const locale of LOCALES) {
      for (const key of keys) {
        const text = CATALOGS[locale][key];
        expect(text.trim(), `${locale} ${key}`).not.toBe("");
        expect(text.split("{").length, `${locale} ${key}`).toBe(text.split("}").length);
      }
    }
  });

  it("English messages are translated (no French leftovers)", () => {
    const french = /[àâçéèêëîïôûùœ]|\b(le|les|des|une|vous|votre|onglet|fenêtre|paramètres)\b/i;
    const allowed = new Set<MessageKey>(["language.fr"]);
    const leftovers = keys.filter((key) => !allowed.has(key) && french.test(CATALOGS.en[key].replace(/\{[^}]*\}/g, "")));
    expect(leftovers).toEqual([]);
  });
});

describe("formatMessage", () => {
  it("replaces placeholders, formats numbers and keeps unknown ones visible", () => {
    expect(formatMessage("Bonjour {name} !", { name: "Ada" })).toBe("Bonjour Ada !");
    expect(formatMessage("{n} Mo", { n: 1234.5 }, "fr")).toBe("1 234,5 Mo");
    expect(formatMessage("{n} MB", { n: 1234.5 }, "en")).toBe("1,234.5 MB");
    expect(formatMessage("Salut {who}")).toBe("Salut {who}");
  });

  it("chooses plural branches by language", () => {
    const fr = "{count, plural, =0 {aucun onglet} one {# onglet} other {# onglets}}";
    expect(formatMessage(fr, { count: 0 }, "fr")).toBe("aucun onglet");
    expect(formatMessage(fr, { count: 1 }, "fr")).toBe("1 onglet");
    expect(formatMessage(fr, { count: 3 }, "fr")).toBe("3 onglets");
    const en = "{count, plural, one {# tab} other {# tabs}}";
    expect(formatMessage(en, { count: 0 }, "en")).toBe("0 tabs");
    expect(formatMessage(en, { count: 1 }, "en")).toBe("1 tab");
    expect(pluralCategory("fr", 1.5)).toBe("one");
    expect(pluralCategory("en", 1.5)).toBe("other");
  });

  it("supports select and nested placeholders", () => {
    const pattern = "{kind, select, file {Fichier {name}} other {Dossier {name}}}";
    expect(formatMessage(pattern, { kind: "file", name: "a.txt" })).toBe("Fichier a.txt");
    expect(formatMessage(pattern, { kind: "dir", name: "src" })).toBe("Dossier src");
    expect(messageArguments(pattern)).toEqual(["kind", "name"]);
  });

  it("keeps apostrophes as they are", () => {
    expect(formatMessage("L'onglet {n}", { n: 2 })).toBe("L'onglet 2");
  });
});

describe("locale", () => {
  it("resolves the setting against the system languages", () => {
    expect(resolveLocale("en", ["fr-FR"])).toBe("en");
    expect(resolveLocale("auto", ["fr-CA", "en-US"])).toBe("fr");
    expect(resolveLocale("auto", ["de-DE", "en_GB"])).toBe("en");
    expect(resolveLocale("auto", ["de-DE"])).toBe("en");
    expect(resolveLocale(undefined, [])).toBe("en");
    expect(matchLocale([null, "FR"])).toBe("fr");
  });

  it("t follows setLocale and notifies listeners once per change", () => {
    const seen: string[] = [];
    const stop = onLocaleChange((locale) => seen.push(locale));
    expect(getLocale()).toBe("fr");
    expect(t("language.auto")).toBe("Automatique");
    setLocale("en");
    setLocale("en");
    expect(t("language.auto")).toBe("Automatic");
    stop();
    setLocale("fr");
    expect(seen).toEqual(["en"]);
    expect(translate("en", "language.auto")).toBe("Automatic");
  });

  it("keywords are searchable in every language", () => {
    const key = Object.keys(CATALOGS.fr).find((k) => k.endsWith("newTabKeywords")) as MessageKey;
    expect(keywords(key)).toEqual(expect.arrayContaining(["ouvrir", "new tab", "open"]));
    expect(isMessageKey(key)).toBe(true);
    expect(isMessageKey("nope")).toBe(false);
  });
});

describe("Intl helpers", () => {
  it("format in the current language", () => {
    const date = new Date(2026, 0, 15, 14, 5);
    expect(formatDate(date, { day: "numeric", month: "long" })).toBe("15 janvier");
    setLocale("en");
    expect(intlLocale()).toBe("en-US");
    expect(formatDate(date, { day: "numeric", month: "long" })).toBe("January 15");
    expect(formatNumber(0.5, { style: "percent" })).toBe("50%");
    expect(formatList(["a", "b", "c"])).toBe("a, b, and c");
    expect(formatRelativeTime(Date.now() - 5 * 60_000)).toBe("5 minutes ago");
    expect(formatList(["a", "b"], "conjunction", "fr")).toBe("a et b");
  });
});
