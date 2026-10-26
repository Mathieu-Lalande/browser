import { describe, expect, it } from "vitest";
import { isLocalHost, isTrustworthyOrigin, webHostname } from "./hosts";
import { HttpsOnly, httpsUpgradeFor, isHttpsUpgradeFailure } from "./https-only";

describe("httpsUpgradeFor", () => {
  const none = new Set<string>();

  it.each([
    ["http://example.com/", "https://example.com/"],
    ["http://example.com/a?b=1#c", "https://example.com/a?b=1#c"],
    ["http://example.com:8080/x", "https://example.com:8080/x"],
    ["http://8.8.8.8/", "https://8.8.8.8/"],
    ["http://sub.example.co.uk/", "https://sub.example.co.uk/"],
  ])("upgrades %j", (url, expected) => {
    expect(httpsUpgradeFor(url, none)).toBe(expected);
  });

  it.each([
    "https://example.com/",
    "http://localhost:3000/",
    "http://app.localhost/",
    "http://127.0.0.1:8080/",
    "http://127.12.0.3/",
    "http://[::1]:5173/",
    "http://printer.local/",
    "http://router/",
    "http://10.0.0.1/",
    "http://172.16.4.2/",
    "http://172.31.255.255/",
    "http://192.168.1.1/",
    "http://169.254.1.1/",
    "http://[fd12::1]/",
    "http://[fe80::1]/",
    "about:blank",
    "data:text/html,hi",
    "not a url",
  ])("leaves %j alone", (url) => {
    expect(httpsUpgradeFor(url, none)).toBeNull();
  });

  it("does not treat public look-alikes as local", () => {
    expect(httpsUpgradeFor("http://172.32.0.1/", none)).toBe("https://172.32.0.1/");
    expect(httpsUpgradeFor("http://192.169.0.1/", none)).toBe("https://192.169.0.1/");
    expect(httpsUpgradeFor("http://localhost.example.com/", none)).toBe("https://localhost.example.com/");
  });

  it("respects per-host exceptions", () => {
    expect(httpsUpgradeFor("http://legacy.example/x", new Set(["legacy.example"]))).toBeNull();
    expect(httpsUpgradeFor("http://other.example/x", new Set(["legacy.example"]))).toBe("https://other.example/x");
  });
});

describe("isHttpsUpgradeFailure", () => {
  it.each([-100, -101, -102, -107, -113, -200, -202, -310, -324])("falls back on %i", (code) => {
    expect(isHttpsUpgradeFailure(code)).toBe(true);
  });
  it.each([-3, -2, -105, -106, -137, -300, -400, 0])("does not fall back on %i", (code) => {
    expect(isHttpsUpgradeFailure(code)).toBe(false);
  });
});

describe("HttpsOnly", () => {
  it("offers the original http URL when the upgraded load fails", () => {
    const https = new HttpsOnly();
    expect(https.upgrade(1, "http://example.com/page")).toBe("https://example.com/page");
    expect(https.fallbackFor(1, "https://example.com/page", -105)).toBeNull();
    expect(https.fallbackFor(2, "https://example.com/page", -107)).toBeNull();
    expect(https.fallbackFor(1, "https://other.com/", -107)).toBeNull();
    expect(https.fallbackFor(1, "https://example.com/page", -107)).toBe("http://example.com/page");
    // Consumed: a second failure is a regular error.
    expect(https.fallbackFor(1, "https://example.com/page", -107)).toBeNull();
  });

  it("forgets upgrades that loaded, and honours exceptions", () => {
    const https = new HttpsOnly();
    https.upgrade(1, "http://example.com/");
    https.clear(1);
    expect(https.fallbackFor(1, "https://example.com/", -107)).toBeNull();
    https.allowHttp("http://example.com/anything");
    expect(https.upgrade(1, "http://example.com/")).toBeNull();
  });
});

describe("hosts", () => {
  it("classifies origins allowed to ask for permissions", () => {
    expect(isTrustworthyOrigin("https://meet.example.com")).toBe(true);
    expect(isTrustworthyOrigin("http://localhost:3000")).toBe(true);
    expect(isTrustworthyOrigin("http://127.0.0.1:8080")).toBe(true);
    expect(isTrustworthyOrigin("http://[::1]")).toBe(true);
    expect(isTrustworthyOrigin("http://example.com")).toBe(false);
    expect(isTrustworthyOrigin("http://192.168.1.1")).toBe(false);
    expect(isTrustworthyOrigin("null")).toBe(false);
    expect(isTrustworthyOrigin("file:///etc")).toBe(false);
  });

  it("extracts web hostnames only", () => {
    expect(webHostname("https://WWW.Example.com/x")).toBe("www.example.com");
    expect(webHostname("http://[::1]:3000/")).toBe("::1");
    expect(webHostname("about:blank")).toBe("");
    expect(webHostname("")).toBe("");
    expect(isLocalHost("")).toBe(false);
  });
});
