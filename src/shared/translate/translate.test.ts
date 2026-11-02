import { describe, expect, it, vi } from "vitest";
import {
  chunkTexts,
  createProvider,
  DeepLProvider,
  EMPTY_RULES,
  fitTranslation,
  GoogleTranslateProvider,
  LibreTranslateProvider,
  normalizeLanguage,
  normalizeServerUrl,
  pageLanguage,
  sanitizeLanguageList,
  sanitizeSegments,
  sanitizeSiteKeys,
  siteOfUrl,
  targetLanguage,
  testTranslation,
  translateDecision,
  TranslationError,
  Translator,
  withAlwaysLanguage,
  withNeverLanguage,
  withNeverSite,
  type HttpRequest,
} from ".";
import { DEFAULT_SETTINGS, sanitizeSettings } from "../settings";

const ok = (body: unknown) => ({ status: 200, body: JSON.stringify(body) });

describe("languages", () => {
  it("reduces tags to their primary subtag", () => {
    expect(normalizeLanguage("en-US")).toBe("en");
    expect(normalizeLanguage(" PT_br ")).toBe("pt");
    expect(normalizeLanguage("zh-Hant-TW")).toBe("zh");
    expect(normalizeLanguage("iw")).toBe("he");
    for (const bad of ["", "x-klingon", "*", "und", "english", 42, null]) expect(normalizeLanguage(bad)).toBeNull();
  });

  it("reads the page's language from <html lang>, else Content-Language", () => {
    expect(pageLanguage({ lang: "de-AT", contentLanguage: "fr" })).toBe("de");
    expect(pageLanguage({ lang: "", contentLanguage: "es-ES, en" })).toBe("es");
    // Nothing declared: the provider will detect it.
    expect(pageLanguage({ lang: "", contentLanguage: "" })).toBeNull();
    expect(pageLanguage({})).toBeNull();
  });

  it("targets the chosen language, else the UI/system one, else French", () => {
    expect(targetLanguage("de", ["en-US"])).toBe("de");
    expect(targetLanguage("", ["", "en-GB", "fr"])).toBe("en");
    expect(targetLanguage("", [])).toBe("fr");
  });

  it("validates language lists", () => {
    expect(sanitizeLanguageList(["en-US", "en", "x-bad", "DE", 7])).toEqual(["de", "en"]);
    expect(sanitizeLanguageList("en")).toBeUndefined();
  });
});

describe("segments", () => {
  it("keeps valid page segments only", () => {
    const raw = [[1, "Hello"], [1, "dup"], [2, "   "], [3, "123 456"], ["4", "x"], [5, "a".repeat(5000)], [6, "World"], "junk"];
    expect(sanitizeSegments(raw)).toEqual([
      { id: 1, text: "Hello" },
      { id: 6, text: "World" },
    ]);
    expect(sanitizeSegments(null)).toEqual([]);
  });

  it("chunks texts by count and characters, a long text alone", () => {
    expect(chunkTexts(["aa", "bb", "cc", "dd", "ee"], 100, 2)).toEqual([
      [0, 2],
      [2, 4],
      [4, 5],
    ]);
    expect(chunkTexts(["aaaa", "bbbb", "cccccccccc", "d"], 9, 10)).toEqual([
      [0, 2],
      [2, 3],
      [3, 4],
    ]);
    expect(chunkTexts([], 10, 10)).toEqual([]);
  });

  it("fits a translation as bounded plain text", () => {
    expect(fitTranslation("Hi", "  Salut\u0007 ")).toBe("Salut");
    expect(fitTranslation("Hi", "")).toBeNull();
    expect(fitTranslation("Hi", 3)).toBeNull();
    expect(fitTranslation("Hi", "x".repeat(500))).toHaveLength(2 * 4 + 64);
    // Markup stays text: the page writes it with nodeValue.
    expect(fitTranslation("bold", "<b>gras</b>")).toBe("<b>gras</b>");
  });
});

