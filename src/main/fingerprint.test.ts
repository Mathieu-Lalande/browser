import { describe, expect, it } from "vitest";
import { acceptLanguages, brandHeader, chromeBrands, chromeMajor, chromeVersion, mobileUserAgent, normalizeClientHints, reduceUserAgent } from "./fingerprint";

const ELECTRON_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) browser/0.2.0 Chrome/152.0.7977.167 Electron/44.9.3 Safari/537.36";

describe("reduceUserAgent", () => {
  it("drops Electron and the app name, and reduces the Chrome version like Chrome does", () => {
    expect(reduceUserAgent(ELECTRON_UA, "Browser")).toBe(
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36",
    );
  });

  it("keeps an already clean user agent as is", () => {
    const chrome = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36";
    expect(reduceUserAgent(chrome, "Browser")).toBe(chrome);
    expect(chromeMajor(chrome)).toBe("152");
  });

  it("only removes whole product tokens", () => {
    const ua = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.1.2 Safari/537.36 Electron/40.0.0";
    expect(reduceUserAgent(ua, "My Browser!")).toBe(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
    );
    expect(reduceUserAgent(ua, "My Browser!")).not.toMatch(/electron/i);
  });
});

describe("mobileUserAgent", () => {
  it("turns the desktop Chrome user agent into Chrome on Android", () => {
    const desktop = reduceUserAgent(ELECTRON_UA, "Browser");
    expect(mobileUserAgent(desktop)).toBe(
      "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Mobile Safari/537.36",
    );
    expect(mobileUserAgent(mobileUserAgent(desktop))).toBe(mobileUserAgent(desktop));
  });
});

describe("client hints", () => {
  const chrome = chromeVersion("152.0.7977.167");

  it("builds Google Chrome's brand list, GREASE brand and order included", () => {
    // Known Chrome values: 120 and 131 (ordering and GREASE derive from the major version).
    expect(brandHeader(chromeBrands(chromeVersion("120.0.6099.71")))).toBe(`"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"`);
    expect(brandHeader(chromeBrands(chromeVersion("131.0.6778.86")))).toBe(`"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"`);
    expect(brandHeader(chromeBrands(chromeVersion("131.0.6778.86"), true))).toBe(
      `"Google Chrome";v="131.0.6778.86", "Chromium";v="131.0.6778.86", "Not_A Brand";v="24.0.0.0"`,
    );
  });

  it("replaces Sec-CH-UA headers whatever their case, and leaves other headers alone", () => {
    const headers = {
      "sec-ch-ua": `"Electron";v="44", "Chromium";v="152"`,
      "Sec-CH-UA-Full-Version-List": `"Chromium";v="152.0.7977.167", "electron";v="44.9.3"`,
      "sec-ch-ua-platform": `"Linux"`,
      Accept: "*/*",
    };
    const result = normalizeClientHints(headers, chrome);
    expect(result).toEqual({
      "sec-ch-ua": brandHeader(chromeBrands(chrome)),
      "Sec-CH-UA-Full-Version-List": brandHeader(chromeBrands(chrome, true)),
      "sec-ch-ua-platform": `"Linux"`,
      Accept: "*/*",
    });
    expect(JSON.stringify(result)).not.toMatch(/electron|browser/i);
    expect(result["sec-ch-ua"]).toContain(`"Google Chrome";v="152"`);
  });

  it("returns the same object when there is nothing to change, and never adds a header", () => {
    const clean = { "sec-ch-ua": brandHeader(chromeBrands(chrome)), Accept: "*/*" };
    expect(normalizeClientHints(clean, chrome)).toBe(clean);
    const none = { Accept: "*/*" };
    expect(normalizeClientHints(none, chrome)).toBe(none);
  });
});

describe("acceptLanguages", () => {
  it("uses the app locale unless normalized to the most common list", () => {
    expect(acceptLanguages(false, "fr-FR")).toBe("fr-FR");
    expect(acceptLanguages(true, "fr-FR")).toBe("en-US,en");
  });

  it("never passes a malformed locale through", () => {
    expect(acceptLanguages(false, "fr-FR,evil;q=1")).toBe("en-US");
    expect(acceptLanguages(false, "")).toBe("en-US");
  });
});
