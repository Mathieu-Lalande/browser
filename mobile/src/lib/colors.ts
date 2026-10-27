import type { Settings, ThemeMode } from "@shared/settings";
import { derivePalette, parseCssColor, type Palette, type ResolvedMode } from "@shared/theme";

/**
 * The shared theme engine (OKLCH palette with WCAG contrast guarantees) turned into React Native
 * colors. React Native does not reliably parse CSS Color 4 `rgb(r g b / a)`, so translucent
 * colors are converted to `rgba()`.
 */

export interface AppColors extends Palette {
  /** Translucent bar background (behind the blur). */
  bar: string;
  /** Hairline under/over bars. */
  hairline: string;
  /** Dim layer behind sheets. */
  scrim: string;
  /** Accent at low opacity (selected chips, rings). */
  accentSoft: string;
  danger: string;
}

export function toRnColor(value: string): string {
  const parsed = parseCssColor(value);
  if (!parsed) return value;
  const { color, alpha } = parsed;
  const channel = (v: number) => Math.round(v * 255);
  return alpha >= 1 ? value : `rgba(${channel(color.r)}, ${channel(color.g)}, ${channel(color.b)}, ${alpha})`;
}

export function withAlpha(hex: string, alpha: number): string {
  const parsed = parseCssColor(hex);
  if (!parsed) return hex;
  const { color } = parsed;
  return `rgba(${Math.round(color.r * 255)}, ${Math.round(color.g * 255)}, ${Math.round(color.b * 255)}, ${alpha})`;
}

export function resolveMode(mode: ThemeMode, system: "light" | "dark" | null | undefined): ResolvedMode {
  if (mode === "light" || mode === "dark") return mode;
  return system === "dark" ? "dark" : "light";
}

/** Private tabs always use a dark, violet-tinted palette, so the mode is obvious at a glance. */
export const PRIVATE_ACCENT = { accent: "#a78bfa", accent2: "#6d28d9" };

export function appColors(accent: string, accent2: string, mode: ResolvedMode): AppColors {
  const palette = derivePalette(accent, accent2, mode);
  const converted = Object.fromEntries(Object.entries(palette).map(([key, value]) => [key, key === "scheme" ? value : toRnColor(value)])) as unknown as Palette;
  const dark = mode === "dark";
  return {
    ...converted,
    bar: withAlpha(converted.bgElevated, dark ? 0.78 : 0.82),
    hairline: dark ? "rgba(255, 255, 255, 0.08)" : "rgba(20, 16, 40, 0.08)",
    scrim: dark ? "rgba(0, 0, 0, 0.55)" : "rgba(20, 16, 40, 0.32)",
    accentSoft: withAlpha(palette.accent, dark ? 0.22 : 0.14),
    danger: dark ? "#ff7b7b" : "#c62828",
  };
}

/** Colors for the current settings, space color and private mode. */
export function colorsFor(settings: Settings, system: "light" | "dark" | null | undefined, spaceColor: string | null, isPrivate: boolean): AppColors {
  if (isPrivate) return appColors(PRIVATE_ACCENT.accent, PRIVATE_ACCENT.accent2, "dark");
  const mode = resolveMode(settings.appearance.mode, system);
  return appColors(spaceColor ?? settings.appearance.accent, spaceColor ? settings.appearance.accent : settings.appearance.accent2, mode);
}
