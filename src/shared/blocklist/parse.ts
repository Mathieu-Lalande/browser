/**
 * A subset of the Adblock Plus / uBlock Origin filter syntax (ADR-051), enough to turn EasyList
 * and EasyPrivacy into the mobile app's native rules:
 *
 * - network rules anchored on a domain (`||host^`, `||host/path`, `||host^*path`), exceptions `@@`;
 * - options `$third-party` / `$~third-party` (`3p`, `1p`, `first-party`), `$domain=a|~b`,
 *   resource types (`script`, `image`, `stylesheet`, `xmlhttprequest`, `subdocument`, `font`,
 *   `media`, `ping`, `websocket`, `other`), `important` and `match-case` (ignored);
 * - element hiding `##` and its exceptions `#@#`, generic or for listed domains (`a.com,~b.a.com##…`).
 *
 * Everything else is skipped, never approximated: regular expressions, rules not anchored on a
 * domain, wildcard domains (`google.*`), redirects, `$csp`, `$removeparam`, scriptlets (`##+js`),
 * procedural and extended selectors, HTML filtering. Pure: shared by the build script and tests.
 */

export type ResourceType = "script" | "image" | "stylesheet" | "xmlhttprequest" | "subdocument" | "font" | "media" | "ping" | "websocket" | "other";

export interface NetworkRule {
  /** Lowercase host the rule is anchored on (`||host`): matches it and its subdomains. */
  host: string;
  /** What follows the host in the filter (`""` = the whole host), in filter syntax (`^`, `*`, trailing `|`). */
  path: string;
  /** `true`: third-party requests only; `false`: first-party only; absent: both. */
  thirdParty?: boolean;
  /** Resource types the rule is limited to (absent: all). */
  types?: ResourceType[];
  /** Page domains the rule is limited to (`$domain=a`). */
  include?: string[];
  /** Page domains the rule does not apply on (`$domain=~a`). */
  exclude?: string[];
  /** `@@`: an exception, wins over blocking rules. */
  exception: boolean;
}

export interface CosmeticRule {
  selector: string;
  /** Domains the rule is limited to (absent: generic). */
  include?: string[];
  /** Domains where it does not apply. */
  exclude?: string[];
  /** `#@#`: an exception (the selector is not hidden on `include`). */
  exception: boolean;
}

export interface ParsedList {
  network: NetworkRule[];
  cosmetic: CosmeticRule[];
  /** Lines that were filters but are not supported (comments and blank lines are not counted). */
  skipped: number;
}

const TYPE_OPTIONS: Record<string, ResourceType> = {
  script: "script",
  image: "image",
  stylesheet: "stylesheet",
  css: "stylesheet",
  xmlhttprequest: "xmlhttprequest",
  xhr: "xmlhttprequest",
  subdocument: "subdocument",
  frame: "subdocument",
  font: "font",
  media: "media",
  ping: "ping",
  websocket: "websocket",
  other: "other",
};

