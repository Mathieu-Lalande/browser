import { webHostname } from "@shared/hosts";
import { displayUrl } from "@shared/url";

/** Small helpers to present a site without a screenshot: label, monogram, hue, favicon. */

/** "www.example.co.uk" → "example.co.uk"; empty for non-web URLs. */
export function siteHost(url: string): string {
  return webHostname(url).replace(/^www\./, "");
}

/** What the collapsed address bar shows: the domain, or a short form of other URLs. */
export function siteLabel(url: string): string {
  if (!url) return "";
  const host = siteHost(url);
  if (host) return host;
  if (/^data:/i.test(url)) return "data:";
  return displayUrl(url).slice(0, 40);
}

/** First letter of the site's name ("github.com" → "G"). */
export function monogram(url: string, title = ""): string {
  const host = siteHost(url);
  const name = host ? host.split(".").find((part) => part.length > 2 && !/^(m|mobile|amp)$/.test(part)) ?? host : title;
  const letter = [...(name || "?")].find((char) => /[\p{L}\p{N}]/u.test(char));
  return (letter ?? "?").toUpperCase();
}

/** A stable hue (0…359) per host, to tint cards and monograms. */
export function siteHue(url: string): number {
  const host = siteHost(url) || url;
  let hash = 2166136261;
  for (let i = 0; i < host.length; i++) {
    hash ^= host.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash) % 360;
}

/**
 * The site's own `/favicon.ico` (fetched from the site being visited, never from a third-party
 * favicon service). Null for non-web URLs; callers fall back to the monogram on error.
 */
export function faviconUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    return `${parsed.protocol}//${parsed.host}/favicon.ico`;
  } catch {
    return null;
  }
}

/** French greeting for the start page. */
export function greeting(hour: number): string {
  if (hour >= 5 && hour < 12) return "Bonjour";
  if (hour >= 12 && hour < 18) return "Bon après-midi";
  if (hour >= 18 && hour < 23) return "Bonsoir";
  return "Bonne nuit";
}
