/**
 * Cheap, safe anti-fingerprinting (ADR-014): what the browser says about itself in HTTP headers
 * matches a plain Chromium-based desktop browser. Pure functions, applied by `security.ts`
 * (user agent, Accept-Language) and the privacy pipeline (client hints). What a page's scripts can
 * read (canvas, WebGL, fonts, `navigator.*`) is not covered: it would need code injected in pages.
 */

/** Tokens to remove from the user agent: Electron itself and the app's name. */
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

/** Chrome's version: `major` for `Sec-CH-UA`, `full` (e.g. `152.0.7977.167`) for the full version list. */
export interface ChromeVersion {
  major: string;
  full: string;
}

/** Chrome's version from Electron's `process.versions.chrome` (`152.0.7977.167`). */
export function chromeVersion(full: string): ChromeVersion {
  return { major: full.split(".", 1)[0] ?? "", full };
}

export interface Brand {
  brand: string;
  version: string;
}

const GREASE_CHARS = [" ", "(", ":", "-", ".", "/", ")", ";", "=", "?", "_"];
const GREASE_VERSIONS = ["8", "99", "24"];
const ORDERS = [
  [0, 1, 2],
  [0, 2, 1],
  [1, 0, 2],
  [1, 2, 0],
  [2, 0, 1],
  [2, 1, 0],
] as const;

/**
 * The brand list of Google Chrome, exactly as Chrome builds it (Chromium's
 * `GenerateBrandVersionList`, seeded by the major version): a GREASE brand, "Chromium" and
 * "Google Chrome", in a stable order per version. `full`: versions of the full version list.
 */
export function chromeBrands(chrome: ChromeVersion, full = false): Brand[] {
  const seed = Number.parseInt(chrome.major, 10) || 0;
  const order = ORDERS[seed % ORDERS.length];
  const grease = `Not${GREASE_CHARS[seed % GREASE_CHARS.length]}A${GREASE_CHARS[(seed + 1) % GREASE_CHARS.length]}Brand`;
  const greaseVersion = GREASE_VERSIONS[seed % GREASE_VERSIONS.length];
  const own = full ? chrome.full : chrome.major;
  const list: Brand[] = [];
  list[order[0]] = { brand: grease, version: full ? `${greaseVersion}.0.0.0` : greaseVersion };
  list[order[1]] = { brand: "Chromium", version: own };
  list[order[2]] = { brand: "Google Chrome", version: own };
  return list;
}

/** A brand list as a structured header (`"Brand";v="1", …`), the form of `Sec-CH-UA`. */
export function brandHeader(brands: readonly Brand[]): string {
  return brands.map(({ brand, version }) => `"${brand}";v="${version}"`).join(", ");
}

const BRAND_HEADERS = /^sec-ch-ua(-full-version-list)?$/i;

/**
 * Request headers whose brand lists (`Sec-CH-UA`, `Sec-CH-UA-Full-Version-List`) are those of
 * Google Chrome of the same version (ADR-040): Electron's Chromium announces "Chromium" alone,
 * which, next to a Chrome user agent, singles the browser out (and Google's sign-in is wary of
 * embedded browsers). Never a brand naming Electron or the app. Headers the request did not carry
 * are not added. Returns the same object when there is nothing to change.
 */
export function normalizeClientHints(headers: Record<string, string>, chrome: ChromeVersion): Record<string, string> {
  let result = headers;
  for (const [name, value] of Object.entries(headers)) {
    if (!BRAND_HEADERS.test(name)) continue;
    const normalized = brandHeader(chromeBrands(chrome, name.length > "sec-ch-ua".length));
    if (normalized === value) continue;
    if (result === headers) result = { ...headers };
    result[name] = normalized;
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

// --- Strict fingerprinting protection (ADR-046) ----------------------------------------------------

/** Whether the languages sent are normalized: asked for, or implied by the strict protection. */
export const normalizesLanguages = (privacy: { normalizeAcceptLanguage: boolean; fingerprinting: string }) =>
  privacy.normalizeAcceptLanguage || privacy.fingerprinting === "strict";

/**
 * High-entropy client hints: sent only to sites that asked for them (`Accept-CH`), they tell the
 * exact version, OS version, CPU architecture, bitness and device model.
 */
const HIGH_ENTROPY_HINTS = /^sec-ch-ua-(full-version|full-version-list|platform-version|arch|bitness|model|wow64|form-factors)$/i;

/** The request headers without high-entropy client hints, and whether any was there (a site asked). */
export function withoutHighEntropyHints(headers: Record<string, string>): { headers: Record<string, string>; removed: boolean } {
  const kept = Object.entries(headers).filter(([name]) => !HIGH_ENTROPY_HINTS.test(name));
  if (kept.length === Object.keys(headers).length) return { headers, removed: false };
  return { headers: Object.fromEntries(kept), removed: true };
}

/**
 * Permissions denied without asking under the strict protection: they expose installed fonts,
 * screens' layout and MIDI devices, classic fingerprinting surfaces.
 */
export const FINGERPRINTING_PERMISSIONS: ReadonlySet<string> = new Set(["local-fonts", "window-management", "midi", "midi-sysex"]);
