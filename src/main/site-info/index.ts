import { session as electronSession, type Cookie, type Session } from "electron";
import { webHostname } from "@shared/hosts";
import { PERMISSION_LABELS, hostInSite, type SiteDataEntry, type SiteInfo } from "@shared/site-info";
import type { PermissionKind, TabId } from "@shared/types";
import { forgetSitePermission, sitePermissions } from "../privacy";
import { settings, updateSettings } from "../settings";
import { spaces } from "../spaces";
import type { BrowserController } from "../window";
import { certificateFor } from "./certificates";
import { registrableDomain } from "./domains";

/**
 * Site info popover and site data management (ADR-021). The chrome UI only names a tab (or, in the
 * settings, a site): URLs and sessions come from main. A tab's info and actions use the tab's own
 * session, so a private window only ever reads and clears its in-memory data.
 */

/** Everything a site may store besides cookies, cleared per origin. */
const STORAGES = ["cookies", "filesystem", "indexdb", "localstorage", "shadercache", "serviceworkers", "cachestorage"] as const;

export const isPermissionKind = (value: unknown): value is PermissionKind => typeof value === "string" && Object.hasOwn(PERMISSION_LABELS, value);

/** The tab (of the space on screen) and its web page's URL, session and site; null for anything but http(s). */
function tabSite(c: BrowserController, tabId: TabId) {
  const tab = c.tabs.getState().tabs.find((item) => item.id === tabId);
  const host = webHostname(tab?.url ?? "");
  if (!tab || !host) return null;
  const ses = c.tabs.pageOf(tabId)?.session ?? c.tabSession;
  return { tab, host, origin: new URL(tab.url).origin, site: registrableDomain(host), ses };
}

/** Cookies of a site (its registrable domain and every subdomain) in `ses`. */
function siteCookies(ses: Session, site: string): Promise<Cookie[]> {
  // `domain` matches the domain itself and its subdomains.
  return ses.cookies.get({ domain: site }).then(
    (cookies) => cookies.filter((cookie) => hostInSite(cookie.domain ?? "", site)),
    () => [],
  );
}

/** The URL a cookie is sent to, which `cookies.remove` needs. */
function cookieUrl(cookie: Cookie): string {
  const host = (cookie.domain ?? "").replace(/^\./, "");
  return `${cookie.secure ? "https" : "http"}://${host}${cookie.path || "/"}`;
}

/**
 * Clears a site's cookies, and the storage of every origin known to belong to it: the hosts its
 * cookies were set for, `origins` (the tab's page) and the site itself, over http and https.
 * Storage of a subdomain that never set a cookie is not reached (limit, ADR-021).
 */
async function clearSite(ses: Session, site: string, origins: readonly string[] = []): Promise<void> {
  const cookies = await siteCookies(ses, site);
  await Promise.allSettled(cookies.map((cookie) => ses.cookies.remove(cookieUrl(cookie), cookie.name)));
  const hosts = new Set([site, `www.${site}`, ...cookies.map((cookie) => (cookie.domain ?? "").replace(/^\./, ""))]);
  const all = new Set([...origins, ...[...hosts].flatMap((host) => [`https://${host}`, `http://${host}`])]);
  await Promise.allSettled([...all].map((origin) => ses.clearStorageData({ origin, storages: [...STORAGES] })));
}

export async function siteInfoFor(c: BrowserController, tabId: TabId): Promise<SiteInfo | null> {
  const found = tabSite(c, tabId);
  if (!found) return null;
  const { tab, host, origin, site, ses } = found;
  const https = tab.url.startsWith("https:");
  const { privacy, appearance } = settings();
  return {
    url: tab.url,
    host,
    origin,
    site,
    connection: https ? "https" : "http",
    certificate: https ? certificateFor(ses, host) : null,
    cookies: (await siteCookies(ses, site)).length,
    permissions: sitePermissions(ses, origin),
    shieldsEnabled: tab.shieldsEnabled,
    blockedCount: tab.blockedCount,
    zoom: tab.zoom,
    defaultZoom: appearance.pageZoom,
    isPrivate: c.isPrivate,
    thirdPartyCookies: { blocking: privacy.blockThirdPartyCookies, allowedHere: privacy.thirdPartyCookieExceptions.includes(site) },
  };
}

/** Forgets a permission decision taken on the tab's site (by the site, or a frame embedded in it). */
export function resetSitePermission(c: BrowserController, tabId: TabId, origin: string, kind: PermissionKind): Promise<SiteInfo | null> {
  const found = tabSite(c, tabId);
  if (found) forgetSitePermission(found.ses, origin, kind, found.origin);
  return siteInfoFor(c, tabId);
}

/** "Effacer les cookies et données du site": the tab's session only, then the tab reloads. */
export async function clearTabSiteData(c: BrowserController, tabId: TabId): Promise<SiteInfo | null> {
  const found = tabSite(c, tabId);
  if (!found) return null;
  await clearSite(found.ses, found.site, [found.origin]);
  c.tabs.reload(tabId);
  return siteInfoFor(c, tabId);
}

/** Makes the tab's site an exception to third-party cookie blocking, or not (a settings change: never from a private window). */
export function allowThirdPartyCookies(c: BrowserController, tabId: TabId, allow: boolean): Promise<SiteInfo | null> {
  const found = tabSite(c, tabId);
  if (found && !c.isPrivate) {
    const current = settings().privacy.thirdPartyCookieExceptions.filter((site) => site !== found.site);
    updateSettings({ privacy: { thirdPartyCookieExceptions: allow ? [...current, found.site] : current } });
  }
  return siteInfoFor(c, tabId);
}

// --- Profile site data (settings) --------------------------------------------------------------

/** The profile's tab sessions: the default one and each isolated space's partition. */
function profileSessions(): Session[] {
  const isolated = spaces.list().map((space) => spaces.sessionFor(space.id)).filter((ses) => ses !== undefined);
  return [electronSession.defaultSession, ...isolated];
}

/** Sites with cookies in the profile, grouped by registrable domain, alphabetical. */
export async function listSiteData(): Promise<SiteDataEntry[]> {
  const counts = new Map<string, number>();
  for (const ses of profileSessions()) {
    const cookies = await ses.cookies.get({}).catch(() => []);
    for (const cookie of cookies) {
      const site = registrableDomain(cookie.domain ?? "");
      if (site) counts.set(site, (counts.get(site) ?? 0) + 1);
    }
  }
  return [...counts].map(([site, cookies]) => ({ site, cookies })).sort((a, b) => a.site.localeCompare(b.site));
}

export async function removeSiteData(site: string): Promise<SiteDataEntry[]> {
  await Promise.allSettled(profileSessions().map((ses) => clearSite(ses, site)));
  return listSiteData();
}

/** "Tout effacer": every cookie and all site storage of the profile (history and bookmarks stay). */
export async function clearAllSiteData(): Promise<SiteDataEntry[]> {
  await Promise.allSettled(profileSessions().map((ses) => ses.clearStorageData()));
  return listSiteData();
}
