import { CATALOGS, formatDate, getLocale, setLocale, t } from "@shared/i18n";
import { applyLanguage, systemLanguages } from "./locale";
import { greeting } from "./site";

afterEach(() => setLocale("fr"));

describe("UI language on the phone (ADR-052)", () => {
  it("follows the setting, or the phone's language for auto", () => {
    expect(applyLanguage("en", ["fr-FR"])).toBe("en");
    expect(applyLanguage("fr", ["en-US"])).toBe("fr");
    expect(applyLanguage("auto", ["en-GB"])).toBe("en");
    expect(applyLanguage("auto", ["fr-CA", "en-US"])).toBe("fr");
    expect(applyLanguage("auto", ["de-DE"])).toBe("en");
    expect(Array.isArray(systemLanguages())).toBe(true);
  });

  it("switches the texts of screens, helpers and dates", () => {
    applyLanguage("fr", []);
    expect(t("mobile.settingsScreen.appearance")).toBe("Apparence");
    expect(greeting(9)).toBe("Bonjour");
    expect(formatDate(new Date(2026, 4, 3), { day: "numeric", month: "long" })).toBe("3 mai");
    applyLanguage("en", []);
    expect(getLocale()).toBe("en");
    expect(t("mobile.settingsScreen.appearance")).toBe("Appearance");
    expect(greeting(9)).toBe("Good morning");
    expect(t("mobile.bottomBar.tabs", { tabCount: 3 })).toBe(CATALOGS.en["mobile.bottomBar.tabs"].replace("{tabCount}", "3"));
    expect(formatDate(new Date(2026, 4, 3), { day: "numeric", month: "long" })).toBe("May 3");
  });

  it("has every mobile text in English", () => {
    const mobileKeys = Object.keys(CATALOGS.fr).filter((key) => key.startsWith("mobile."));
    expect(mobileKeys.length).toBeGreaterThan(300);
    for (const key of mobileKeys) expect(CATALOGS.en[key as keyof typeof CATALOGS.en]).toBeTruthy();
  });
});
