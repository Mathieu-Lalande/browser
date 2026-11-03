/**
 * Links handed to the app by the system (default browser on Android, http/https VIEW intents;
 * iOS once the web-browser entitlement is granted), or by our own scheme:
 * `browser-mobile://open?url=<encoded http(s) URL>`. Anything else (the dev client's
 * `exp+browser-mobile://…`, `javascript:`, `file:`, `data:`…) is ignored.
 */
export function incomingPageUrl(raw: string | null | undefined, scheme = "browser-mobile"): string | null {
  if (!raw) return null;
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    return null;
  }
  if (parsed.protocol === "http:" || parsed.protocol === "https:") return parsed.href;
  if (parsed.protocol === `${scheme}:`) {
    // `browser-mobile://open?url=…`: the WHATWG parser puts "open" in the host (or the path).
    const action = (parsed.host || parsed.pathname.replace(/^\/+/, "")).toLowerCase();
    if (action !== "open") return null;
    return incomingPageUrl(parsed.searchParams.get("url"), "");
  }
  return null;
}

/**
 * Turns the system's link events into "open this page in a new tab" calls. The initial URL
 * (cold start) is delivered once even if it is reported again; later events always open.
 */
export function createIncomingLinkHandler(open: (url: string) => void): { initial(raw: string | null | undefined): void; event(raw: string): void } {
  let initialSeen = false;
  return {
    initial(raw) {
      if (initialSeen) return;
      initialSeen = true;
      const url = incomingPageUrl(raw);
      if (url) open(url);
    },
    event(raw) {
      const url = incomingPageUrl(raw);
      if (url) open(url);
    },
  };
}
