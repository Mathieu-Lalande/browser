import { describe, expect, it } from "vitest";
import { SEARCH_ENGINES, displayUrl, isNavigableUrl, normalizeInput } from "./url";

const ddg = (q: string) => `https://duckduckgo.com/?q=${encodeURIComponent(q)}`;

describe("normalizeInput", () => {
  it.each([
    ["", ""],
    ["   ", ""],
    ["example.com", "https://example.com/"],
    ["  example.com/path?q=1 ", "https://example.com/path?q=1"],
    ["sub.domain.co.uk", "https://sub.domain.co.uk/"],
    ["https://example.com", "https://example.com/"],
    ["http://example.com/a", "http://example.com/a"],
    ["localhost:3000", "http://localhost:3000/"],
    ["localhost", "http://localhost/"],
    ["127.0.0.1:8080/x", "http://127.0.0.1:8080/x"],
    ["192.168.1.1", "https://192.168.1.1/"],
    ["about:blank", "about:blank"],
    ["example.com:8443", "https://example.com:8443/"],
  ])("%j → %j", (input, expected) => {
    expect(normalizeInput(input)).toBe(expected);
  });

  it.each(["hello world", "typescript", "what is 1.5", "file:///etc/passwd", "javascript:alert(1)", "foo.bar1"])(
    "searches %j",
    (input) => {
      expect(normalizeInput(input)).toBe(ddg(input));
    },
  );

  it("uses the requested search engine", () => {
    const google = SEARCH_ENGINES.find((engine) => engine.id === "google")!;
    expect(normalizeInput("a b", google)).toBe("https://www.google.com/search?q=a%20b");
  });
});

describe("isNavigableUrl", () => {
  it("accepts web URLs and refuses dangerous schemes", () => {
    expect(isNavigableUrl("https://a.com")).toBe(true);
    expect(isNavigableUrl("file:///etc/passwd")).toBe(false);
    expect(isNavigableUrl("javascript:alert(1)")).toBe(false);
    expect(isNavigableUrl("not a url")).toBe(false);
  });
});

describe("displayUrl", () => {
  it("strips scheme and www", () => {
    expect(displayUrl("https://www.example.com/")).toBe("example.com");
    expect(displayUrl("https://example.com/docs")).toBe("example.com/docs");
    expect(displayUrl("")).toBe("");
  });
});
