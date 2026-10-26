import { describe, expect, it } from "vitest";
import { acceptLanguages, chromeMajor, normalizeBrandList, normalizeClientHints, reduceUserAgent } from "./fingerprint";

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

describe("client hints", () => {
  const chromium = `"Not?A_Brand";v="24", "Chromium";v="152"`;

  it("passes Chromium's own brand list through untouched", () => {
    expect(normalizeBrandList(chromium, "Browser")).toBe(chromium);
  });

  it("removes brands naming Electron or the app", () => {
    expect(normalizeBrandList(`"Not?A_Brand";v="24", "Electron";v="44", "Chromium";v="152"`, "Browser")).toBe(chromium);
    expect(normalizeBrandList(`"Browser";v="0.2.0.0", "Chromium";v="152.0.7977.167"`, "Browser")).toBe(`"Chromium";v="152.0.7977.167"`);
  });

  it("falls back to a plain Chromium brand when nothing is left", () => {
    expect(normalizeBrandList(`"Electron";v="44"`, "Browser", "152")).toBe(`"Chromium";v="152"`);
    expect(normalizeBrandList("garbage", "Browser")).toBe("");
  });

  it("normalizes Sec-CH-UA headers whatever their case, and leaves other headers alone", () => {
    const headers = {
      "sec-ch-ua": `"Electron";v="44", "Chromium";v="152"`,
      "Sec-CH-UA-Full-Version-List": `"Chromium";v="152.0.7977.167", "electron";v="44.9.3"`,
      "sec-ch-ua-platform": `"Linux"`,
      Accept: "*/*",
    };
    expect(normalizeClientHints(headers, "Browser")).toEqual({
      "sec-ch-ua": `"Chromium";v="152"`,
      "Sec-CH-UA-Full-Version-List": `"Chromium";v="152.0.7977.167"`,
      "sec-ch-ua-platform": `"Linux"`,
      Accept: "*/*",
    });
    // Untouched input: same object, no copy.
    const clean = { "sec-ch-ua": chromium, Accept: "*/*" };
    expect(normalizeClientHints(clean, "Browser")).toBe(clean);
  });

  it("drops a brand header that would be empty", () => {
    expect(normalizeClientHints({ "sec-ch-ua": `"Electron";v="44"` }, "Browser")).toEqual({});
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