const HOST = /^(?=.{1,253}$)[a-z\d-]+(\.[a-z\d-]+)+$/;
/** Characters that may follow the host in a filter (`||host^`, `||host/`, `||host*`, `||host|`, `||host:`). */
const HOST_END = /[\^/*|:?]/;
/** Extended or procedural selectors, scriptlets, HTML filters: need code in the page, not CSS. */
const UNSUPPORTED_SELECTOR =
  /:-abp-|:has-text\(|:contains\(|:matches-|:upward\(|:xpath\(|:remove\(|:style\(|:min-text-length\(|:watch-attr\(|:others\(|:nth-ancestor\(|:if\(|:if-not\(|:properties\(|^\+js\(|^\^/;

/** A lowercase ASCII domain from a filter's domain list, or null (wildcard, IDN, garbage). */
export function filterDomain(value: string): string | null {
  const domain = value.trim().toLowerCase();
  return HOST.test(domain) ? domain : null;
}

/** Splits `a|~b` (or `a,~b` for cosmetics) into included and excluded domains; null if any is unsupported. */
function domainList(value: string, separator: string): { include: string[]; exclude: string[] } | null {
  const include: string[] = [];
  const exclude: string[] = [];
  for (const raw of value.split(separator)) {
    if (!raw) continue;
    const negated = raw.startsWith("~");
    const domain = filterDomain(negated ? raw.slice(1) : raw);
    if (!domain) return null;
    (negated ? exclude : include).push(domain);
  }
  return { include, exclude };
}

/** A selector safe to put in a style sheet: no braces (no way out of the rule), bounded, no control characters. */
export function isSafeSelector(selector: string): boolean {
  return (
    selector.length > 0 &&
    selector.length <= 500 &&
    !/[{}\\<>]|\/\*/.test(selector) &&
    // eslint-disable-next-line no-control-regex
    !/[\u0000-\u001f\u007f]/.test(selector) &&
    !UNSUPPORTED_SELECTOR.test(selector)
  );
}

function parseCosmetic(line: string, at: number, exception: boolean): CosmeticRule | null {
  const domains = line.slice(0, at);
  const selector = line.slice(at + (exception ? 3 : 2)).trim();
  if (!isSafeSelector(selector)) return null;
  const list = domains ? domainList(domains, ",") : { include: [], exclude: [] };
  if (!list) return null;
  // An exception without domains (`#@#.ad`) would disable a generic rule everywhere: not supported.
  if (exception && !list.include.length) return null;
  const rule: CosmeticRule = { selector, exception };
  if (list.include.length) rule.include = list.include;
  if (list.exclude.length) rule.exclude = list.exclude;
  return rule;
}

function parseOptions(text: string, rule: NetworkRule): boolean {
  for (const raw of text.split(",")) {
    const option = raw.trim().toLowerCase();
    if (!option) continue;
    if (option === "third-party" || option === "3p") rule.thirdParty = true;
    else if (option === "~third-party" || option === "1p" || option === "first-party" || option === "~3p") rule.thirdParty = false;
    else if (option === "important" || option === "match-case") continue;
    else if (option.startsWith("domain=") || option.startsWith("from=")) {
      const list = domainList(option.slice(option.indexOf("=") + 1), "|");
      if (!list) return false;
      if (list.include.length) rule.include = list.include;
      if (list.exclude.length) rule.exclude = list.exclude;
    } else if (option in TYPE_OPTIONS) {
      (rule.types ??= []).push(TYPE_OPTIONS[option]);
    } else return false; // Negated types, redirects, csp, removeparam, document, popup…: not supported.
  }
  return true;
}

function parseNetwork(line: string): NetworkRule | null {
  const exception = line.startsWith("@@");
  let body = exception ? line.slice(2) : line;
  if (!body.startsWith("||")) return null;
  const rule: NetworkRule = { host: "", path: "", exception };
  const dollar = body.lastIndexOf("$");
  if (dollar !== -1) {
    if (!parseOptions(body.slice(dollar + 1), rule)) return null;
    body = body.slice(0, dollar);
  }
  body = body.slice(2);
  const end = body.search(HOST_END);
  const host = (end === -1 ? body : body.slice(0, end)).toLowerCase();
  if (!HOST.test(host)) return null;
  rule.host = host;
  let path = end === -1 ? "" : body.slice(end);
  // `||host^`, `||host^|`, `||host/` and `||host` mean the same: the whole host.
  if (path === "^" || path === "^|" || path === "/" || path === "|") path = "";
  if (path.startsWith(":")) return null; // Ports: not supported.
  rule.path = path;
  if (rule.types) rule.types = [...new Set(rule.types)];
  return rule;
}

/** Parses a filter list. */
export function parseFilterList(text: string): ParsedList {
  const network: NetworkRule[] = [];
  const cosmetic: CosmeticRule[] = [];
  let skipped = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("!") || line.startsWith("[")) continue;
    const hide = line.indexOf("##");
    const unhide = line.indexOf("#@#");
    let parsed: NetworkRule | CosmeticRule | null = null;
    if (unhide !== -1 && (hide === -1 || unhide < hide)) parsed = parseCosmetic(line, unhide, true);
    else if (hide !== -1) parsed = parseCosmetic(line, hide, false);
    else if (/#[@?$%]*[?$%]#|#\+js|\$\$/.test(line)) parsed = null;
    else parsed = parseNetwork(line);
    if (!parsed) skipped++;
    else if ("selector" in parsed) cosmetic.push(parsed);
    else network.push(parsed);
  }
  return { network, cosmetic, skipped };
}

/** A stable key of a network rule (duplicates across lists are dropped). */
export function networkRuleKey(rule: NetworkRule): string {
  return [rule.exception ? "@@" : "", rule.host, rule.path, rule.thirdParty ?? "", rule.types?.join("|") ?? "", rule.include?.join("|") ?? "", rule.exclude?.join("|") ?? ""].join("\u0001");
}
