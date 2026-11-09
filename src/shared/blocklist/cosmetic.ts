import { hostSuffixes } from "./network";
import { isSafeSelector, type CosmeticRule } from "./parse";

/**
 * Element hiding on the phone (ADR-051): selectors of `##` rules, generic or per domain, turned
 * into a style sheet the app injects in each page (`injectJavaScript`, both platforms, Expo Go
 * included). The index is bundled with the JavaScript, so it is capped.
 */

export interface CosmeticIndex {
  version: 1;
  /** Hidden on every site (minus `exceptions`). */
  generic: string[];
  /** Domain → selectors hidden on it and its subdomains. */
  hosts: Record<string, string[]>;
  /** Domain → generic selectors not hidden on it (`#@#`, `~domain##`). */
  exceptions: Record<string, string[]>;
}

export interface CosmeticCaps {
  generic: number;
  /** (domain, selector) pairs across all domains. */
  specific: number;
}

export const DEFAULT_COSMETIC_CAPS: CosmeticCaps = { generic: 3_000, specific: 10_000 };

const push = (map: Record<string, string[]>, key: string, value: string) => {
  const list = (map[key] ??= []);
  if (!list.includes(value)) list.push(value);
};

/** Builds the index; rules over the caps are dropped (the lists put the most common first). */
export function buildCosmeticIndex(rules: readonly CosmeticRule[], caps: CosmeticCaps = DEFAULT_COSMETIC_CAPS): CosmeticIndex {
  const generic = new Set<string>();
  const hosts: Record<string, string[]> = Object.create(null);
  const exceptions: Record<string, string[]> = Object.create(null);
  let specific = 0;
  for (const rule of rules) {
    if (rule.exception) {
      for (const domain of rule.include ?? []) push(exceptions, domain, rule.selector);
    } else if (rule.include?.length) {
      if (specific + rule.include.length > caps.specific) continue;
      specific += rule.include.length;
      for (const domain of rule.include) push(hosts, domain, rule.selector);
      // `a.com,~b.a.com##x`: not on b.a.com.
      for (const domain of rule.exclude ?? []) push(exceptions, domain, rule.selector);
    } else if (generic.size < caps.generic) {
      generic.add(rule.selector);
      for (const domain of rule.exclude ?? []) push(exceptions, domain, rule.selector);
    }
  }
  return { version: 1, generic: [...generic], hosts: { ...hosts }, exceptions: { ...exceptions } };
}

/** The selectors to hide on a page of `host` (lowercase). */
export function cosmeticSelectors(index: CosmeticIndex, host: string): string[] {
  const suffixes = host ? hostSuffixes(host.toLowerCase()) : [];
  const excluded = new Set<string>();
  for (const suffix of suffixes) for (const selector of index.exceptions[suffix] ?? []) excluded.add(selector);
  const out = new Set<string>();
  for (const selector of index.generic) if (!excluded.has(selector)) out.add(selector);
  for (const suffix of suffixes) for (const selector of index.hosts[suffix] ?? []) if (!excluded.has(selector)) out.add(selector);
  return [...out];
}

/**
 * The style sheet hiding `selectors`. Grouped by `group`: one invalid selector drops its whole
 * group only (a browser ignores a rule whose selector list has an unknown selector). Selectors
 * are re-checked here, as the index is data read at run time.
 */
export function cosmeticCss(selectors: readonly string[], group = 30): string {
  const safe = selectors.filter(isSafeSelector);
  const rules: string[] = [];
  for (let start = 0; start < safe.length; start += group) rules.push(`${safe.slice(start, start + group).join(",")}{display:none!important}`);
  return rules.join("\n");
}

/** Validates an index read from storage or the bundle (shape only; selectors are checked by `cosmeticCss`). */
export function sanitizeCosmeticIndex(value: unknown): CosmeticIndex {
  const input = (typeof value === "object" && value !== null ? value : {}) as Partial<CosmeticIndex>;
  const strings = (list: unknown): string[] => (Array.isArray(list) ? list.filter((item): item is string => typeof item === "string") : []);
  const map = (record: unknown): Record<string, string[]> => {
    const out: Record<string, string[]> = Object.create(null);
    if (typeof record === "object" && record !== null) for (const [key, list] of Object.entries(record)) out[key] = strings(list);
    return out;
  };
  return { version: 1, generic: strings(input.generic), hosts: map(input.hosts), exceptions: map(input.exceptions) };
}
