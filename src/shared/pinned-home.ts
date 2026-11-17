/**
 * Anchored pinned tabs (ADR-059): a pinned tab remembers the page it was pinned on, its "home".
 * The UI shows when the tab wandered (a dot on its tile, a "back" chip in the address bar) and a
 * click brings it home. Pure: what counts as home, inside the site, or away.
 */

export type PinnedPlace = "home" | "inside" | "away";

const siteOf = (url: URL) => url.hostname.replace(/^www\./u, "");
const normalize = (url: URL) => `${url.origin}${url.pathname.replace(/\/+$/u, "")}${url.search}`;

/** Where `url` stands relative to the pinned `home`: the same page (hash and trailing slash ignored), the same site, or elsewhere. */
export function pinnedPlace(home: string | null | undefined, url: string): PinnedPlace {
  if (!home || !url) return "home";
  try {
    const from = new URL(home);
    const to = new URL(url);
    if (normalize(from) === normalize(to)) return "home";
    return siteOf(from) === siteOf(to) ? "inside" : "away";
  } catch {
    return "home";
  }
}

/** The host shown on the "back" chip. */
export function pinnedHomeLabel(home: string): string {
  try {
    return siteOf(new URL(home));
  } catch {
    return home;
  }
}
