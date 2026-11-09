import { t } from "@shared/i18n";
import {
  BOOST_FONTS,
  boostCss,
  matchesHost,
  matchSpecificity,
  newBoost,
  removeZap,
  scriptAllowed,
  siteBoost,
  upsertBoost,
  type Boost,
  type BoostFont,
} from "@shared/boosts";

/**
 * Boosts on the phone (ADR-029): the shared model, applied by scripts the WebView injects. There
 * is no isolated world in react-native-webview: a boost's script (off by default) runs in the
 * page's own world, which the editor says. No zap tool here: zaps come from the desktop by sync.
 */

/** What the injected script needs per boost: its pattern, CSS and (allowed) script. */
export interface BoostPayload {
  match: string;
  css: string;
  script: string;
}

/** Enabled boosts, least specific first (the page's CSS follows this order), for a normal or private tab. */
export function boostPayload(boosts: readonly Boost[], isPrivate: boolean): BoostPayload[] {
  return boosts
    .filter((boost) => boost.enabled)
    .sort((a, b) => matchSpecificity(a.match) - matchSpecificity(b.match))
    .map((boost) => ({ match: boost.match, css: boostCss(boost), script: scriptAllowed(boost, isPrivate) ? boost.script.code : "" }))
    .filter((item) => item.css || item.script);
}

/**
 * The boosts of one host, filtered in the app: a page never receives the CSS or scripts of the
 * user's boosts for other sites. Null host (not a web page): none.
 */
export function boostsForHost(payload: readonly BoostPayload[], host: string | null): BoostPayload[] {
  return host ? payload.filter((item) => matchesHost(item.match, host)) : [];
}

/**
 * The script run in pages, built for one host's boosts (`boostsForHost`). At document start
 * (`injectedJavaScriptBeforeContentLoaded`) and again after the load (the start script may have
 * been built for the previous host), it puts the boosts' CSS in a style element and runs their
 * scripts once per document; with `styleOnly` (a boost changed while the page is open) it only
 * replaces the CSS. It does nothing in a document of another host; matching is checked again in
 * the page against `location.hostname`, with the same rules as `matchesHost`.
 */
export function boostScript(payload: readonly BoostPayload[], host: string | null, styleOnly = false): string {
  return `(function () {
  try {
    var list = ${JSON.stringify(payload)};
    var host = String(location.hostname || "").toLowerCase();
    if (!/^https?:$/.test(location.protocol) || host !== ${JSON.stringify(host ?? "")}) return;
    var matches = function (pattern) {
      if (pattern.indexOf("*.") === 0) { var domain = pattern.slice(2); return host === domain || host.slice(-domain.length - 1) === "." + domain; }
      return host === pattern;
    };
    var css = [], scripts = [];
    for (var i = 0; i < list.length; i++) if (matches(list[i].match)) { if (list[i].css) css.push(list[i].css); if (list[i].script) scripts.push(list[i].script); }
    var style = document.getElementById("__browser-boosts");
    if (css.length) {
      if (!style) { style = document.createElement("style"); style.id = "__browser-boosts"; (document.head || document.documentElement).appendChild(style); }
      style.textContent = css.join("\\n");
    } else if (style) style.remove();
    if (${styleOnly ? "true" : "false"} || window.__browserBoostScripts) return;
    window.__browserBoostScripts = true;
    for (var j = 0; j < scripts.length; j++) { try { (0, eval)(scripts[j]); } catch (error) { console.warn("Boost:", error); } }
  } catch (error) {}
})();
true;`;
}

// --- Per-site toggles (page menu) ---------------------------------------------------------------

export type QuickFilter = "invert" | "grayscale" | "sepia";
export const QUICK_FILTERS: readonly { key: QuickFilter; label: string }[] = [
  { key: "invert", get label() { return t("mobile.boosts.invertColors") } },
  { key: "grayscale", get label() { return t("mobile.boosts.grayscale") } },
  { key: "sepia", get label() { return t("mobile.boosts.sepia") } },
];

export const filterOn = (boost: Boost, key: QuickFilter) => (key === "invert" ? boost.filters.invert : boost.filters[key] > 0);

export function toggleFilter(boost: Boost, key: QuickFilter, now: number): Boost {
  const filters = key === "invert" ? { ...boost.filters, invert: !boost.filters.invert } : { ...boost.filters, [key]: boost.filters[key] > 0 ? 0 : 100 };
  return { ...boost, filters, updatedAt: now };
}

/** The next font of the cycle "site's own → system → … → site's own". */
export function nextFont(font: BoostFont | null): BoostFont | null {
  const fonts = Object.keys(BOOST_FONTS) as BoostFont[];
  const index = font ? fonts.indexOf(font) : -1;
  return index + 1 < fonts.length ? fonts[index + 1] : null;
}

export const fontLabel = (font: BoostFont | null) => (font ? BOOST_FONTS[font].label : t("mobile.boosts.siteFont"));

/** The page's boost, created when it has none (null: not a web page). */
export function ensureSiteBoost(boosts: readonly Boost[], url: string, host: string, id: string, now: number): { boosts: Boost[]; boost: Boost } {
  const existing = siteBoost(boosts, url);
  if (existing) return { boosts: [...boosts], boost: existing };
  const boost = newBoost(id, host, now);
  return { boosts: upsertBoost(boosts, boost), boost };
}

export { removeZap, siteBoost, upsertBoost };
