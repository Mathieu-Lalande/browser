import type { PermissionKind } from "./types";

/**
 * Site information (ADR-021): what the site info popover and the "Données des sites" settings
 * section show. Pure types and helpers (no Electron, no DOM): shared with the mobile app.
 */

/** The server certificate Chromium verified for the page's host (see `src/main/site-info/`). */
export interface CertificateInfo {
  subject: string;
  issuer: string;
  /** Epoch milliseconds. */
  validFrom: number;
  validTo: number;
  /** SHA-256 fingerprint, as Chromium gives it (`sha256/<base64>`). */
  fingerprint: string;
}

/** A permission decision that applies on the site (as the top-level page). */
export interface SitePermission {
  /** The origin that asked: the site itself, or a frame embedded in it. */
  origin: string;
  kind: PermissionKind;
  decision: "allow" | "deny";
  /** Saved in the profile ("Se souvenir"), as opposed to kept until the browser quits. */
  remembered: boolean;
}

export type SiteConnection = "https" | "http" | "other";

export interface SiteInfo {
  url: string;
  host: string;
  origin: string;
  /** Registrable domain ("example.co.uk" for "www.example.co.uk"); the host itself for IPs and local names. */
  site: string;
  connection: SiteConnection;
  /** Null when unknown (plain http, or the connection was set up before it could be recorded). */
  certificate: CertificateInfo | null;
  /** Cookies of the site (registrable domain) in the tab's session. */
  cookies: number;
  permissions: SitePermission[];
  shieldsEnabled: boolean;
  blockedCount: number;
  /** Page zoom in %, and the default zoom it can be reset to. */
  zoom: number;
  defaultZoom: number;
  /** A private window: its own in-memory session, nothing it changes is written to the profile. */
  isPrivate: boolean;
  /** "Bloquer les cookies tiers" is on, and whether this site is an exception to it. */
  thirdPartyCookies: { blocking: boolean; allowedHere: boolean };
}

/** One registrable domain with cookies, in the settings' site data list. */
export interface SiteDataEntry {
  site: string;
  cookies: number;
}

/** Most third-party cookie exceptions kept (settings validator). */
export const MAX_COOKIE_EXCEPTIONS = 500;

/** A lowercase hostname or registrable domain, as typed in or derived from a URL ("a.example.com", "127.0.0.1"). */
export function isSiteName(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 253 &&
    /^[a-z\d](?:[a-z\d-]*[a-z\d])?(?:\.[a-z\d](?:[a-z\d-]*[a-z\d])?)*$/.test(value)
  );
}

/** Settings validator: a deduplicated, sorted list of site names (anything else is dropped). */
export function sanitizeSiteList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const sites = new Set(value.map((item) => (typeof item === "string" ? item.trim().toLowerCase() : "")).filter(isSiteName));
  return [...sites].sort().slice(0, MAX_COOKIE_EXCEPTIONS);
}

/** Whether `host` belongs to `site` (the site itself, or one of its subdomains). */
export function hostInSite(host: string, site: string): boolean {
  const bare = host.toLowerCase().replace(/^\./, "");
  return bare === site || bare.endsWith(`.${site}`);
}

/** Sites whose name contains the query (case-insensitive), in the list's order. */
export function filterSites<T extends { site: string }>(entries: readonly T[], query: string): T[] {
  const needle = query.trim().toLowerCase();
  return needle ? entries.filter((entry) => entry.site.includes(needle)) : [...entries];
}

/** "1 cookie", "3 cookies". */
export function cookieCount(count: number): string {
  return `${count} cookie${count > 1 ? "s" : ""}`;
}

/** French names of the permissions, for the site info popover. */
export const PERMISSION_LABELS: Record<PermissionKind, string> = {
  camera: "Caméra",
  microphone: "Micro",
  geolocation: "Position",
  notifications: "Notifications",
  midi: "Appareils MIDI",
  "midi-sysex": "Appareils MIDI (contrôle complet)",
  "clipboard-read": "Lecture du presse-papiers",
  "display-capture": "Capture d'écran",
  "idle-detection": "Détection d'inactivité",
  "window-management": "Gestion des fenêtres",
  "storage-access": "Accès au stockage",
  "local-fonts": "Polices installées",
};
