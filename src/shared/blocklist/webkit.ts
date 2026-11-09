import type { NetworkRule, ResourceType } from "./parse";

/**
 * The iOS rules (ADR-051): WebKit content blocker JSON (`WKContentRuleListStore` compiles it).
 * https://developer.apple.com/documentation/safariservices/creating-a-content-blocker
 *
 * One rule per filter: `url-filter` is a regular expression in WebKit's subset (no `|`, no
 * quantified groups), `if-domain`/`unless-domain` take `*domain` to include subdomains and cannot
 * be mixed in one trigger. Exceptions become `ignore-previous-rules`, which only reaches rules
 * of the same list: each list carries all the exceptions after its blocking rules.
 */

export interface WebKitRule {
  trigger: {
    "url-filter": string;
    "load-type"?: ("third-party" | "first-party")[];
    "resource-type"?: string[];
    "if-domain"?: string[];
    "unless-domain"?: string[];
  };
  action: { type: "block" | "ignore-previous-rules" };
}

/** WebKit compiles up to 150 000 rules per list; smaller lists compile faster and fail alone. */
export const WEBKIT_MAX_RULES_PER_LIST = 50_000;

const WEBKIT_TYPES: Record<ResourceType, string> = {
  script: "script",
  image: "image",
  stylesheet: "style-sheet",
  xmlhttprequest: "raw",
  subdocument: "document",
  font: "font",
  media: "media",
  ping: "raw",
  websocket: "raw",
  other: "raw",
};

const escapeRegex = (text: string) => text.replace(/[.?+()[\]{}|\\$^*]/g, "\\$&");

/** The `url-filter` of a domain-anchored filter, scheme and subdomains included. */
export function urlFilter(host: string, path: string): string {
  const prefix = `^[^:]+://+([^:/]+\\.)?${escapeRegex(host)}`;
  if (!path) return `${prefix}[:/]`;
  let regex = "";
  for (let index = 0; index < path.length; index++) {
    const char = path[index];
    const last = index === path.length - 1;
    if (char === "*") regex += ".*";
    else if (char === "^") regex += last ? "" : "[/:?&=]";
    else if (char === "|" && last) regex += "$";
    else regex += escapeRegex(char);
  }
  return prefix + regex;
}

/** The WebKit rule of a parsed network rule, or null when WebKit cannot express it. */
export function toWebKitRule(rule: NetworkRule): WebKitRule | null {
  if (rule.include?.length && rule.exclude?.length) return null;
  // WebKit only takes ASCII in `url-filter`.
  if (/[^\x20-\x7e]/.test(rule.path)) return null;
  const trigger: WebKitRule["trigger"] = { "url-filter": urlFilter(rule.host, rule.path) };
  if (rule.thirdParty !== undefined) trigger["load-type"] = [rule.thirdParty ? "third-party" : "first-party"];
  if (rule.types?.length) trigger["resource-type"] = [...new Set(rule.types.map((type) => WEBKIT_TYPES[type]))];
  if (rule.include?.length) trigger["if-domain"] = rule.include.map((domain) => `*${domain}`);
  if (rule.exclude?.length) trigger["unless-domain"] = rule.exclude.map((domain) => `*${domain}`);
  return { trigger, action: { type: rule.exception ? "ignore-previous-rules" : "block" } };
}

/**
 * Splits the rules into lists of at most `maxPerList`: blocking rules in chunks, followed in each
 * list by every exception (capped to half a list). Returns at least one list (possibly empty).
 */
export function buildWebKitLists(rules: readonly NetworkRule[], maxPerList = WEBKIT_MAX_RULES_PER_LIST, maxBlocking = Infinity): WebKitRule[][] {
  const blocking: WebKitRule[] = [];
  const exceptions: WebKitRule[] = [];
  for (const rule of rules) {
    const converted = toWebKitRule(rule);
    if (!converted) continue;
    if (rule.exception) {
      if (exceptions.length < Math.floor(maxPerList / 2)) exceptions.push(converted);
    } else if (blocking.length < maxBlocking) blocking.push(converted);
  }
  // One slot is kept free in each list for the per-site allowlist rule the app appends.
  const chunk = Math.max(1, maxPerList - exceptions.length - 1);
  const lists: WebKitRule[][] = [];
  for (let start = 0; start < blocking.length; start += chunk) lists.push([...blocking.slice(start, start + chunk), ...exceptions]);
  return lists.length ? lists : [[...exceptions]];
}

/**
 * The rule the app appends to each list for the sites where the shield is off: on pages of those
 * domains, nothing of the list applies. Null for an empty allowlist.
 */
export function allowlistRule(sites: readonly string[]): WebKitRule | null {
  const domains = sites.filter((site) => /^[a-z\d.-]+$/.test(site)).map((site) => `*${site}`);
  return domains.length ? { trigger: { "url-filter": ".*", "if-domain": domains }, action: { type: "ignore-previous-rules" } } : null;
}
