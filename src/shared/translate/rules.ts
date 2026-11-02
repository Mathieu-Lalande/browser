/**
 * Translation rules (ADR-036): "Toujours traduire <langue>", "Ne jamais traduire <langue>" and
 * "Jamais pour ce site", and what they decide for a page. Pure; persisted in `settings.translate`
 * (a private window keeps its own, in memory).
 */

export interface TranslateRules {
  alwaysLanguages: string[];
  neverLanguages: string[];
  /** Hosts without "www.", e.g. "example.com" (also covers its subdomains). */
  neverSites: string[];
}

export const EMPTY_RULES: TranslateRules = { alwaysLanguages: [], neverLanguages: [], neverSites: [] };

/** "auto": translate right away; "offer": show the address bar button; "none": neither. */
export type TranslateDecision = "auto" | "offer" | "none";

const MAX_SITES = 500;

/** The rule key of a page's host: lowercase, without "www." (null for no host). */
export function siteOfHost(host: string | null | undefined): string | null {
  const bare = (host ?? "").trim().toLowerCase().replace(/\.$/, "");
  if (!bare) return null;
  return bare.startsWith("www.") ? bare.slice(4) : bare;
}

/** The site key of a web page URL (null for other schemes). */
export function siteOfUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? siteOfHost(parsed.hostname) : null;
  } catch {
    return null;
  }
}

const isSiteKey = (value: string) => /^[a-z0-9.-]+$/.test(value) && value.length <= 253 && !value.startsWith(".") && !value.includes("..");

/** Validated "never" sites (settings), sorted, deduplicated. */
export function sanitizeSiteKeys(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const sites = new Set<string>();
  for (const item of value) {
    const site = typeof item === "string" ? siteOfHost(item) : null;
    if (site && isSiteKey(site)) sites.add(site);
  }
  return [...sites].sort().slice(0, MAX_SITES);
}

/** Whether `site` (a page's) is one of the rules' sites or a subdomain of one. */
export function isNeverSite(rules: TranslateRules, site: string | null): boolean {
  return !!site && rules.neverSites.some((never) => site === never || site.endsWith(`.${never}`));
}

export function translateDecision(input: { pageLanguage: string | null; target: string; site: string | null; rules: TranslateRules }): TranslateDecision {
  const { pageLanguage, target, site, rules } = input;
  if (!pageLanguage || pageLanguage === target) return "none";
  if (isNeverSite(rules, site) || rules.neverLanguages.includes(pageLanguage)) return "none";
  return rules.alwaysLanguages.includes(pageLanguage) ? "auto" : "offer";
}

const toggled = (list: readonly string[], value: string, on: boolean) => {
  const rest = list.filter((item) => item !== value);
  return on ? [...rest, value].sort() : rest;
};

/** "Toujours traduire <langue>": on removes it from the "never" languages, and the other way. */
export function withAlwaysLanguage(rules: TranslateRules, language: string, on: boolean): TranslateRules {
  return {
    ...rules,
    alwaysLanguages: toggled(rules.alwaysLanguages, language, on),
    neverLanguages: on ? rules.neverLanguages.filter((item) => item !== language) : rules.neverLanguages,
  };
}

export function withNeverLanguage(rules: TranslateRules, language: string, on: boolean): TranslateRules {
  return {
    ...rules,
    neverLanguages: toggled(rules.neverLanguages, language, on),
    alwaysLanguages: on ? rules.alwaysLanguages.filter((item) => item !== language) : rules.alwaysLanguages,
  };
}

export function withNeverSite(rules: TranslateRules, site: string, on: boolean): TranslateRules {
  return { ...rules, neverSites: toggled(rules.neverSites, site, on) };
}
