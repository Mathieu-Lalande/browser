/**
 * Boosts (ADR-029): per-site customizations, Arc style. Pure model shared by the desktop (main,
 * UI) and the phone: validation, host matching, and the CSS a boost puts in a page. Nothing here
 * touches a DOM: the scripts that run in pages are strings built by each platform.
 */

export const BOOSTS_VERSION = 1;
export const MAX_BOOSTS = 200;
export const MAX_BOOST_NAME = 80;
/** Custom CSS and user script, in characters. */
export const MAX_BOOST_CSS = 20_000;
export const MAX_BOOST_SCRIPT = 20_000;
export const MAX_ZAPS = 100;
export const MAX_SELECTOR = 400;

/** Font override: a few system stacks only (no web font is ever downloaded). */
export const BOOST_FONTS = {
  system: { label: "Police du système", stack: "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif" },
  sans: { label: "Sans empattement", stack: "Helvetica, Arial, 'Liberation Sans', sans-serif" },
  serif: { label: "Avec empattement", stack: "Georgia, 'Times New Roman', 'Liberation Serif', serif" },
  mono: { label: "Chasse fixe", stack: "ui-monospace, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace" },
  rounded: { label: "Arrondie", stack: "ui-rounded, 'SF Pro Rounded', 'Nunito', 'Varela Round', system-ui, sans-serif" },
} as const;
export type BoostFont = keyof typeof BOOST_FONTS;
export const isBoostFont = (value: unknown): value is BoostFont => typeof value === "string" && Object.hasOwn(BOOST_FONTS, value);

/** Color filters, as CSS filters on `html`. Percentages, within safe ranges (a page stays readable). */
export interface BoostFilters {
  invert: boolean;
  grayscale: number;
  sepia: number;
  brightness: number;
  contrast: number;
}
export const FILTER_RANGES = {
  grayscale: { min: 0, max: 100, neutral: 0 },
  sepia: { min: 0, max: 100, neutral: 0 },
  brightness: { min: 50, max: 150, neutral: 100 },
  contrast: { min: 50, max: 150, neutral: 100 },
} as const;
export type FilterAmount = keyof typeof FILTER_RANGES;
export const DEFAULT_FILTERS: BoostFilters = { invert: false, grayscale: 0, sepia: 0, brightness: 100, contrast: 100 };

/** Optional user script: off by default, never in the page's main world on the desktop. */
export interface BoostScript {
  enabled: boolean;
  code: string;
  /** Runs in private windows/tabs too (off: a private page gets the boost's CSS only). */
  allowPrivate: boolean;
}

