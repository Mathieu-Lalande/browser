/**
 * Cheap, safe anti-fingerprinting (ADR-014): what the browser says about itself in HTTP headers
 * matches a plain Chromium-based desktop browser. Pure functions, applied by `security.ts`
 * (user agent, Accept-Language) and the privacy pipeline (client hints). What a page's scripts can
 * read (canvas, WebGL, fonts, `navigator.*`) is not covered: it would need code injected in pages.
 */

/** Tokens to remove from the user agent and brand lists: Electron itself and the app's name. */
function leakPattern(appName: string): RegExp {
  const token = appName.replace(/[^\w-]/g, "");
  return new RegExp(`^(electron${token ? `|${token}` : ""})$`, "i");
}

/**
 * Desktop-Chrome-like user agent: without the `Electron/x` and `<App>/x` tokens (they break sites
 * and single users out), and with Chrome's reduced version (`Chrome/152.0.0.0`, as Chrome itself
 * sends since its "user agent reduction"); the full version stays available through client hints.
 */
export function reduceUserAgent(userAgent: string, appName: string): string {
  const leaks = leakPattern(appName);
  return userAgent
    .split(" ")
    .filter((token) => !leaks.test(token.split("/", 1)[0]))
    .join(" ")
    .replace(/\bChrome\/(\d+)(?:\.\d+){1,3}\b/, "Chrome/$1.0.0.0");
}

/**
 * "Demander la version mobile" (ADR-026): the same Chrome as an Android phone (Chrome's reduced
 * Android platform token `Linux; Android 10; K`, and `Mobile` before `Safari/`).
 */
export function mobileUserAgent(desktopUserAgent: string): string {
  const ua = desktopUserAgent.replace(/\([^)]*\)/, "(Linux; Android 10; K)");
  return /\bMobile\b/.test(ua) ? ua : ua.replace(/\bSafari\//, "Mobile Safari/");
}

/** The Chrome major version advertised by a user agent, if any. */
export function chromeMajor(userAgent: string): string | null {
  return /\bChrome\/(\d+)/.exec(userAgent)?.[1] ?? null;
}

const BRAND = /"((?:[^"\\]|\\.)*)"\s*;\s*v\s*=\s*"([^"]*)"/g;

/**
 * `Sec-CH-UA` / `Sec-CH-UA-Full-Version-List` value without brands that name Electron or the app
 * (structured header list `"Brand";v="1", …`). Unchanged when nothing leaks; malformed values
 * are replaced by a plain Chromium brand rather than passed through.
 */
export function normalizeBrandList(value: string, appName: string, fallbackVersion = ""): string {
  const leaks = leakPattern(appName);
  const brands = [...value.matchAll(BRAND)].map(([, brand, version]) => ({ brand, version }));
  const kept = brands.filter(({ brand }) => !leaks.test(brand.trim()));
  if (brands.length && kept.length === brands.length) return value;
  if (!kept.length) return fallbackVersion ? `"Chromium";v="${fallbackVersion}"` : "";
  return kept.map(({ brand, version }) => `"${brand}";v="${version}"`).join(", ");
}

const BRAND_HEADERS = /^sec-ch-ua(-full-version-list)?$/i;

/**
 * Request headers with consistent client hints: brand lists never mention Electron or the app.
 * (Chromium's own brands are "Chromium" and a GREASE brand, consistent with the reduced user agent.)
 * Returns the same object when there is nothing to change.
 */
export function normalizeClientHints(headers: Record<string, string>, appName: string): Record<string, string> {
  let result = headers;
  for (const [name, value] of Object.entries(headers)) {
    if (!BRAND_HEADERS.test(name)) continue;
    const normalized = normalizeBrandList(value, appName);
    if (normalized === value) continue;
    if (result === headers) result = { ...headers };
    if (normalized) result[name] = normalized;
    else delete result[name];
  }
  return result;
}

/** The most common `Accept-Language` on the web (Electron adds the `;q=0.9` weight itself). */
export const COMMON_ACCEPT_LANGUAGES = "en-US,en";

/**
 * Languages for `session.setUserAgent(ua, languages)`: the app locale (Chromium's default), or
 * the most common list when the user chose to blend in. Comma-separated, without weights.
 */
export function acceptLanguages(normalize: boolean, locale: string): string {
  if (normalize) return COMMON_ACCEPT_LANGUAGES;
  return /^[a-z]{2,3}(-[a-z\d]{2,8})*$/i.test(locale) ? locale : "en-US";
}
