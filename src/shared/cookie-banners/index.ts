export { COOKIE_BANNER_RULES, type BannerStep, type CookieBannerRule } from "./rules";
export { DEFAULT_AGENT_OPTIONS, cookieBannerAgent, type AgentOptions, type BannerDom, type BannerOutcome, type BannerResult } from "./agent";

import type { BannerResult } from "./agent";
import { COOKIE_BANNER_RULES } from "./rules";

const OUTCOMES = new Set(["rejected", "hidden", "failed", "none"]);
const CMP_IDS = new Set(COOKIE_BANNER_RULES.map((rule) => rule.id));

/** The agent's answer as it comes back from the page (untrusted: the page shares the DOM), or null. */
export function sanitizeBannerResult(value: unknown): BannerResult | null {
  if (typeof value !== "object" || value === null) return null;
  const { cmp, outcome } = value as { cmp?: unknown; outcome?: unknown };
  if (typeof outcome !== "string" || !OUTCOMES.has(outcome)) return null;
  return { cmp: typeof cmp === "string" && CMP_IDS.has(cmp) ? cmp : null, outcome: outcome as BannerResult["outcome"] };
}

/** Whether the banner was dealt with (counted in the privacy dashboard). */
export const bannerHandled = (result: BannerResult | null): boolean => result?.outcome === "rejected" || result?.outcome === "hidden";

/**
 * The style sheet hiding a CMP's banner (the fallback when no refusal works): its elements, and
 * the scroll lock it puts on the page released. Main inserts it with the user origin, out of the
 * page's sight.
 */
export function bannerHideCss(cmp: string): string {
  const rule = COOKIE_BANNER_RULES.find((candidate) => candidate.id === cmp);
  if (!rule) return "";
  const hide = `${rule.hide.join(",\n")} { display: none !important; }`;
  return rule.unlock?.length ? `${hide}\n${rule.unlock.join(", ")} { overflow: auto !important; }` : hide;
}
