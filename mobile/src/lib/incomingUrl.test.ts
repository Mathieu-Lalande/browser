import { createIncomingLinkHandler, incomingPageUrl } from "./incomingUrl";

describe("incomingPageUrl", () => {
  it("keeps http and https links", () => {
    expect(incomingPageUrl("https://example.com/a?b=1#c")).toBe("https://example.com/a?b=1#c");
    expect(incomingPageUrl("http://example.com")).toBe("http://example.com/");
    expect(incomingPageUrl("  HTTPS://Example.com/x  ")).toBe("https://example.com/x");
  });

  it("unwraps the app's own open link", () => {
    expect(incomingPageUrl(`browser-mobile://open?url=${encodeURIComponent("https://a.fr/p?q=1")}`)).toBe("https://a.fr/p?q=1");
    expect(incomingPageUrl("browser-mobile:///open?url=https%3A%2F%2Fa.fr")).toBe("https://a.fr/");
  });

  it("ignores everything else", () => {
    for (const raw of [
      null,
      undefined,
      "",
      "not a url",
      "javascript:alert(1)",
      "data:text/html,<h1>x</h1>",
      "file:///etc/passwd",
      "about:blank",
      "exp+browser-mobile://expo-development-client/?url=http%3A%2F%2F10.0.0.2%3A8081",
      "browser-mobile://settings",
      "browser-mobile://open",
      `browser-mobile://open?url=${encodeURIComponent("javascript:alert(1)")}`,
      `browser-mobile://open?url=${encodeURIComponent("browser-mobile://open?url=https://a.fr")}`,
    ]) {
      expect(incomingPageUrl(raw)).toBeNull();
    }
  });
});

describe("createIncomingLinkHandler", () => {
  it("opens the cold-start link once and every later link", () => {
    const opened: string[] = [];
    const handler = createIncomingLinkHandler((url) => opened.push(url));
    handler.initial("https://a.fr/");
    handler.initial("https://a.fr/");
    handler.event("https://b.fr/");
    handler.event("javascript:void 0");
    handler.event("https://b.fr/");
    expect(opened).toEqual(["https://a.fr/", "https://b.fr/", "https://b.fr/"]);
  });

  it("ignores a cold start without a link", () => {
    const opened: string[] = [];
    const handler = createIncomingLinkHandler((url) => opened.push(url));
    handler.initial(null);
    handler.initial("https://late.fr/");
    expect(opened).toEqual([]);
  });
});
