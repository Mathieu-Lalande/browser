/**
 * Forced dark pages (ADR-059): web pages without a dark theme of their own are drawn dark. The
 * global switch is `appearance.darkPages` ("off", "on", or "auto": when the browser's theme is
 * dark), and `appearance.darkPagesSites` lists the sites where the user flipped it for that site
 * only. A page that is already dark (its own dark theme, or a dark design) is never inverted.
 * Pure: the decision, the stylesheet, and the probe run in the page's isolated world.
 */

export type DarkPagesMode = "off" | "on" | "auto";

/** The site key of a host: without "www.". */
export const darkSiteOf = (host: string): string => host.toLowerCase().replace(/^www\./u, "");

/** Whether pages of `host` get the dark stylesheet. `themeIsDark`: the browser's theme on screen. */
export function wantsDarkPage(mode: DarkPagesMode, flipped: readonly string[], host: string, themeIsDark: boolean): boolean {
  if (!host) return false;
  const global = mode === "on" || (mode === "auto" && themeIsDark);
  return flipped.includes(darkSiteOf(host)) ? !global : global;
}

/** The new site list after the page options' switch for `host`. */
export function toggleDarkSite(flipped: readonly string[], host: string): string[] {
  const site = darkSiteOf(host);
  return flipped.includes(site) ? flipped.filter((entry) => entry !== site) : [...flipped, site];
}

/**
 * The inverting stylesheet: the whole page inverted and turned back on its hues, then media
 * inverted again so photos and videos keep their colors. Applied with `insertCSS` (removable).
 */
export const DARK_PAGE_CSS = `
html { filter: invert(0.9) hue-rotate(180deg) !important; background: #fff !important; color-scheme: light !important; }
img, video, picture, canvas, svg image, iframe, embed, object, [style*="background-image"] { filter: invert(1) hue-rotate(180deg) !important; }
`;

/**
 * Isolated-world probe: true when the page is light (its root or body background, or the page's
 * declared color scheme), so it needs the stylesheet. A page with a dark background says false.
 */
export const DARK_PAGE_PROBE = `(() => {
  const parse = (value) => { const m = /rgba?\\(([\\d.]+),\\s*([\\d.]+),\\s*([\\d.]+)(?:,\\s*([\\d.]+))?\\)/.exec(value || ""); return m ? { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] } : null; };
  const background = (element) => { const color = element ? parse(getComputedStyle(element).backgroundColor) : null; return color && color.a > 0.5 ? color : null; };
  const color = background(document.body) || background(document.documentElement) || { r: 255, g: 255, b: 255 };
  const luminance = (0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b) / 255;
  return luminance > 0.5;
})()`;
