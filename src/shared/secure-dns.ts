/**
 * Secure DNS (DNS over HTTPS, ADR-046): the settings' choices and the resolver configuration they
 * give. Pure (no Electron): main hands the result to `app.configureHostResolver`.
 */

export const SECURE_DNS_CHOICES = ["off", "automatic", "cloudflare", "quad9", "nextdns", "custom"] as const;
export type SecureDnsChoice = (typeof SECURE_DNS_CHOICES)[number];

/** Preset providers' DoH templates (RFC 8484), without any user identifier. */
export const DOH_PROVIDERS = {
  cloudflare: { label: "Cloudflare (1.1.1.1)", template: "https://cloudflare-dns.com/dns-query" },
  quad9: { label: "Quad9 (9.9.9.9)", template: "https://dns.quad9.net/dns-query" },
  nextdns: { label: "NextDNS", template: "https://dns.nextdns.io" },
} as const;

/** What `app.configureHostResolver` receives (the subset this app sets). */
export interface HostResolverConfig {
  /**
   * "off": the system's resolver; "automatic": DoH when the system's DNS server is known to offer
   * it, plain DNS otherwise (Chromium's default); "secure": DoH only, to `secureDnsServers`.
   */
  secureDnsMode: "off" | "automatic" | "secure";
  secureDnsServers?: string[];
}

const MAX_TEMPLATE = 512;

/**
 * A valid DoH template, normalized, or null: `https:` only, a host, no credentials nor fragment,
 * an optional `{?dns}` variable (RFC 8484 URI template) and nothing else in braces.
 */
export function normalizeDohTemplate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text || text.length > MAX_TEMPLATE || /\s/.test(text)) return null;
  const withoutVariable = text.replace(/\{\?dns\}$/, "");
  if (/[{}]/.test(withoutVariable)) return null;
  let url: URL;
  try {
    url = new URL(withoutVariable);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || !url.hostname || url.username || url.password || url.hash) return null;
  return text;
}

/** A NextDNS configuration id (6 hexadecimal characters today; up to 16 letters/digits accepted), or null. */
export function normalizeNextDnsId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const id = value.trim().toLowerCase();
  return /^[a-z\d]{1,16}$/.test(id) ? id : null;
}

export interface SecureDnsSettings {
  secureDns: SecureDnsChoice;
  secureDnsCustomUrl: string;
  secureDnsNextDnsId: string;
}

/**
 * The resolver configuration for the settings. A "custom" choice without a valid template falls
 * back to "automatic" (never to a resolver the user did not pick, never to no DNS at all).
 */
export function hostResolverConfig(settings: SecureDnsSettings): HostResolverConfig {
  switch (settings.secureDns) {
    case "off":
      return { secureDnsMode: "off", secureDnsServers: [] };
    case "cloudflare":
    case "quad9":
      return { secureDnsMode: "secure", secureDnsServers: [DOH_PROVIDERS[settings.secureDns].template] };
    case "nextdns": {
      const id = normalizeNextDnsId(settings.secureDnsNextDnsId);
      return { secureDnsMode: "secure", secureDnsServers: [`${DOH_PROVIDERS.nextdns.template}${id ? `/${id}` : ""}`] };
    }
    case "custom": {
      const template = normalizeDohTemplate(settings.secureDnsCustomUrl);
      return template ? { secureDnsMode: "secure", secureDnsServers: [template] } : { secureDnsMode: "automatic", secureDnsServers: [] };
    }
    default:
      return { secureDnsMode: "automatic", secureDnsServers: [] };
  }
}

/** Whether two configurations are the same (main re-applies only on a real change). */
export function sameResolverConfig(a: HostResolverConfig, b: HostResolverConfig): boolean {
  return a.secureDnsMode === b.secureDnsMode && (a.secureDnsServers ?? []).join("\n") === (b.secureDnsServers ?? []).join("\n");
}
