import { effectiveGutter, normalizeHex, pageRadius, type BackgroundStyle, type Density, type Settings, type UiFont } from "./settings";

/**
 * Theming engine: derives the whole chrome palette from an accent color and a light/dark mode.
 * Colors are built in OKLCH (perceptually uniform, so every accent gets the same visual weight)
 * and text tones are then nudged until they meet WCAG contrast targets. Pure, no DOM.
 */

export type ResolvedMode = "light" | "dark";

/** sRGB, channels in 0…1. */
export interface Rgb {
  r: number;
  g: number;
  b: number;
}

interface Oklch {
  l: number;
  c: number;
  /** Degrees. */
  h: number;
}

// --- Color math -------------------------------------------------------------------------------

export function parseHex(hex: string): Rgb | null {
  const normalized = normalizeHex(hex);
  if (!normalized) return null;
  const n = Number.parseInt(normalized.slice(1), 16);
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
}

const channel = (value: number) => Math.round(Math.min(1, Math.max(0, value)) * 255);

export function toHex({ r, g, b }: Rgb): string {
  return `#${[r, g, b].map((value) => channel(value).toString(16).padStart(2, "0")).join("")}`;
}

/** `#rrggbb`, or `rgb(r g b / alpha)` when translucent. */
function css(color: Rgb, alpha = 1): string {
  return alpha >= 1 ? toHex(color) : `rgb(${channel(color.r)} ${channel(color.g)} ${channel(color.b)} / ${alpha})`;
}

/** Parses what `derivePalette` emits (`#rrggbb` or `rgb(r g b / a)`). */
export function parseCssColor(value: string): { color: Rgb; alpha: number } | null {
  const hex = parseHex(value);
  if (hex) return { color: hex, alpha: 1 };
  const match = /^rgb\((\d+) (\d+) (\d+) \/ ([\d.]+)\)$/.exec(value);
  if (!match) return null;
  return { color: { r: +match[1] / 255, g: +match[2] / 255, b: +match[3] / 255 }, alpha: +match[4] };
}

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGamma = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

