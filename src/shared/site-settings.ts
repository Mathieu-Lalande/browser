import type { PrivacySettings } from "./settings";
import { isSiteName } from "./site-info";
import type { PermissionKind } from "./types";

/**
 * `browser://site-settings` (ADR-046): every per-site decision in one place, grouped by site
 * (registrable domain). Pure: main gathers the stores, this module groups and edits.
 */

/** Per-site switches kept as site lists in the privacy settings. */
export const SITE_LIST_SETTINGS = {
  javascript: "javascriptBlockedSites",
  muted: "mutedSites",
  cookieBanners: "cookieBannerExceptions",
  thirdPartyCookies: "thirdPartyCookieExceptions",
} as const satisfies Record<string, keyof PrivacySettings>;
export type SiteListSetting = keyof typeof SITE_LIST_SETTINGS;

export const isSiteListSetting = (value: unknown): value is SiteListSetting => typeof value === "string" && Object.hasOwn(SITE_LIST_SETTINGS, value);

export interface SitePermissionDecision {
  /** The origin that asked (the site itself, or a frame embedded in it). */
  origin: string;
  /** The top-level page it was decided on. */
  topOrigin: string;
  kind: PermissionKind;
  decision: "allow" | "deny";
}

export interface SiteSettingsEntry {
  site: string;
  permissions: SitePermissionDecision[];
  /** Hosts of the site zoomed by hand, in %. */
  zoom: { host: string; zoom: number }[];
  /** Hosts of the site where the shields are off. */
  shieldsOff: string[];
  /** In the site lists (`SITE_LIST_SETTINGS`): JavaScript off, muted, banners left alone, third-party cookies allowed. */
  javascript: boolean;
  muted: boolean;
  cookieBanners: boolean;
  thirdPartyCookies: boolean;
}

export interface SiteSettingsSources {
  permissions: readonly SitePermissionDecision[];
  /** Host → zoom factor (only the hosts zoomed by hand). */
  zoom: Readonly<Record<string, number>>;
  shieldsOff: readonly string[];
  privacy: Pick<PrivacySettings, (typeof SITE_LIST_SETTINGS)[SiteListSetting]>;
}

/** The host of an origin (`https://a.b.com:8443` → `a.b.com`), or "". */
export function originHost(origin: string): string {
  const match = /^[a-z][a-z\d+.-]*:\/\/(\[[^\]]+\]|[^/:]+)/i.exec(origin);
  return match ? match[1].toLowerCase() : "";
}

/** Groups every per-site decision by site, alphabetically. `siteOf` maps a host to its registrable domain. */
export function buildSiteSettings(sources: SiteSettingsSources, siteOf: (host: string) => string): SiteSettingsEntry[] {
  const entries = new Map<string, SiteSettingsEntry>();
  const entry = (host: string): SiteSettingsEntry | null => {
    const site = host ? siteOf(host) : "";
    if (!site) return null;
    let known = entries.get(site);
    if (!known) {
      known = { site, permissions: [], zoom: [], shieldsOff: [], javascript: false, muted: false, cookieBanners: false, thirdPartyCookies: false };
      entries.set(site, known);
    }
    return known;
  };
  for (const decision of sources.permissions) entry(originHost(decision.topOrigin))?.permissions.push({ ...decision });
  for (const [host, factor] of Object.entries(sources.zoom)) entry(host)?.zoom.push({ host, zoom: Math.round(factor * 100) });
  for (const host of sources.shieldsOff) entry(host)?.shieldsOff.push(host);
  for (const [key, setting] of Object.entries(SITE_LIST_SETTINGS) as [SiteListSetting, (typeof SITE_LIST_SETTINGS)[SiteListSetting]][]) {
    for (const site of sources.privacy[setting]) {
      const found = entry(site);
      if (found) found[key] = true;
    }
  }
  return [...entries.values()].sort((a, b) => a.site.localeCompare(b.site));
}

/** The privacy settings patch that turns a site's switch on or off. */
export function siteListPatch(
  privacy: SiteSettingsSources["privacy"],
  key: SiteListSetting,
  site: string,
  on: boolean,
): Partial<PrivacySettings> {
  const setting = SITE_LIST_SETTINGS[key];
  const others = privacy[setting].filter((item) => item !== site);
  return { [setting]: on && isSiteName(site) ? [...others, site].sort() : others };
}

/** The patch that removes a site from every site list ("Réinitialiser"). */
export function resetSitePatch(privacy: SiteSettingsSources["privacy"], site: string): Partial<PrivacySettings> {
  const patch: Partial<PrivacySettings> = {};
  for (const setting of Object.values(SITE_LIST_SETTINGS)) patch[setting] = privacy[setting].filter((item) => item !== site);
  return patch;
}

/** Whether `site`'s list setting applies to a page of `site` (the lists hold registrable domains). */
export const siteListed = (list: readonly string[], site: string) => !!site && list.includes(site);

/** Entries whose site, a host or a permission origin contains the query (case-insensitive). */
export function filterSiteSettings(entries: readonly SiteSettingsEntry[], query: string): SiteSettingsEntry[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...entries];
  return entries.filter(
    (entry) =>
      entry.site.includes(needle) ||
      entry.zoom.some((zoom) => zoom.host.includes(needle)) ||
      entry.shieldsOff.some((host) => host.includes(needle)) ||
      entry.permissions.some((permission) => permission.origin.toLowerCase().includes(needle)),
  );
}

/** Whether an entry still holds anything (an empty one leaves the list). */
export const hasSiteSettings = (entry: SiteSettingsEntry) =>
  entry.permissions.length > 0 || entry.zoom.length > 0 || entry.shieldsOff.length > 0 || entry.javascript || entry.muted || entry.cookieBanners || entry.thirdPartyCookies;
