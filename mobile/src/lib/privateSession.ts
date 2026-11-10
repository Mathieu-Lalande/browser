/**
 * Private tabs and their data (ADR-055, replaces the Android limit of ADR-016).
 *
 * - iOS: `incognito` gives each private WebView its own non-persistent WKWebsiteDataStore.
 * - Android with the WebView "multi-profile" feature (WebView 110+, androidx.webkit): `incognito`
 *   (patched, see `patches/react-native-webview+*.patch`) puts every private WebView in one
 *   separate profile, "browser-private" (own cookies, storage, cache); it is wiped when the last
 *   private tab closes and at start-up.
 * - Android without it: private tabs share the normal cookie jar (the WebView has a single one).
 *   When the private session ends, the cookies and storage of every site visited in private are
 *   deleted, which also signs normal tabs out of those sites: said in the README and the ADR.
 */

export type PrivateIsolation = "isolated" | "profile" | "shared";

export function privateIsolation(platform: string, androidProfiles: boolean): PrivateIsolation {
  if (platform === "ios") return "isolated";
  if (platform === "android") return androidProfiles ? "profile" : "shared";
  return "isolated";
}

/** Origins visited in private, at most this many (oldest dropped). */
export const MAX_PRIVATE_ORIGINS = 500;

const originOf = (url: string): string | null => {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.origin : null;
  } catch {
    return null;
  }
};

/**
 * Follows the private session: the origins its tabs visited (memory only) and its end (it had
 * private tabs and now has none).
 */
export class PrivateSessionTracker {
  private origins = new Set<string>();
  private open = false;

  /** Feeds the private tabs' current URLs; returns the origins to clear when the session just ended, else null. */
  update(privateUrls: readonly string[]): string[] | null {
    for (const url of privateUrls) {
      const origin = originOf(url);
      if (!origin || this.origins.has(origin)) continue;
      this.origins.add(origin);
      if (this.origins.size > MAX_PRIVATE_ORIGINS) this.origins.delete(this.origins.values().next().value!);
    }
    if (privateUrls.length > 0) {
      this.open = true;
      return null;
    }
    if (!this.open) return null;
    this.open = false;
    const ended = [...this.origins];
    this.origins = new Set();
    return ended;
  }
}
