import { httpsUpgradeFor } from "@shared/https-only";
import { isNavigableUrl, isPageOpenableUrl } from "@shared/url";

/**
 * Navigation policy for tab WebViews (`onShouldStartLoadWithRequest`), the same rules as the
 * desktop (ADR-003, ADR-007): pages may only load http(s), about: and data:, top-level http is
 * upgraded to https, and a few schemes are handed to the system apps.
 */

/** Schemes opened by the OS (mail, phone, SMS), and only for top-level navigations. */
const EXTERNAL_SCHEMES = new Set(["mailto:", "tel:", "sms:"]);

export type NavigationDecision =
  | { kind: "allow" }
  /** Cancel, then load `url` instead (HTTPS-Only upgrade); `from` is the original http:// URL. */
  | { kind: "upgrade"; url: string; from: string }
  /** Cancel and hand `url` to the system (Linking.openURL). */
  | { kind: "external"; url: string }
  | { kind: "block" };

export function schemeOf(url: string): string {
  const match = /^([a-z][a-z\d+\-.]*):/i.exec(url.trim());
  return match ? `${match[1].toLowerCase()}:` : "";
}

export interface NavigationRequest {
  url: string;
  /** False for iframes (iOS reports it; Android only asks for the main frame). */
  isTopFrame: boolean;
}

export function decideNavigation(request: NavigationRequest, httpExceptions: ReadonlySet<string>): NavigationDecision {
  const { url, isTopFrame } = request;
  const scheme = schemeOf(url);
  if (EXTERNAL_SCHEMES.has(scheme)) return isTopFrame ? { kind: "external", url } : { kind: "block" };
  if (!isNavigableUrl(url)) return { kind: "block" };
  if (isTopFrame && scheme === "http:") {
    const upgraded = httpsUpgradeFor(url, httpExceptions);
    if (upgraded) return { kind: "upgrade", url: upgraded, from: url };
  }
  return { kind: "allow" };
}

/**
 * What to load for an explicit request (address bar, new tab): the HTTPS-Only upgrade applies
 * there too, because WebViews do not ask `onShouldStartLoadWithRequest` for their initial source.
 */
export function initialLoad(url: string, httpExceptions: ReadonlySet<string>): { url: string; upgradedFrom: string | null } {
  if (!url || schemeOf(url) !== "http:") return { url, upgradedFrom: null };
  const upgraded = httpsUpgradeFor(url, httpExceptions);
  return upgraded ? { url: upgraded, upgradedFrom: url } : { url, upgradedFrom: null };
}

/**
 * Whether a failed load of an upgraded https URL means "this host does not do HTTPS" (offer the
 * http version) rather than "the host is unreachable". Error codes differ per platform:
 * iOS reports NSURLError codes, Android WebViewClient ERROR_* constants.
 */
export function isHttpsUpgradeFailure(platform: string, code: number): boolean {
  if (platform === "ios") {
    // -1003 host not found, -1009 offline: http would fail too.
    if (code === -1003 || code === -1009) return false;
    // -1200…-1206 TLS/certificate errors, -1004 cannot connect (nothing on :443), -1005 lost,
    // -1007 too many redirects (https → http loop), -1001 timed out.
    return (code <= -1200 && code >= -1206) || code === -1004 || code === -1005 || code === -1007 || code === -1001;
  }
  if (platform === "android") {
    // ERROR_HOST_LOOKUP (-2): http would fail too.
    // ERROR_CONNECT (-6), ERROR_TIMEOUT (-8), ERROR_REDIRECT_LOOP (-9), ERROR_FAILED_SSL_HANDSHAKE (-11).
    return code === -6 || code === -8 || code === -9 || code === -11;
  }
  return false;
}

/**
 * What to do with a new window a page asks for (`onOpenWindow`): like a navigation, but stricter —
 * a page may open web pages and `about:blank` only, never a top-level `data:` document (a phishing
 * vector; same rule as the desktop, `isPageOpenableUrl`, ADR-018).
 */
export function decideOpenWindow(url: string, httpExceptions: ReadonlySet<string>): NavigationDecision {
  const decision = decideNavigation({ url, isTopFrame: true }, httpExceptions);
  if (decision.kind === "allow" && !isPageOpenableUrl(url)) return { kind: "block" };
  return decision;
}

/** What the start page of a private tab says is kept, per platform (ADR-016, audit LOW-5). */
export function privateModeNotice(platform: string): string {
  return platform === "ios"
    ? "Les pages ne sont pas enregistrées dans l'historique. Cookies et données de chaque onglet privé sont effacés à sa fermeture."
    : "Cookies partagés avec les onglets normaux sur Android. Les pages ne sont pas enregistrées dans l'historique ni dans le cache.";
}
