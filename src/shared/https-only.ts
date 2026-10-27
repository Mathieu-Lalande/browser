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

/** Chromium net errors meaning "HTTPS does not work on this host" (rather than "the host is unreachable"). */
export function isHttpsUpgradeFailure(code: number): boolean {
  // -105 NAME_NOT_RESOLVED, -106 INTERNET_DISCONNECTED, -137 NAME_RESOLUTION_FAILED: http would fail too.
  if (code === -105 || code === -106 || code === -137) return false;
  // -1xx connection/TLS errors, -2xx certificate errors, -310 TOO_MANY_REDIRECTS (https → http loop),
  // -324 EMPTY_RESPONSE.
  return (code <= -100 && code > -300) || code === -310 || code === -324;
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
