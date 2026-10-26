import { internalPageOf, internalUrl } from "./internal";

export interface SearchEngine {
  id: string;
  name: string;
  /** `%s` is replaced by the URL-encoded query. */
  template: string;
}

export const SEARCH_ENGINES: readonly SearchEngine[] = [
  { id: "duckduckgo", name: "DuckDuckGo", template: "https://duckduckgo.com/?q=%s" },
  { id: "brave", name: "Brave Search", template: "https://search.brave.com/search?q=%s" },
  { id: "startpage", name: "Startpage", template: "https://www.startpage.com/do/search?q=%s" },
  { id: "google", name: "Google", template: "https://www.google.com/search?q=%s" },
];

export const DEFAULT_SEARCH_ENGINE = SEARCH_ENGINES[0];

/**
 * Schemes a tab is allowed to load. Everything else (file:, javascript:, browser:…) is refused:
 * internal `browser://` pages are only reachable from `normalizeInput`, i.e. typed by the user.
 */
const NAVIGABLE_SCHEMES = new Set(["http:", "https:", "about:", "data:"]);

export function searchUrl(query: string, engine: SearchEngine = DEFAULT_SEARCH_ENGINE): string {
  return engine.template.replace("%s", encodeURIComponent(query.trim()));
}

function looksLikeHost(input: string): boolean {
  if (/^localhost(:\d+)?(\/|$)/i.test(input)) return true;
  if (/^\[[\da-f:]+\](:\d+)?(\/|$)/i.test(input)) return true;
  const host = input.split(/[/?#]/, 1)[0].replace(/:\d+$/, "");
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return true;
  // A dotted host whose TLD is alphabetic (or punycode), e.g. "example.com", "sub.domain.co.uk".
  return /^([a-z\d¡-￿-]+\.)+([a-z¡-￿]{2,}|xn--[a-z\d-]+)$/i.test(host);
}

/**
 * Turn what the user typed in the address bar into a URL to load.
 * Returns an empty string for empty input (start page).
 */
export function normalizeInput(raw: string, engine: SearchEngine = DEFAULT_SEARCH_ENGINE): string {
  const input = raw.trim();
  if (!input) return "";
  if (/\s/.test(input)) return searchUrl(input, engine);
  const internal = internalPageOf(input);
  if (internal) return internalUrl(internal);

  if (/^[a-z][a-z\d+\-.]*:/i.test(input) && !/^[^:/]+:\d+(\/|$)/.test(input)) {
    try {
      const url = new URL(input);
      if (NAVIGABLE_SCHEMES.has(url.protocol)) return url.href;
    } catch {
      // fall through to search
    }
    return searchUrl(input, engine);
  }

  if (looksLikeHost(input)) {
    const scheme = /^(localhost|127\.|\[::1\])/i.test(input) ? "http" : "https";
    try {
      return new URL(`${scheme}://${input}`).href;
    } catch {
      return searchUrl(input, engine);
    }
  }
  return searchUrl(input, engine);
}

export function isNavigableUrl(url: string): boolean {
  try {
    return NAVIGABLE_SCHEMES.has(new URL(url).protocol);
  } catch {
    return false;
  }
}

/** Short, human friendly label for a URL (used for tab titles before the page sets one). */
export function displayUrl(url: string): string {
  if (!url) return "";
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      const path = parsed.pathname === "/" ? "" : parsed.pathname;
      return `${parsed.hostname.replace(/^www\./, "")}${path}`;
    }
  } catch {
    // ignore
  }
  return url;
}
