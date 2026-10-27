import { describe, expect, it } from "vitest";
import { SEARCH_ENGINES, displayUrl, isNavigableUrl, isPageOpenableUrl, normalizeInput } from "./url";

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
    ["about:blank", "about:blank"],
    ["example.com:8443", "https://example.com:8443/"],
    // Private, mDNS and loopback hosts usually only speak http.
    ["192.168.1.1", "http://192.168.1.1/"],
    ["10.0.0.2:8080/admin", "http://10.0.0.2:8080/admin"],
    ["nas.local", "http://nas.local/"],
    ["app.localhost", "http://app.localhost/"],
    ["[fd00::1]", "http://[fd00::1]/"],
    ["8.8.8.8", "https://8.8.8.8/"],
    // A final dot (fully qualified name) is kept.
    ["localhost.:3000", "http://localhost.:3000/"],
    ["example.com.", "https://example.com./"],
    ["nas.local.", "http://nas.local./"],
    // A single-label name with a port: an intranet machine or a dev server.
    ["devbox:3000", "http://devbox:3000/"],
    ["devbox:3000/path", "http://devbox:3000/path"],
  ])("%j → %j", (input, expected) => {
    expect(normalizeInput(input)).toBe(expected);
  });

  it.each(["hello world", "typescript", "what is 1.5", "file:///etc/passwd", "javascript:alert(1)", "foo.bar1", "foo:bar", "devbox:port", "a.:b", "."])(
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

describe("isPageOpenableUrl", () => {
  it("lets pages open web pages and about:blank only, never top-level data: (audit MEDIUM-1)", () => {
    expect(isPageOpenableUrl("https://a.com/x")).toBe(true);
    expect(isPageOpenableUrl("http://127.0.0.1:8080/")).toBe(true);
    expect(isPageOpenableUrl("about:blank")).toBe(true);
    expect(isPageOpenableUrl("ABOUT:BLANK")).toBe(true);
    expect(isPageOpenableUrl("data:text/html,<h1>phish</h1>")).toBe(false);
    expect(isPageOpenableUrl("about:srcdoc")).toBe(false);
    expect(isPageOpenableUrl("about:blank#x")).toBe(false);
    expect(isPageOpenableUrl("app://browser/index.html")).toBe(false);
    expect(isPageOpenableUrl("browser://settings")).toBe(false);
    expect(isPageOpenableUrl("javascript:alert(1)")).toBe(false);
    expect(isPageOpenableUrl("file:///etc/passwd")).toBe(false);
    expect(isPageOpenableUrl("nonsense")).toBe(false);
  });

  it("is stricter than isNavigableUrl, which still accepts typed data: URLs", () => {
    expect(isNavigableUrl("data:text/html,hi")).toBe(true);
    expect(isNavigableUrl("app://browser/index.html")).toBe(false);
  });
});

describe("displayUrl", () => {
  it("strips scheme and www", () => {
    expect(displayUrl("https://www.example.com/")).toBe("example.com");
    expect(displayUrl("https://example.com/docs")).toBe("example.com/docs");
    expect(displayUrl("")).toBe("");
  });
});