export interface Boost {
  id: string;
  name: string;
  /** Host pattern: an exact host (`news.example.com`) or a domain and its subdomains (`*.example.com`). */
  match: string;
  enabled: boolean;
  css: string;
  /** Selectors of elements hidden with the zap tool. */
  zaps: string[];
  font: BoostFont | null;
  filters: BoostFilters;
  script: BoostScript;
  updatedAt: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

export const isBoostId = (value: unknown): value is string => typeof value === "string" && /^[\w-]{1,64}$/.test(value);

// --- Hosts -------------------------------------------------------------------------------------

const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;
const isHost = (host: string) => host.length <= 253 && host.split(".").every((label) => LABEL.test(label));

/**
 * The match pattern typed by the user, normalized: lower case, a pasted URL reduced to its host,
 * `www.` kept (exact). `*.domain` needs a domain with a dot (no `*.com`), or `localhost`. Null: invalid.
 */
export function normalizeMatch(input: unknown): string | null {
  if (typeof input !== "string") return null;
  let value = input.trim().toLowerCase();
  if (/^https?:\/\//.test(value)) {
    try {
      value = new URL(value).hostname;
    } catch {
      return null;
    }
  }
  value = value.replace(/\.$/, "");
  if (value.startsWith("*.")) {
    const domain = value.slice(2);
    return isHost(domain) && (domain.includes(".") || domain === "localhost") ? `*.${domain}` : null;
  }
  return value && isHost(value) ? value : null;
}

/** The host a boost applies to: web pages only (http/https), lower case. */
export function boostHostOf(url: string): string | null {
  if (!/^https?:\/\//i.test(url)) return null;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host || null;
  } catch {
    return null;
  }
}

export function matchesHost(match: string, host: string): boolean {
  if (match.startsWith("*.")) {
    const domain = match.slice(2);
    return host === domain || host.endsWith(`.${domain}`);
  }
  return host === match;
}

/** More specific first: exact hosts, then the longest domains. */
export const matchSpecificity = (match: string) => (match.startsWith("*.") ? match.length - 2 : 1000 + match.length);

/** Every enabled boost for a page, the most specific last (its CSS wins ties). */
export function boostsFor(boosts: readonly Boost[], url: string): Boost[] {
  const host = boostHostOf(url);
  if (!host) return [];
  return boosts.filter((boost) => boost.enabled && matchesHost(boost.match, host)).sort((a, b) => matchSpecificity(a.match) - matchSpecificity(b.match));
}

/** The boost the site panel shows for a page: the most specific matching one, enabled or not. */
export function siteBoost(boosts: readonly Boost[], url: string): Boost | null {
  const host = boostHostOf(url);
  if (!host) return null;
  const matching = boosts.filter((boost) => matchesHost(boost.match, host));
  return matching.sort((a, b) => matchSpecificity(b.match) - matchSpecificity(a.match))[0] ?? null;
}

/** The pattern a new boost gets for a page: `www.example.com` → `*.example.com`, else the exact host. */
export function defaultMatch(host: string): string {
  return host.startsWith("www.") && normalizeMatch(`*.${host.slice(4)}`) ? `*.${host.slice(4)}` : host;
}

// --- Selectors ---------------------------------------------------------------------------------

const ROOTS = new Set(["html", "body", "*", ":root", "head"]);

/**
 * A zap selector is put in `<selector> { display: none !important }`: it may not end the rule nor
 * open another one (no braces, `;`, `@`, `<`, comments, line breaks, trailing backslash), quotes
 * and brackets must balance, and it may not hide the whole page. Real syntax is checked by the
 * engine itself (an invalid selector only drops its own rule).
 */
export function isValidSelector(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const selector = value.trim();
  if (!selector || selector.length > MAX_SELECTOR || selector !== value) return false;
  if (/[{};@<\n\r\f]|\/\*|\*\//.test(selector) || selector.endsWith("\\")) return false;
  if (ROOTS.has(selector.toLowerCase())) return false;
  let quote: string | null = null;
  const stack: string[] = [];
  for (let i = 0; i < selector.length; i++) {
    const char = selector[i];
    if (char === "\\") {
      i++;
      continue;
    }
    if (quote) {
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") quote = char;
    else if (char === "[" || char === "(") stack.push(char === "[" ? "]" : ")");
    else if (char === "]" || char === ")") {
      if (stack.pop() !== char) return false;
    }
  }
  return quote === null && stack.length === 0;
}

// --- Validation --------------------------------------------------------------------------------

const clampInt = (value: unknown, min: number, max: number, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback;

export function sanitizeFilters(value: unknown): BoostFilters {
  const input = isRecord(value) ? value : {};
  const amount = (key: FilterAmount) => clampInt(input[key], FILTER_RANGES[key].min, FILTER_RANGES[key].max, FILTER_RANGES[key].neutral);
  return { invert: input.invert === true, grayscale: amount("grayscale"), sepia: amount("sepia"), brightness: amount("brightness"), contrast: amount("contrast") };
}

const cleanText = (value: unknown, max: number) => (typeof value === "string" ? value.replace(/\0/g, "").slice(0, max) : "");

export function sanitizeZaps(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter(isValidSelector))].slice(0, MAX_ZAPS);
}

/** A boost from storage, IPC or another device; null when it cannot be one (bad id or pattern). */
export function sanitizeBoost(value: unknown): Boost | null {
  if (!isRecord(value) || !isBoostId(value.id)) return null;
  const match = normalizeMatch(value.match);
  if (!match) return null;
  const script = isRecord(value.script) ? value.script : {};
  return {
    id: value.id,
    name: cleanText(value.name, MAX_BOOST_NAME).trim() || match,
    match,
    enabled: value.enabled !== false,
    css: cleanText(value.css, MAX_BOOST_CSS),
    zaps: sanitizeZaps(value.zaps),
    font: isBoostFont(value.font) ? value.font : null,
    filters: sanitizeFilters(value.filters),
    script: { enabled: script.enabled === true, code: cleanText(script.code, MAX_BOOST_SCRIPT), allowPrivate: script.allowPrivate === true },
    updatedAt: clampInt(value.updatedAt, 0, Number.MAX_SAFE_INTEGER, 0),
  };
}

/** The stored list: valid boosts only, unique ids, bounded. */
export function sanitizeBoosts(value: unknown): Boost[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const list: Boost[] = [];
  for (const item of value) {
    const boost = sanitizeBoost(item);
    if (!boost || seen.has(boost.id)) continue;
    seen.add(boost.id);
    list.push(boost);
    if (list.length >= MAX_BOOSTS) break;
  }
  return list;
}

export function newBoost(id: string, host: string, now: number): Boost {
  const match = normalizeMatch(defaultMatch(host)) ?? host;
  return {
    id,
    name: match.replace(/^\*\./, ""),
    match,
    enabled: true,
    css: "",
    zaps: [],
    font: null,
    filters: { ...DEFAULT_FILTERS },
    script: { enabled: false, code: "", allowPrivate: false },
    updatedAt: now,
  };
}

/** Puts `boost` in the list (replacing the one with its id), or appends it. */
export function upsertBoost(boosts: readonly Boost[], boost: Boost): Boost[] {
  const index = boosts.findIndex((item) => item.id === boost.id);
  if (index === -1) return boosts.length >= MAX_BOOSTS ? [...boosts] : [...boosts, boost];
  const next = [...boosts];
  next[index] = boost;
  return next;
}

export function addZap(boost: Boost, selector: string, now: number): Boost {
  if (!isValidSelector(selector) || boost.zaps.includes(selector) || boost.zaps.length >= MAX_ZAPS) return boost;
  return { ...boost, zaps: [...boost.zaps, selector], updatedAt: now };
}

export function removeZap(boost: Boost, selector: string, now: number): Boost {
  return { ...boost, zaps: boost.zaps.filter((item) => item !== selector), updatedAt: now };
}

/** Whether the boost's script runs on a page (private: only when the boost allows it). */
export function scriptAllowed(boost: Boost, isPrivate: boolean): boolean {
  return boost.enabled && boost.script.enabled && boost.script.code.trim() !== "" && (!isPrivate || boost.script.allowPrivate);
}

// --- CSS ---------------------------------------------------------------------------------------

export function filtersActive(filters: BoostFilters): boolean {
  return filters.invert || (Object.keys(FILTER_RANGES) as FilterAmount[]).some((key) => filters[key] !== FILTER_RANGES[key].neutral);
}

/** The CSS `filter` value, or "" when neutral. Inverted pages keep their hues (hue-rotate). */
export function filterValue(filters: BoostFilters): string {
  const parts: string[] = [];
  if (filters.invert) parts.push("invert(1)", "hue-rotate(180deg)");
  if (filters.grayscale) parts.push(`grayscale(${filters.grayscale}%)`);
  if (filters.sepia) parts.push(`sepia(${filters.sepia}%)`);
  if (filters.brightness !== 100) parts.push(`brightness(${filters.brightness}%)`);
  if (filters.contrast !== 100) parts.push(`contrast(${filters.contrast}%)`);
  return parts.join(" ");
}

/**
 * The CSS a boost adds to a page: filters, font, zapped elements (one rule each, so an invalid
 * selector drops only itself), then the custom CSS (last: an unclosed block there can only
 * swallow its own rules).
 */
export function boostCss(boost: Boost): string {
  const rules: string[] = [];
  const filter = filterValue(boost.filters);
  if (filter) rules.push(`html { filter: ${filter} !important; }`);
  // Pictures and videos are inverted back so they look right on an inverted page.
  if (boost.filters.invert) rules.push("img, video, picture, canvas, iframe, [style*='background-image'] { filter: invert(1) hue-rotate(180deg) !important; }");
  if (boost.font) rules.push(`body, body *:not(pre):not(code):not(kbd):not(samp):not([class*='icon']):not([class*='Icon']) { font-family: ${BOOST_FONTS[boost.font].stack} !important; }`);
  for (const selector of boost.zaps) if (isValidSelector(selector)) rules.push(`${selector} { display: none !important; }`);
  if (boost.css.trim()) rules.push(boost.css);
  return rules.join("\n");
}

/** The CSS of every enabled boost for a page, the most specific last. */
export function pageCss(boosts: readonly Boost[], url: string): string {
  return boostsFor(boosts, url)
    .map(boostCss)
    .filter(Boolean)
    .join("\n");
}

// --- Sync (ADR-019) ----------------------------------------------------------------------------

/** A synced boost: everything but its id (the record id). The script travels only while enabled. */
export type SyncedBoost = Omit<Boost, "id">;

export function boostRecord(boost: Boost): SyncedBoost {
  const { id: _id, ...rest } = boost;
  return { ...rest, script: boost.script.enabled ? { ...boost.script } : { enabled: false, code: "", allowPrivate: false }, zaps: [...boost.zaps], filters: { ...boost.filters } };
}

export function sanitizeSyncedBoost(value: unknown, localId: string): SyncedBoost | null {
  if (!isRecord(value)) return null;
  const boost = sanitizeBoost({ ...value, id: localId });
  return boost ? boostRecord(boost) : null;
}

/**
 * Applies synced boosts to a local list. A record without a script (disabled elsewhere) keeps the
 * local disabled code, so a script that is off never leaves the device but is not lost either.
 */
export function mergeBoosts(local: readonly Boost[], upserts: readonly [string, SyncedBoost][], deletes: readonly string[]): Boost[] {
  let boosts = local.filter((boost) => !deletes.includes(boost.id));
  for (const [id, record] of upserts) {
    const incoming = sanitizeBoost({ ...record, id });
    if (!incoming) continue;
    const existing = boosts.find((boost) => boost.id === id);
    if (existing && !incoming.script.enabled && !incoming.script.code) incoming.script = { ...existing.script, enabled: false };
    boosts = upsertBoost(boosts, incoming);
  }
  return boosts;
}

// --- Editing -----------------------------------------------------------------------------------

/** What the editors send: a whole boost, without id for a new one. */
export type BoostInput = Omit<Boost, "id" | "updatedAt"> & { id?: string };

/** The answer to an edit: the saved boost, or a French message saying what to fix. */
export type BoostResult = { ok: true; boost: Boost } | { ok: false; message: string };

/** Checks an edited boost (nothing is silently truncated) and gives it `id`. */
export function validateBoostInput(value: unknown, id: string, now: number): BoostResult {
  if (!isRecord(value)) return { ok: false, message: "Boost invalide." };
  if (!normalizeMatch(value.match)) return { ok: false, message: "Site invalide : saisissez un domaine (exemple.fr), ou *.exemple.fr pour inclure ses sous-domaines." };
  if (typeof value.css === "string" && value.css.length > MAX_BOOST_CSS) return { ok: false, message: `Le CSS dépasse ${MAX_BOOST_CSS} caractères.` };
  const script = isRecord(value.script) ? value.script : {};
  if (typeof script.code === "string" && script.code.length > MAX_BOOST_SCRIPT) return { ok: false, message: `Le script dépasse ${MAX_BOOST_SCRIPT} caractères.` };
  if (Array.isArray(value.zaps) && value.zaps.length > MAX_ZAPS) return { ok: false, message: `${MAX_ZAPS} éléments masqués au plus.` };
  if (Array.isArray(value.zaps) && !value.zaps.every(isValidSelector)) return { ok: false, message: "Un élément masqué a un sélecteur invalide." };
  const boost = sanitizeBoost({ ...value, id, updatedAt: now });
  return boost ? { ok: true, boost } : { ok: false, message: "Boost invalide." };
}
