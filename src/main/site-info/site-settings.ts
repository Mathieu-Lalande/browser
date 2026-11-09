import { hostInSite } from "@shared/site-info";
import {
  buildSiteSettings,
  hasSiteSettings,
  resetSitePatch,
  siteListPatch,
  type SiteListSetting,
  type SiteSettingsEntry,
} from "@shared/site-settings";
import type { PermissionKind } from "@shared/types";
import { forgetProfilePermission, profilePermissionDecisions, setHostShields, shieldsDisabledHosts } from "../privacy";
import { profile } from "../profile";
import { settings, updateSettings } from "../settings";
import { BROWSER_PAGES_ZOOM, rememberSiteZoom } from "../zoom";
import { registrableDomain } from "./domains";

/**
 * `browser://site-settings` (ADR-046): the profile's per-site decisions gathered from their stores
 * (permissions, zoom, shields, the privacy settings' site lists). Never from or for a private
 * window: its decisions live in memory and go with it (the IPC table refuses changes there).
 */

const factorOfDefault = () => settings().appearance.pageZoom / 100;

export function listSiteSettings(): SiteSettingsEntry[] {
  const zoom = { ...profile().zoom.toJSON() };
  delete zoom[BROWSER_PAGES_ZOOM];
  return buildSiteSettings(
    { permissions: profilePermissionDecisions(), zoom, shieldsOff: shieldsDisabledHosts(), privacy: settings().privacy },
    registrableDomain,
  ).filter(hasSiteSettings);
}

/** Turns one of the site's switches (JavaScript off, muted, banners left alone, third-party cookies allowed). */
export function setSiteSwitch(site: string, key: SiteListSetting, on: boolean): SiteSettingsEntry[] {
  updateSettings({ privacy: siteListPatch(settings().privacy, key, site, on) });
  return listSiteSettings();
}

export async function setSiteShields(host: string, enabled: boolean): Promise<SiteSettingsEntry[]> {
  await setHostShields(host, enabled);
  return listSiteSettings();
}

/** Back to the default zoom on a host. */
export function resetSiteZoom(host: string): SiteSettingsEntry[] {
  const factor = factorOfDefault();
  rememberSiteZoom(`https://${host}/`, factor, factor);
  return listSiteSettings();
}

export async function forgetSitePermissionDecision(origin: string, kind: PermissionKind, topOrigin: string): Promise<SiteSettingsEntry[]> {
  await forgetProfilePermission(origin, kind, topOrigin);
  return listSiteSettings();
}

/** "Réinitialiser": every decision on the site forgotten. */
export async function resetSite(site: string): Promise<SiteSettingsEntry[]> {
  const entry = listSiteSettings().find((item) => item.site === site);
  if (entry) {
    await Promise.allSettled([
      ...entry.permissions.map((permission) => forgetProfilePermission(permission.origin, permission.kind, permission.topOrigin)),
      ...entry.shieldsOff.map((host) => setHostShields(host, true)),
    ]);
    const factor = factorOfDefault();
    for (const { host } of entry.zoom) if (hostInSite(host, site)) rememberSiteZoom(`https://${host}/`, factor, factor);
    updateSettings({ privacy: resetSitePatch(settings().privacy, site) });
  }
  return listSiteSettings();
}
