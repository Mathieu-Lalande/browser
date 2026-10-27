import { describe, expect, it } from "vitest";
import { isThirdPartyRequest, registrableDomain, stripsCookies, withoutHeaders } from "./domains";

const on = { blockThirdPartyCookies: true, thirdPartyCookieExceptions: [] as string[] };

describe("sites and third-party cookies", () => {
  it("groups hosts by registrable domain", () => {
    expect(registrableDomain("www.example.co.uk")).toBe("example.co.uk");
    expect(registrableDomain(".accounts.example.com")).toBe("example.com");
    expect(registrableDomain("127.0.0.1")).toBe("127.0.0.1");
    expect(registrableDomain("localhost")).toBe("localhost");
  });

  it("tells third-party requests apart", () => {
    expect(isThirdPartyRequest("https://cdn.example.com/a.js", "https://www.example.com/", "script")).toBe(false);
    expect(isThirdPartyRequest("https://tracker.net/p.gif", "https://www.example.com/", "image")).toBe(true);
    expect(isThirdPartyRequest("https://tracker.net/", "https://www.example.com/", "mainFrame")).toBe(false);
    expect(isThirdPartyRequest("http://localhost:1/x", "http://127.0.0.1:1/", "image")).toBe(true);
  });

  it("strips cookies only when blocking is on and the page is not an exception", () => {
    expect(stripsCookies("https://tracker.net/", "https://example.com/", "image", on)).toBe(true);
    expect(stripsCookies("https://tracker.net/", "https://example.com/", "image", { ...on, blockThirdPartyCookies: false })).toBe(false);
    expect(stripsCookies("https://tracker.net/", "https://www.example.com/", "subFrame", { ...on, thirdPartyCookieExceptions: ["example.com"] })).toBe(false);
    expect(withoutHeaders({ Cookie: "a=1", Accept: "*/*" }, ["cookie"])).toEqual({ Accept: "*/*" });
  });
});