/** WCAG relative luminance. */
export function luminance({ r, g, b }: Rgb): number {
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

/** WCAG contrast ratio, 1…21. */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** `top` drawn with `alpha` over an opaque `bottom`. */
export function blend(top: Rgb, alpha: number, bottom: Rgb): Rgb {
  const mix = (t: number, b: number) => t * alpha + b * (1 - alpha);
  return { r: mix(top.r, bottom.r), g: mix(top.g, bottom.g), b: mix(top.b, bottom.b) };
}

function toOklch(color: Rgb): Oklch {
  const r = toLinear(color.r);
  const g = toLinear(color.g);
  const b = toLinear(color.b);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return { l: L, c: Math.hypot(A, B), h: (Math.atan2(B, A) * 180) / Math.PI };
}

function oklchToLinear({ l: L, c, h }: Oklch): Rgb {
  const A = c * Math.cos((h * Math.PI) / 180);
  const B = c * Math.sin((h * Math.PI) / 180);
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return {
    r: 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    g: -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    b: -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  };
}

/** OKLCH → sRGB, reducing chroma (not lightness) until the color fits the sRGB gamut. */
function fromOklch(color: Oklch): Rgb {
  const l = Math.min(1, Math.max(0, color.l));
  let c = color.c;
  let linear = oklchToLinear({ l, c, h: color.h });
  const inGamut = ({ r, g, b }: Rgb) => [r, g, b].every((v) => v >= -1e-4 && v <= 1 + 1e-4);
  while (!inGamut(linear) && c > 1e-4) {
    c *= 0.9;
    linear = oklchToLinear({ l, c, h: color.h });
  }
  const clamp = (v: number) => toGamma(Math.min(1, Math.max(0, v)));
  return { r: clamp(linear.r), g: clamp(linear.g), b: clamp(linear.b) };
}

/**
 * Moves `color`'s lightness in `direction` (+1 lighter, −1 darker) until it reaches `min`
 * contrast against every background (or the end of the lightness range).
 */
function ensureContrast(color: Oklch, backgrounds: Rgb[], min: number, direction: 1 | -1): Rgb {
  let current = { ...color };
  for (let step = 0; step < 120; step++) {
    const rgb = fromOklch(current);
    const atEnd = direction > 0 ? current.l >= 1 : current.l <= 0;
    if (atEnd || backgrounds.every((bg) => contrastRatio(rgb, bg) >= min)) return rgb;
    current = { ...current, l: Math.min(1, Math.max(0, current.l + direction * 0.01)) };
  }
  return fromOklch(current);
}

// --- Palette ----------------------------------------------------------------------------------

/** Minimum contrast ratios the palette guarantees (WCAG 2.x AA). */
export const CONTRAST = {
  /** Body text and secondary labels. */
  text: 4.5,
  /** Hints, placeholders, disabled states: decorative or large-ish, not essential to read. */
  faint: 3,
} as const;

export interface Palette {
  scheme: ResolvedMode;
  bg: string;
  bgElevated: string;
  surface: string;
  surfaceHover: string;
  surfaceActive: string;
  border: string;
  text: string;
  textMuted: string;
  textFaint: string;
  accent: string;
  accent2: string;
  /** Accent usable as text on the backgrounds (links, selected labels). */
  accentText: string;
  /** Text drawn on an accent fill. */
  onAccent: string;
}

const FALLBACK_ACCENT = "#8b7bff";

export function derivePalette(accentHex: string, accent2Hex: string, mode: ResolvedMode): Palette {
  const accentRgb = parseHex(accentHex) ?? parseHex(FALLBACK_ACCENT)!;
  const accent2Rgb = parseHex(accent2Hex) ?? accentRgb;
  const accent = toOklch(accentRgb);
  const h = accent.c < 0.01 ? 285 : accent.h;
  // Neutrals take a hint of the accent hue; grey accents give truly neutral greys.
  const tint = Math.min(accent.c, 0.16) * 0.12;
  const dark = mode === "dark";
  const toward: 1 | -1 = dark ? 1 : -1;

  const bg = fromOklch({ l: dark ? 0.175 : 0.955, c: tint, h });
  const bgElevated = fromOklch({ l: dark ? 0.218 : 0.997, c: dark ? tint * 1.1 : tint * 0.2, h });
  const overlay = fromOklch({ l: dark ? 0.985 : 0.25, c: tint * 1.5, h });
  const alphas = dark ? { surface: 0.05, hover: 0.085, active: 0.125, border: 0.09 } : { surface: 0.045, hover: 0.075, active: 0.11, border: 0.1 };
  // Text must stay readable on every background it can sit on, the strongest surface included.
  const grounds = [bg, bgElevated, blend(overlay, alphas.active, bg), blend(overlay, alphas.active, bgElevated)];

  const text = ensureContrast({ l: dark ? 0.955 : 0.2, c: tint * 0.6, h }, grounds, 7, toward);
  const textMuted = ensureContrast({ l: dark ? 0.76 : 0.48, c: tint * 1.4, h }, grounds, CONTRAST.text, toward);
  const textFaint = ensureContrast({ l: dark ? 0.6 : 0.62, c: tint * 1.4, h }, grounds, CONTRAST.faint, toward);
  const accentText = ensureContrast(accent, [bg, bgElevated], CONTRAST.text, toward);
  const white: Rgb = { r: 1, g: 1, b: 1 };
  const ink = fromOklch({ l: 0.16, c: tint, h });
  const onAccent = contrastRatio(white, accentRgb) >= contrastRatio(ink, accentRgb) ? white : ink;

  return {
    scheme: mode,
    bg: css(bg),
    bgElevated: css(bgElevated),
    surface: css(overlay, alphas.surface),
    surfaceHover: css(overlay, alphas.hover),
    surfaceActive: css(overlay, alphas.active),
    border: css(overlay, alphas.border),
    text: css(text),
    textMuted: css(textMuted),
    textFaint: css(textFaint),
    accent: toHex(accentRgb),
    accent2: toHex(accent2Rgb),
    accentText: css(accentText),
    onAccent: css(onAccent),
  };
}

/** OKLCH lightness range kept for user-picked space colors: never near-white nor near-black. */
export const SPACE_COLOR_LIGHTNESS = { min: 0.38, max: 0.82 } as const;

/**
 * A user-picked accent with its OKLCH lightness clamped to `SPACE_COLOR_LIGHTNESS` (hue and
 * chroma kept), so a space color always reads as a color on both themes. Invalid input: null.
 */
export function clampAccentLightness(hex: string, range: { min: number; max: number } = SPACE_COLOR_LIGHTNESS): string | null {
  const rgb = parseHex(hex);
  if (!rgb) return null;
  const color = toOklch(rgb);
  const l = Math.min(range.max, Math.max(range.min, color.l));
  return Math.abs(l - color.l) < 1e-6 ? toHex(rgb) : toHex(fromOklch({ ...color, l }));
}

/**
 * Accent variables for a color that overrides the theme accent (a space color), through the same
 * contrast engine as the theme: `--accent-text` reaches WCAG AA on the backgrounds of `mode`, and
 * `--on-accent` is the most readable ink on the (clamped) accent fill.
 */
export function accentVariables(color: string, mode: ResolvedMode): Record<"--accent" | "--accent-text" | "--on-accent", string> {
  const accent = clampAccentLightness(color) ?? FALLBACK_ACCENT;
  const palette = derivePalette(accent, accent, mode);
  return { "--accent": palette.accent, "--accent-text": palette.accentText, "--on-accent": palette.onAccent };
}

// --- Settings → CSS variables -----------------------------------------------------------------

export const DENSITY: Record<Density, { fontSize: number; tabHeight: number; controlHeight: number; iconButton: number; gap: number }> = {
  compact: { fontSize: 12.5, tabHeight: 30, controlHeight: 32, iconButton: 26, gap: 4 },
  comfortable: { fontSize: 13, tabHeight: 36, controlHeight: 36, iconButton: 30, gap: 6 },
  spacious: { fontSize: 14, tabHeight: 42, controlHeight: 40, iconButton: 34, gap: 8 },
};

export const FONT_STACKS: Record<UiFont, string> = {
  system: `"Inter Variable", Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`,
  rounded: `ui-rounded, "SF Pro Rounded", "Nunito", "Varela Round", "Quicksand", system-ui, sans-serif`,
  serif: `ui-serif, "Iowan Old Style", "Charter", "Georgia", "Cambria", "Noto Serif", serif`,
  mono: `ui-monospace, "JetBrains Mono", "Cascadia Code", "SF Mono", "Menlo", "Consolas", "DejaVu Sans Mono", monospace`,
};

const mix = (color: string, percent: number) => `color-mix(in oklab, var(${color}) ${percent}%, transparent)`;

/** The window backdrop behind the sidebar and around the page. */
export function backdrop(style: BackgroundStyle, mode: ResolvedMode): string {
  const k = mode === "dark" ? 1 : 0.8;
  if (style === "solid") return "var(--bg)";
  if (style === "mesh") {
    return [
      `radial-gradient(60% 55% at 0% 0%, ${mix("--accent", Math.round(34 * k))}, transparent 70%)`,
      `radial-gradient(55% 60% at 100% 0%, ${mix("--accent-2", Math.round(22 * k))}, transparent 70%)`,
      `radial-gradient(60% 60% at 100% 100%, ${mix("--accent", Math.round(24 * k))}, transparent 70%)`,
      `radial-gradient(55% 50% at 0% 100%, ${mix("--accent-2", Math.round(20 * k))}, transparent 70%)`,
      "var(--bg)",
    ].join(", ");
  }
  return [
    `radial-gradient(120% 80% at 0% 0%, ${mix("--accent", 16)}, transparent 60%)`,
    `radial-gradient(100% 70% at 100% 100%, ${mix("--accent-2", 10)}, transparent 60%)`,
    "var(--bg)",
  ].join(", ");
}

/** Every CSS custom property the chrome UI reads, for `settings` shown in `mode`. */
export function themeVariables(settings: Settings, mode: ResolvedMode): Record<string, string> {
  const { appearance, layout } = settings;
  const palette = derivePalette(appearance.accent, appearance.accent2, mode);
  const density = DENSITY[appearance.density];
  const shadow = mode === "dark" ? "rgb(0 0 0 / 0.5)" : "rgb(30 20 60 / 0.16)";
  return {
    "color-scheme": palette.scheme,
    "--bg": palette.bg,
    "--bg-elevated": palette.bgElevated,
    "--surface": palette.surface,
    "--surface-hover": palette.surfaceHover,
    "--surface-active": palette.surfaceActive,
    "--border": palette.border,
    "--text": palette.text,
    "--text-muted": palette.textMuted,
    "--text-faint": palette.textFaint,
    "--accent": palette.accent,
    "--accent-2": palette.accent2,
    "--accent-text": palette.accentText,
    "--on-accent": palette.onAccent,
    "--radius": `${appearance.radius}px`,
    "--gutter": `${effectiveGutter(settings)}px`,
    "--page-radius": `${pageRadius(settings)}px`,
    "--sidebar-width": `${layout.sidebarWidth}px`,
    "--font": FONT_STACKS[appearance.font],
    "--font-size": `${density.fontSize}px`,
    "--tab-height": `${density.tabHeight}px`,
    "--control-height": `${density.controlHeight}px`,
    "--icon-button": `${density.iconButton}px`,
    "--sidebar-gap": `${density.gap}px`,
    "--backdrop": backdrop(appearance.background, mode),
    "--viewport-shadow": appearance.shadows ? `0 0 0 1px var(--border), 0 10px 30px -12px ${shadow}` : "0 0 0 1px var(--border)",
    "--elevation": appearance.shadows ? `0 1px 2px ${shadow}` : "none",
  };
}
