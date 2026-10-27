import { webHostname } from "@shared/hosts";

/**
 * Site info sheet (tap on the lock, ADR-021). react-native-webview has no per-site cookie or
 * storage API, and `@react-native-cookies/cookies` (native) is not in Expo Go: the sheet shows the
 * connection, and "Effacer les données du site" runs a script in the page that clears what the page
 * itself can reach — its storage and its cookies visible to scripts. HttpOnly cookies stay.
 */

export interface MobileSiteInfo {
  host: string;
  secure: boolean;
}

/** Host and connection of a web page; null for the start page and non-web URLs. */
export function mobileSiteInfo(url: string): MobileSiteInfo | null {
  const host = webHostname(url);
  return host ? { host, secure: url.toLowerCase().startsWith("https:") } : null;
}

export function connectionLabel(info: MobileSiteInfo): string {
  return info.secure ? "Connexion sécurisée (HTTPS)" : "Connexion non sécurisée (HTTP)";
}

export const SITE_DATA_NOTE =
  "Effacer les données du site vide son stockage et ses cookies accessibles aux pages, puis recharge la page. " +
  "Les cookies protégés (HttpOnly) ne peuvent pas être effacés site par site dans cette version de l'application.";

/**
 * Clears the page's own data from inside it: localStorage, sessionStorage, IndexedDB, Cache
 * Storage and every cookie scripts can see (expired for each path and parent domain), then
 * reloads. Ends with `true` as react-native-webview requires.
 */
export const CLEAR_SITE_DATA_SCRIPT = `(() => {
  try { localStorage.clear(); } catch (e) {}
  try { sessionStorage.clear(); } catch (e) {}
  const host = location.hostname;
  const labels = host.split(".");
  const domains = [""];
  for (let i = 0; i < labels.length - 1; i++) domains.push("; domain=." + labels.slice(i).join("."));
  const segments = location.pathname.split("/").filter(Boolean);
  const paths = ["/"];
  for (let i = 1; i <= segments.length; i++) paths.push("/" + segments.slice(0, i).join("/"));
  for (const pair of document.cookie.split(";")) {
    const name = pair.split("=")[0].trim();
    if (!name) continue;
    for (const domain of domains) for (const path of paths) document.cookie = name + "=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=" + path + domain;
  }
  const pending = [];
  try { if (indexedDB.databases) pending.push(indexedDB.databases().then((dbs) => dbs.forEach((db) => db.name && indexedDB.deleteDatabase(db.name)))); } catch (e) {}
  try { if (window.caches) pending.push(caches.keys().then((keys) => Promise.all(keys.map((key) => caches.delete(key))))); } catch (e) {}
  Promise.allSettled(pending).then(() => location.reload());
})();
true;`;
