import { describe, expect, it } from "vitest";
import { internalPageOf, internalUrl, isInternalUrl } from "./internal";
import { isNavigableUrl, normalizeInput } from "./url";

describe("internal pages", () => {
  it.each(["browser://settings", "BROWSER://Settings", "browser://settings/", "  browser://settings "])("recognizes %j", (input) => {
    expect(internalPageOf(input)).toBe("settings");
    expect(normalizeInput(input)).toBe(internalUrl("settings"));
  });

  it.each(["browser://unknown", "browser://settings/../x", "browser://settings?x=1", "browser:settings", "https://settings", "settings"])(
    "does not open %j as an internal page",
    (input) => {
      expect(internalPageOf(input)).toBeNull();
      expect(normalizeInput(input)).not.toMatch(/^browser:/);
    },
  );

  it("searches for unknown internal URLs, like any unsupported scheme", () => {
    expect(normalizeInput("browser://nope")).toBe(`https://duckduckgo.com/?q=${encodeURIComponent("browser://nope")}`);
  });

  it.each(["browser://settings", "BROWSER://settings", "browser:settings", "browser://settings/", "browser://anything"])(
    "web pages can never load %j (not a navigable scheme)",
    (url) => {
      // `isNavigableUrl` gates will-navigate, will-redirect and window.open in security.ts.
      expect(isNavigableUrl(url)).toBe(false);
      expect(isInternalUrl(url)).toBe(true);
    },
  );

  it("only flags the browser: scheme as internal", () => {
    expect(isInternalUrl("https://example.com/browser://settings")).toBe(false);
    expect(isInternalUrl("")).toBe(false);
  });
});
