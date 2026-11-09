import { describe, expect, it } from "vitest";
import { hostResolverConfig, normalizeDohTemplate, normalizeNextDnsId, sameResolverConfig, type SecureDnsSettings } from "./secure-dns";
import { sanitizeSettings } from "./settings";

const base: SecureDnsSettings = { secureDns: "automatic", secureDnsCustomUrl: "", secureDnsNextDnsId: "" };

describe("secure DNS", () => {
  it("validates DoH templates", () => {
    expect(normalizeDohTemplate(" https://dns.example/dns-query ")).toBe("https://dns.example/dns-query");
    expect(normalizeDohTemplate("https://dns.example/dns-query{?dns}")).toBe("https://dns.example/dns-query{?dns}");
    expect(normalizeDohTemplate("http://dns.example/dns-query")).toBeNull();
    expect(normalizeDohTemplate("https://user:pw@dns.example/")).toBeNull();
    expect(normalizeDohTemplate("https://dns.example/{x}")).toBeNull();
    expect(normalizeDohTemplate("https://dns.example/a b")).toBeNull();
    expect(normalizeDohTemplate("dns.example")).toBeNull();
    expect(normalizeDohTemplate(`https://a.example/${"x".repeat(600)}`)).toBeNull();
    expect(normalizeNextDnsId(" ABC123 ")).toBe("abc123");
    expect(normalizeNextDnsId("abc/123")).toBeNull();
  });

  it("maps each choice to a resolver configuration", () => {
    expect(hostResolverConfig({ ...base, secureDns: "off" })).toEqual({ secureDnsMode: "off", secureDnsServers: [] });
    expect(hostResolverConfig(base)).toEqual({ secureDnsMode: "automatic", secureDnsServers: [] });
    expect(hostResolverConfig({ ...base, secureDns: "cloudflare" })).toEqual({ secureDnsMode: "secure", secureDnsServers: ["https://cloudflare-dns.com/dns-query"] });
    expect(hostResolverConfig({ ...base, secureDns: "quad9" }).secureDnsServers).toEqual(["https://dns.quad9.net/dns-query"]);
    expect(hostResolverConfig({ ...base, secureDns: "nextdns", secureDnsNextDnsId: "abc123" }).secureDnsServers).toEqual(["https://dns.nextdns.io/abc123"]);
    expect(hostResolverConfig({ ...base, secureDns: "nextdns" }).secureDnsServers).toEqual(["https://dns.nextdns.io"]);
    expect(hostResolverConfig({ ...base, secureDns: "custom", secureDnsCustomUrl: "https://doh.example/q" })).toEqual({
      secureDnsMode: "secure",
      secureDnsServers: ["https://doh.example/q"],
    });
    // An invalid custom template never leaves the user without DNS: Chromium's automatic mode.
    expect(hostResolverConfig({ ...base, secureDns: "custom", secureDnsCustomUrl: "ftp://x" }).secureDnsMode).toBe("automatic");
    expect(sameResolverConfig(hostResolverConfig(base), { secureDnsMode: "automatic" })).toBe(true);
  });

  it("is validated in the settings", () => {
    const settings = sanitizeSettings({ privacy: { secureDns: "quad9", secureDnsCustomUrl: "http://bad", secureDnsNextDnsId: "x y" } });
    expect(settings.privacy.secureDns).toBe("quad9");
    expect(settings.privacy.secureDnsCustomUrl).toBe("");
    expect(settings.privacy.secureDnsNextDnsId).toBe("");
    expect(sanitizeSettings({ privacy: { secureDns: "google" } }).privacy.secureDns).toBe("automatic");
  });
});
