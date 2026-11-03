import { dominantColor, mixHex } from "@shared/site-color";
import type { accentVariables } from "@shared/theme";

/**
 * Dynamic theme (ADR-038), chrome UI side: the favicon's dominant color (decoded with a canvas,
 * the color math is in `@shared/site-color`) and the accent transition.
 */

export type AccentVars = ReturnType<typeof accentVariables>;
const NAMES = ["--accent", "--accent-text", "--on-accent"] as const;

/** Favicon (`data:` URL) → dominant color; null: none or monochrome. Cached per favicon. */
const faviconColors = new Map<string, Promise<string | null>>();
const FAVICON_CACHE_MAX = 64;
/** Favicons are sampled at this size: enough for a dominant color, cheap to scan. */
const SAMPLE = 24;

export function faviconColor(src: string): Promise<string | null> {
  let color = faviconColors.get(src);
  if (!color) {
    color = sample(src);
    faviconColors.set(src, color);
    if (faviconColors.size > FAVICON_CACHE_MAX) faviconColors.delete(faviconColors.keys().next().value!);
  }
  return color;
}

async function sample(src: string): Promise<string | null> {
  // Only the favicons main hands over (`data:` URLs, ADR-018): nothing is fetched from here.
  if (!src.startsWith("data:image/")) return null;
  try {
    const image = new Image();
    image.src = src;
    await image.decode();
    const canvas = new OffscreenCanvas(SAMPLE, SAMPLE);
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return null;
    context.drawImage(image, 0, 0, SAMPLE, SAMPLE);
    return dominantColor(context.getImageData(0, 0, SAMPLE, SAMPLE).data);
  } catch {
    return null;
  }
}

/** The theme's own accent variables, as `applyTheme` set them on :root. */
function themeAccent(): AccentVars {
  const style = document.documentElement.style;
  return Object.fromEntries(NAMES.map((name) => [name, style.getPropertyValue(name).trim()])) as AccentVars;
}

/** `--motion-base` in ms (0 when motion is reduced, by the user or the system). */
function motionBase(): number {
  const value = getComputedStyle(document.documentElement).getPropertyValue("--motion-base").trim();
  const ms = value.endsWith("ms") ? parseFloat(value) : value.endsWith("s") ? parseFloat(value) * 1000 : 0;
  return Number.isFinite(ms) ? ms : 0;
}

/**
 * Moves the shown accent from `from` to `to` (null: the theme's own accent) over `--motion-base`,
 * mixing in OKLab frame by frame; the last frame is exactly `to`. Returns a cancel function.
 * (Registering the variables with `@property` to transition them in CSS would turn every
 * `--accent` into `rgb()` for everything that reads it.)
 */
export function animateAccent(from: AccentVars | null, to: AccentVars | null, set: (value: AccentVars | null) => void): () => void {
  const duration = motionBase();
  const start = from ?? themeAccent();
  const end = to ?? themeAccent();
  if (duration <= 0 || NAMES.every((name) => start[name] === end[name]) || NAMES.some((name) => !start[name] || !end[name])) {
    set(to);
    return () => {};
  }
  const began = performance.now();
  let frame = requestAnimationFrame(function step(now) {
    const t = Math.min(1, (now - began) / duration);
    if (t >= 1) return set(to);
    const eased = 1 - (1 - t) ** 3;
    set(Object.fromEntries(NAMES.map((name) => [name, mixHex(start[name], end[name], eased)])) as AccentVars);
    frame = requestAnimationFrame(step);
  });
  return () => cancelAnimationFrame(frame);
}
