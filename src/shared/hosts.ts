/** Hostname helpers shared by HTTPS-Only, shields and permission prompts. Pure: no Electron. */

/** `URL.hostname` keeps IPv6 brackets ("[::1]"): strip them and lowercase. */
function bare(hostname: string): string {
  return hostname.toLowerCase().replace(/^\[(.*)\]$/, "$1");
}

function ipv4(hostname: string): number[] | null {
  const parts = hostname.split(".");
  if (parts.length !== 4 || !parts.every((part) => /^\d{1,3}$/.test(part))) return null;
  const bytes = parts.map(Number);
  return bytes.every((byte) => byte <= 255) ? bytes : null;
}

/** localhost, *.localhost, 127.0.0.0/8 and ::1: the machine itself. */
export function isLoopbackHost(hostname: string): boolean {
  const host = bare(hostname);
  if (host === "localhost" || host.endsWith(".localhost") || host === "::1") return true;
  return ipv4(host)?.[0] === 127;
}

/**
 * Hosts that are not on the public internet and usually only speak http (routers, NAS, dev servers):
 * loopback, mDNS `*.local`, single-label intranet names, private/link-local IPv4 and IPv6 ranges.
 */
export function isLocalHost(hostname: string): boolean {
  const host = bare(hostname);
  if (!host) return false;
  if (isLoopbackHost(host) || host.endsWith(".local")) return true;
  const ip = ipv4(host);
  if (ip) {
    const [a, b] = ip;
    return a === 0 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
  }
  // fc00::/7 (unique local) and fe80::/10 (link-local).
  if (host.includes(":")) return /^f[cd]/.test(host) || /^fe[89ab]/.test(host);
  return !host.includes(".");
}

/** Hostname of an http(s) URL, or "" for anything else (start page, about:, data:…). */
export function webHostname(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? bare(parsed.hostname) : "";
  } catch {
    return "";
  }
}

/** Origins allowed to ask for permissions: https, or http on the local machine (secure contexts). */
export function isTrustworthyOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return url.protocol === "https:" || (url.protocol === "http:" && isLoopbackHost(url.hostname));
  } catch {
    return false;
  }
}