describe("providers", () => {
  it("DeepL: request and response", () => {
    const provider = new DeepLProvider("key:fx", "free");
    const request = provider.buildRequest(["Hello", "World"], null, "en");
    expect(request.url).toBe("https://api-free.deepl.com/v2/translate");
    expect(request.headers.authorization).toBe("DeepL-Auth-Key key:fx");
    expect(JSON.parse(request.body)).toEqual({ text: ["Hello", "World"], target_lang: "EN-US" });
    expect(JSON.parse(new DeepLProvider("k", "pro").buildRequest(["Hi"], "de", "fr").body)).toEqual({ text: ["Hi"], target_lang: "FR", source_lang: "DE" });
    expect(new DeepLProvider("k", "pro").endpoint).toBe("https://api.deepl.com/v2/translate");
    const batch = provider.parseResponse(
      ok({ translations: [{ detected_source_language: "DE", text: "Bonjour" }, { detected_source_language: "DE", text: "Monde" }] }),
      2,
    );
    expect(batch).toEqual({ texts: ["Bonjour", "Monde"], detected: "de" });
  });

  it("LibreTranslate: request and both answer shapes", () => {
    const provider = new LibreTranslateProvider("https://lt.example.org/", "secret");
    const request = provider.buildRequest(["Hello"], null, "fr");
    expect(request.url).toBe("https://lt.example.org/translate");
    expect(JSON.parse(request.body)).toEqual({ q: ["Hello"], source: "auto", target: "fr", format: "text", api_key: "secret" });
    expect(JSON.parse(new LibreTranslateProvider("https://lt.example.org", "").buildRequest(["a"], "en", "fr").body)).not.toHaveProperty("api_key");
    expect(provider.parseResponse(ok({ translatedText: ["Bonjour"], detectedLanguage: [{ confidence: 90, language: "en" }] }), 1)).toEqual({
      texts: ["Bonjour"],
      detected: "en",
    });
    expect(provider.parseResponse(ok({ translatedText: "Bonjour", detectedLanguage: { language: "en" } }), 1).texts).toEqual(["Bonjour"]);
    expect(() => provider.parseResponse({ status: 400, body: JSON.stringify({ error: "Invalid API key" }) }, 1)).toThrow("LibreTranslate : Invalid API key");
  });

  it("Google v2: key in a header, plain text format", () => {
    const provider = new GoogleTranslateProvider("g-key");
    const request = provider.buildRequest(["Hello"], "en", "fr");
    expect(request.url).toBe(GoogleTranslateProvider.ENDPOINT);
    expect(request.url).not.toContain("g-key");
    expect(request.headers["x-goog-api-key"]).toBe("g-key");
    expect(JSON.parse(request.body)).toEqual({ q: ["Hello"], target: "fr", format: "text", source: "en" });
    expect(provider.parseResponse(ok({ data: { translations: [{ translatedText: "Bonjour", detectedSourceLanguage: "en" }] } }), 1)).toEqual({
      texts: ["Bonjour"],
      detected: "en",
    });
  });

  it("maps error statuses and malformed answers to French errors", () => {
    const provider = new DeepLProvider("k", "free");
    const kind = (status: number, body = "{}") => {
      try {
        provider.parseResponse({ status, body }, 1);
      } catch (error) {
        return (error as TranslationError).kind;
      }
      return null;
    };
    expect(kind(403)).toBe("auth");
    expect(kind(456)).toBe("quota");
    expect(kind(429)).toBe("rate");
    expect(kind(500)).toBe("server");
    expect(kind(200, "not json")).toBe("invalid");
    // One translation for two texts: refused, not misaligned.
    expect(() => provider.parseResponse(ok({ translations: [{ text: "a" }] }), 2)).toThrow(TranslationError);
  });

  it("creates the configured provider, or says what is missing", () => {
    const base = { apiKey: "", deeplPlan: "free" as const, libreUrl: "" };
    expect(() => createProvider({ ...base, provider: "deepl" })).toThrow(/clé d'API DeepL/);
    expect(() => createProvider({ ...base, provider: "libretranslate" })).toThrow(/serveur LibreTranslate/);
    expect(createProvider({ ...base, provider: "libretranslate", libreUrl: "http://127.0.0.1:5000" }).id).toBe("libretranslate");
    expect(createProvider({ ...base, provider: "google", apiKey: " k " }).id).toBe("google");
  });

  it("accepts http(s) servers without credentials only", () => {
    expect(normalizeServerUrl("https://lt.example.org/")).toBe("https://lt.example.org");
    expect(normalizeServerUrl("http://192.168.1.2:5000")).toBe("http://192.168.1.2:5000");
    for (const bad of ["ftp://x", "https://user:pw@x.org", "https://x.org/?q=1", "javascript:alert(1)", "", 3]) expect(normalizeServerUrl(bad)).toBeNull();
  });
});

describe("translator", () => {
  const upper = vi.fn(async (request: HttpRequest) => {
    const body = JSON.parse(request.body) as { q: string[] };
    return ok({ translatedText: body.q.map((text) => text.toUpperCase()), detectedLanguage: body.q.map(() => ({ language: "en" })) });
  });

  it("translates in chunks, detects, and caches", async () => {
    upper.mockClear();
    const translator = new Translator(new LibreTranslateProvider("https://lt.example.org", ""), upper);
    const texts = Array.from({ length: 120 }, (_, i) => `text ${i}`);
    const result = await translator.translate(texts, null, "fr");
    expect(result.texts[119]).toBe("TEXT 119");
    expect(result.detected).toBe("en");
    expect(upper).toHaveBeenCalledTimes(3);
    // Already translated: no request.
    await translator.translate(["text 3"], null, "fr");
    expect(upper).toHaveBeenCalledTimes(3);
    expect(await testTranslation(translator, "fr")).toBe("HELLO, WORLD!");
  });

  it("turns network failures into a French error", async () => {
    const translator = new Translator(new GoogleTranslateProvider("k"), async () => {
      throw new Error("ECONNREFUSED");
    });
    await expect(translator.translate(["Hello"], null, "fr")).rejects.toMatchObject({ kind: "network" });
  });
});

describe("rules", () => {
  const decide = (pageLanguage: string | null, rules = EMPTY_RULES, site: string | null = "news.example.com") =>
    translateDecision({ pageLanguage, target: "fr", site, rules });

  it("offers other languages, never the target or an unknown one", () => {
    expect(decide("en")).toBe("offer");
    expect(decide("fr")).toBe("none");
    expect(decide(null)).toBe("none");
  });

  it("applies always / never rules, sites with their subdomains", () => {
    expect(decide("en", withAlwaysLanguage(EMPTY_RULES, "en", true))).toBe("auto");
    expect(decide("en", withNeverLanguage(EMPTY_RULES, "en", true))).toBe("none");
    expect(decide("en", withNeverSite(withAlwaysLanguage(EMPTY_RULES, "en", true), "example.com", true))).toBe("none");
    expect(decide("en", withNeverSite(EMPTY_RULES, "example.com", true), "notexample.com")).toBe("offer");
    // "Always" and "never" for a language exclude each other.
    const both = withNeverLanguage(withAlwaysLanguage(EMPTY_RULES, "en", true), "en", true);
    expect(both).toEqual({ alwaysLanguages: [], neverLanguages: ["en"], neverSites: [] });
    expect(withNeverSite(withNeverSite(EMPTY_RULES, "a.org", true), "a.org", false).neverSites).toEqual([]);
  });

  it("keys sites by host without www", () => {
    expect(siteOfUrl("https://www.Example.com/a")).toBe("example.com");
    expect(siteOfUrl("file:///etc")).toBeNull();
    expect(sanitizeSiteKeys(["www.a.org", "a.org", "bad host", ".x"])).toEqual(["a.org"]);
  });
});

describe("settings", () => {
  it("is off by default and validates its fields", () => {
    expect(DEFAULT_SETTINGS.translate.provider).toBe("none");
    const clean = sanitizeSettings({
      translate: { provider: "deepl", libreUrl: "https://lt.example.org/", target: "en-US", alwaysLanguages: ["EN", 4], neverSites: ["www.x.org"] },
    }).translate;
    expect(clean).toMatchObject({ provider: "deepl", libreUrl: "https://lt.example.org", target: "en", alwaysLanguages: ["en"], neverSites: ["x.org"] });
    expect(sanitizeSettings({ translate: { provider: "babelfish", libreUrl: "ftp://x" } }).translate).toMatchObject({ provider: "none", libreUrl: "" });
  });
});
