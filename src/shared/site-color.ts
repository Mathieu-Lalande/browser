import { normalizeHex } from "./settings";
import { fromOklch, parseHex, toHex, toOklch, type Rgb } from "./theme";

/**
 * Dynamic theme (ADR-038): the color of the site on screen, picked from its `theme-color` or its
 * favicon, then handed to the contrast engine (`accentVariables`). Pure color math, no DOM.
 */

/** Below this OKLCH chroma a color is a grey: it says nothing about the site, the space color stays. */
export const MIN_SITE_CHROMA = 0.045;

/** A site color worth following: chromatic, and neither near-black nor near-white. */
export function isAccentWorthy(hex: string): boolean {
  const rgb = parseHex(hex);
  if (!rgb) return false;
  const { l, c } = toOklch(rgb);
  return c >= MIN_SITE_CHROMA && l >= 0.2 && l <= 0.97;
}

/** `theme-color` as pages write it: `#rgb`, `#rrggbb`, `rgb(r, g, b)` / `rgb(r g b / a)`. Else null. */
export function normalizeThemeColor(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 64) return null;
  const hex = normalizeHex(value);
  if (hex) return hex;
  const match = /^rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})\s*(?:[,/]\s*[\d.]+%?\s*)?\)$/i.exec(value.trim());
  if (!match) return null;
  const [r, g, b] = match.slice(1, 4).map(Number);
  if ([r, g, b].some((v) => v > 255)) return null;
  return toHex({ r: r / 255, g: g / 255, b: b / 255 });
}

/** Hue buckets of the favicon histogram (degrees per bucket: 360 / HUE_BUCKETS). */
const HUE_BUCKETS = 24;

/**
 * The dominant color of an image, from its RGBA bytes (canvas `ImageData.data` order): opaque,
 * chromatic pixels are grouped by hue, weighted by chroma (a logo's brand color beats its
 * anti-aliased edges), and the heaviest group's average is returned. Greys, white and black
 * backgrounds are ignored. null when nothing chromatic is found.
 */
export function dominantColor(rgba: ArrayLike<number>): string | null {
  const buckets = Array.from({ length: HUE_BUCKETS }, () => ({ weight: 0, r: 0, g: 0, b: 0 }));
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    if (rgba[i + 3] < 128) continue;
    const color: Rgb = { r: rgba[i] / 255, g: rgba[i + 1] / 255, b: rgba[i + 2] / 255 };
    const { l, c, h } = toOklch(color);
    if (c < MIN_SITE_CHROMA || l < 0.15 || l > 0.97) continue;
    const bucket = buckets[Math.floor((((h % 360) + 360) % 360) / (360 / HUE_BUCKETS)) % HUE_BUCKETS];
    bucket.weight += c;
    bucket.r += color.r * c;
    bucket.g += color.g * c;
    bucket.b += color.b * c;
  }
  const best = buckets.reduce((a, b) => (b.weight > a.weight ? b : a));
  if (best.weight === 0) return null;
  return toHex({ r: best.r / best.weight, g: best.g / best.weight, b: best.b / best.weight });
}

/** What the dynamic theme follows: the page's `theme-color`, else its favicon's color, else null (the space color). */
export function siteAccent(sources: { themeColor?: string | null; faviconColor?: string | null }): string | null {
  for (const candidate of [sources.themeColor, sources.faviconColor]) {
    const hex = candidate ? normalizeThemeColor(candidate) : null;
    if (hex && isAccentWorthy(hex)) return hex;
  }
  return null;
}

/** `a` → `b` at `t` (0…1), mixed in OKLab (no muddy midpoints), for the accent transition. */
export function mixHex(a: string, b: string, t: number): string {
  const from = parseHex(a);
  const to = parseHex(b);
  if (!from || !to) return t < 0.5 ? a : b;
  const x = toOklch(from);
  const y = toOklch(to);
  const k = Math.min(1, Math.max(0, t));
  const lab = (o: { c: number; h: number }) => [o.c * Math.cos((o.h * Math.PI) / 180), o.c * Math.sin((o.h * Math.PI) / 180)];
  const [xa, xb] = lab(x);
  const [ya, yb] = lab(y);
  const A = xa + (ya - xa) * k;
  const B = xb + (yb - xb) * k;
  return toHex(fromOklch({ l: x.l + (y.l - x.l) * k, c: Math.hypot(A, B), h: (Math.atan2(B, A) * 180) / Math.PI }));
}
