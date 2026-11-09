import { buildCosmeticIndex, DEFAULT_COSMETIC_CAPS, type CosmeticCaps, type CosmeticIndex } from "./cosmetic";
import { androidCompatible, buildNetworkIndex, type NetworkIndex } from "./network";
import { networkRuleKey, parseFilterList, type CosmeticRule, type NetworkRule } from "./parse";
import { buildWebKitLists, toWebKitRule, WEBKIT_MAX_RULES_PER_LIST, type WebKitRule } from "./webkit";

export * from "./parse";
export * from "./network";
export * from "./webkit";
export * from "./cosmetic";

export interface BlocklistCaps {
  /** Rules per WebKit list (lists are split beyond). */
  webkitPerList: number;
  /** Blocking rules for iOS, all lists together. */
  webkitTotal: number;
  /** Blocking entries of the Android index. */
  android: number;
  cosmetic: CosmeticCaps;
}

export const DEFAULT_BLOCKLIST_CAPS: BlocklistCaps = { webkitPerList: WEBKIT_MAX_RULES_PER_LIST, webkitTotal: 150_000, android: 150_000, cosmetic: DEFAULT_COSMETIC_CAPS };

export interface BlocklistBuild {
  webkit: WebKitRule[][];
  android: NetworkIndex;
  cosmetic: CosmeticIndex;
  stats: { network: number; cosmetic: number; skipped: number; webkit: number; android: number };
}

/** Converts filter lists (in priority order) into the phone's three outputs (ADR-051). */
export function buildBlocklists(lists: readonly string[], caps: BlocklistCaps = DEFAULT_BLOCKLIST_CAPS): BlocklistBuild {
  const seen = new Set<string>();
  const network: NetworkRule[] = [];
  const cosmetic: CosmeticRule[] = [];
  let skipped = 0;
  for (const text of lists) {
    const parsed = parseFilterList(text);
    skipped += parsed.skipped;
    for (const rule of parsed.network) {
      const key = networkRuleKey(rule);
      if (seen.has(key)) continue;
      seen.add(key);
      network.push(rule);
    }
    cosmetic.push(...parsed.cosmetic);
  }
  const webkit = buildWebKitLists(network, caps.webkitPerList, caps.webkitTotal);
  const android = buildNetworkIndex(network, caps.android);
  return {
    webkit,
    android,
    cosmetic: buildCosmeticIndex(cosmetic, caps.cosmetic),
    stats: {
      network: network.length,
      cosmetic: cosmetic.length,
      skipped,
      webkit: network.filter((rule) => !rule.exception && toWebKitRule(rule)).length,
      android: network.filter((rule) => !rule.exception && androidCompatible(rule)).length,
    },
  };
}
