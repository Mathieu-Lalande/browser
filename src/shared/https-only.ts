import { isLocalHost, webHostname } from "./hosts";

/**
 * Where an http:// top-level navigation should go instead, or null to load it as is.
 * Local hosts and hosts the user accepted over http are left alone. The port is kept.
 */
export function httpsUpgradeFor(url: string, exceptions: ReadonlySet<string>): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:") return null;
  const host = webHostname(url);
  if (isLocalHost(host) || exceptions.has(host)) return null;
  parsed.protocol = "https:";
  return parsed.href;
}

/** Which engine reported a load error: Chromium (desktop), or the phone's WebView. */
export type LoadErrorSource = "chromium" | "ios" | "android";

const UPGRADE_FAILURES: Record<LoadErrorSource, (code: number) => boolean> = {
  chromium: (code) => {
    // -105 NAME_NOT_RESOLVED, -106 INTERNET_DISCONNECTED, -137 NAME_RESOLUTION_FAILED: http would fail too.
    if (code === -105 || code === -106 || code === -137) return false;
    // -1xx connection/TLS errors, -2xx certificate errors, -310 TOO_MANY_REDIRECTS (https → http loop),
    // -324 EMPTY_RESPONSE.
    return (code <= -100 && code > -300) || code === -310 || code === -324;
  },
  // NSURLError codes. -1003 host not found, -1009 offline: http would fail too.
  // -1200…-1206 TLS/certificate errors, -1004 cannot connect (nothing on :443), -1005 lost,
  // -1007 too many redirects (https → http loop), -1001 timed out.
  ios: (code) => (code <= -1200 && code >= -1206) || code === -1004 || code === -1005 || code === -1007 || code === -1001,
  // WebViewClient ERROR_* constants. ERROR_HOST_LOOKUP (-2): http would fail too.
  // ERROR_CONNECT (-6), ERROR_TIMEOUT (-8), ERROR_REDIRECT_LOOP (-9), ERROR_FAILED_SSL_HANDSHAKE (-11).
  android: (code) => code === -6 || code === -8 || code === -9 || code === -11,
};

/**
 * Whether a failed load of an upgraded https URL means "HTTPS does not work on this host" (offer
 * the http version) rather than "the host is unreachable". Error codes differ per engine.
 */
export function isHttpsUpgradeFailure(code: number, source: LoadErrorSource = "chromium"): boolean {
  return UPGRADE_FAILURES[source](code);
}

/** HTTPS-Only state: per-host exceptions for this session and the upgrades in flight, per tab. */
export class HttpsOnly {
  private readonly exceptions = new Set<string>();
  private readonly upgrades = new Map<number, { from: string; to: string }>();

  /** Called for each top-level request of a tab; returns the https URL to redirect to, if any. */
  upgrade(contentsId: number, url: string): string | null {
    const upgraded = httpsUpgradeFor(url, this.exceptions);
    if (upgraded) this.upgrades.set(contentsId, { from: url, to: upgraded });
    return upgraded;
  }

  /** Where a request the browser makes for a page (its favicon) goes: upgraded like a navigation, nothing recorded. */
  upgradeFor(url: string): string | null {
    return httpsUpgradeFor(url, this.exceptions);
  }

  /** On a failed top-level load: the original http URL to offer, if the failure is a failed upgrade. */
  fallbackFor(contentsId: number, failedUrl: string, code: number): string | null {
    const upgrade = this.upgrades.get(contentsId);
    if (!upgrade || !isHttpsUpgradeFailure(code)) return null;
    if (!failedUrl.startsWith("https:") || webHostname(failedUrl) !== webHostname(upgrade.to)) return null;
    this.upgrades.delete(contentsId);
    return upgrade.from;
  }

  /** Accept http for this URL's host until the browser quits. */
  allowHttp(url: string): void {
    const host = webHostname(url);
    if (host) this.exceptions.add(host);
  }

  /** Forget the tab's upgrade once its page loaded (or the tab is gone). */
  clear(contentsId: number): void {
    this.upgrades.delete(contentsId);
  }
}
