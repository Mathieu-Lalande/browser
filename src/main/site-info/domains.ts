import { Request } from "@ghostery/adblocker";
import { webHostname } from "@shared/hosts";

/**
 * Registrable domains ("sites") and third-party checks, with the public suffix list the content
 * blocker already ships (tldts, through `@ghostery/adblocker`'s `Request`): no second copy.
 */

/** "www.example.co.uk" → "example.co.uk"; IP addresses and single-label names stay as they are. */
export function registrableDomain(host: string): string {
  const bare = host.toLowerCase().replace(/^\./, "").replace(/^\[(.*)\]$/, "$1");
  if (!bare || bare.includes(":")) return bare;
  return Request.fromRawDetails({ url: `https://${bare}/` }).domain || bare;
}

/** The site of an http(s) URL, or "" for anything else. */
export function siteOf(url: string): string {
  const host = webHostname(url);
  return host ? registrableDomain(host) : "";
}

/** Whether a request to `url` made by the page `pageUrl` goes to another site (main frames never do). */
export function isThirdPartyRequest(url: string, pageUrl: string, resourceType: string): boolean {
  if (resourceType === "mainFrame") return false;
  const site = siteOf(url);
  const pageSite = siteOf(pageUrl);
  return !!site && !!pageSite && site !== pageSite;
}

export interface ThirdPartyCookiePolicy {
  blockThirdPartyCookies: boolean;
  thirdPartyCookieExceptions: readonly string[];
}

/**
 * Whether the cookies of a tab's request must be stripped (`Cookie` sent, `Set-Cookie` received):
 * blocking is on, the request goes to another site than the page's, and the page's site is not an
 * exception (ADR-021).
 */
export function stripsCookies(url: string, pageUrl: string, resourceType: string, policy: ThirdPartyCookiePolicy): boolean {
  if (!policy.blockThirdPartyCookies || !isThirdPartyRequest(url, pageUrl, resourceType)) return false;
  return !policy.thirdPartyCookieExceptions.includes(siteOf(pageUrl));
}

/** Request or response headers without the given ones (case-insensitive names). */
export function withoutHeaders<T>(headers: Record<string, T>, names: readonly string[]): Record<string, T> {
  const drop = new Set(names.map((name) => name.toLowerCase()));
  return Object.fromEntries(Object.entries(headers).filter(([name]) => !drop.has(name.toLowerCase())));
}
