import type { NetworkRule } from "./parse";

/**
 * The Android request filter (ADR-051): a compact, JSON-serializable index of the domain-anchored
 * rules, looked up by host suffix for each request in `shouldInterceptRequest`. `matchRequest`
 * is the reference implementation; the Kotlin matcher of `mobile/modules/content-blocker` follows
 * it line by line (keep them in step; the shared tests document the behavior).
 *
 * Kept: rules without resource types (a WebView request does not say its type), whose path is a
 * plain prefix (`/ads/`, a trailing `^` or `|` allowed). Dropped: paths with `*` or an inner `^`.
 */

/** Party flag of an entry: 0 both, 1 third-party only, 2 first-party only. */
export type PartyFlag = 0 | 1 | 2;

/** `[host, path?, party?, include?, exclude?]`, trailing defaults omitted to keep the file small. */
export type IndexEntry = [string, string?, PartyFlag?, string[]?, string[]?];

export interface NetworkIndex {
  version: 1;
  block: IndexEntry[];
  allow: IndexEntry[];
}

/** Whether the Android filter can apply `rule` exactly (see the module comment). */
export function androidCompatible(rule: NetworkRule): boolean {
  if (rule.types?.length) return false;
  if (!rule.path) return true;
  const path = rule.path.replace(/[\^|]$/, "");
  return path.startsWith("/") && !/[*^|]/.test(path);
}

function entryOf(rule: NetworkRule): IndexEntry {
  const path = rule.path.replace(/[\^|]$/, "");
  const party: PartyFlag = rule.thirdParty === true ? 1 : rule.thirdParty === false ? 2 : 0;
  const entry: IndexEntry = [rule.host, path, party, rule.include ?? [], rule.exclude ?? []];
  while (entry.length > 1) {
    const last = entry[entry.length - 1];
    if (last === "" || last === 0 || (Array.isArray(last) && last.length === 0)) entry.pop();
    else break;
  }
  return entry;
}

/** Builds the index from parsed rules (incompatible ones dropped), at most `maxRules` blocking entries. */
export function buildNetworkIndex(rules: readonly NetworkRule[], maxRules = 100_000): NetworkIndex {
  const block: IndexEntry[] = [];
  const allow: IndexEntry[] = [];
  for (const rule of rules) {
    if (!androidCompatible(rule)) continue;
    if (rule.exception) allow.push(entryOf(rule));
    else if (block.length < maxRules) block.push(entryOf(rule));
  }
  return { version: 1, block, allow };
}

/** Second-level labels under which registrable domains have three labels (`example.co.uk`). */
const SECOND_LEVEL = new Set(["co", "com", "org", "net", "gov", "ac", "edu", "ne", "or", "go", "gouv", "asso"]);

/**
 * The site of a host, approximated without the public suffix list (the Kotlin side has none
 * either): the last two labels, or three under a short second level of a country domain.
 */
export function approximateSite(host: string): string {
  const labels = host.toLowerCase().replace(/\.$/, "").split(".");
  if (labels.length <= 2 || /^\d+$/.test(labels[labels.length - 1])) return labels.join(".");
  const tld = labels[labels.length - 1];
  const second = labels[labels.length - 2];
  const take = tld.length === 2 && SECOND_LEVEL.has(second) ? 3 : 2;
  return labels.slice(-take).join(".");
}

/** Whether `host` is `domain` or one of its subdomains. */
export const hostMatches = (host: string, domain: string): boolean => host === domain || host.endsWith(`.${domain}`);

/** The host and its parent domains, longest first (`a.b.c` → `a.b.c`, `b.c`, `c`). */
export function hostSuffixes(host: string): string[] {
  const out: string[] = [];
  let rest = host;
  for (;;) {
    out.push(rest);
    const dot = rest.indexOf(".");
    if (dot === -1) return out;
    rest = rest.slice(dot + 1);
  }
}

export interface CompiledIndex {
  block: Map<string, IndexEntry[]>;
  allow: Map<string, IndexEntry[]>;
}

/** Groups the entries by host for lookups. */
export function compileIndex(index: NetworkIndex): CompiledIndex {
  const group = (entries: IndexEntry[]) => {
    const map = new Map<string, IndexEntry[]>();
    for (const entry of entries) {
      const list = map.get(entry[0]);
      if (list) list.push(entry);
      else map.set(entry[0], [entry]);
    }
    return map;
  };
  return { block: group(index.block), allow: group(index.allow) };
}

export interface RequestInfo {
  /** The request's host, lowercase. */
  host: string;
  /** Path and query of the request (`/a/b?c`). */
  path: string;
  /** Host of the page (main document) that made it, lowercase ("" when unknown). */
  pageHost: string;
}

function entryApplies(entry: IndexEntry, request: RequestInfo, thirdParty: boolean): boolean {
  const [, path = "", party = 0, include = [], exclude = []] = entry;
  if (path && !request.path.startsWith(path)) return false;
  if (party === 1 && !thirdParty) return false;
  if (party === 2 && thirdParty) return false;
  if (include.length && !include.some((domain) => hostMatches(request.pageHost, domain))) return false;
  if (exclude.some((domain) => hostMatches(request.pageHost, domain))) return false;
  return true;
}

function anyApplies(map: Map<string, IndexEntry[]>, request: RequestInfo, thirdParty: boolean): IndexEntry | null {
  for (const suffix of hostSuffixes(request.host)) {
    for (const entry of map.get(suffix) ?? []) if (entryApplies(entry, request, thirdParty)) return entry;
  }
  return null;
}

/** The blocking entry that applies to the request, or null (no rule, or an exception wins). */
export function matchRequest(index: CompiledIndex, request: RequestInfo): IndexEntry | null {
  const thirdParty = !request.pageHost || approximateSite(request.host) !== approximateSite(request.pageHost);
  const blocked = anyApplies(index.block, request, thirdParty);
  if (!blocked) return null;
  return anyApplies(index.allow, request, thirdParty) ? null : blocked;
}
