/**
 * Energy saver (ADR-048): pure policy, no Electron. The setting chooses when it is on ("Sur
 * batterie" by default); while on, tabs sleep sooner, thumbnails are taken less often, background
 * media is not polled and the browser UIs stop animating.
 */

export type EnergySaverMode = "off" | "battery" | "always";

export const ENERGY_SAVER_MODES: readonly EnergySaverMode[] = ["off", "battery", "always"];

/** Choices of "Économiseur d'énergie", in order, with their French labels. */
export const ENERGY_SAVER_OPTIONS: readonly { value: EnergySaverMode; label: string }[] = [
  { value: "off", label: "Désactivé" },
  { value: "battery", label: "Sur batterie" },
  { value: "always", label: "Toujours" },
];

/** Whether the saver is on, and why (the window bar's indicator says it). */
export interface EnergyState {
  active: boolean;
  reason: "battery" | "always" | null;
}

export const ENERGY_OFF: EnergyState = { active: false, reason: null };

export function energyState(mode: EnergySaverMode, onBattery: boolean): EnergyState {
  if (mode === "always") return { active: true, reason: "always" };
  if (mode === "battery" && onBattery) return { active: true, reason: "battery" };
  return ENERGY_OFF;
}

export const sameEnergyState = (a: EnergyState, b: EnergyState): boolean => a.active === b.active && a.reason === b.reason;

/** Longest idle delay before a background tab sleeps while saving energy. */
export const SAVER_SLEEP_CAP_MS = 5 * 60_000;
/** Thumbnails (tab hover preview, ADR-038) wait this many times longer before being taken. */
export const SAVER_CAPTURE_FACTOR = 4;

/** What the rest of the app tunes from the state. */
export interface EnergyPolicy {
  /** Idle delay before a background tab sleeps, from the user's (null: never, kept as chosen). */
  sleepDelayMs(base: number | null): number | null;
  /** Delay before a tab's thumbnail is taken once it shows, from the normal one. */
  captureSettleMs(base: number): number;
  /** Whether a thumbnail is also taken when the tab on screen finishes loading. */
  captureOnLoad: boolean;
  /** Whether the media hub polls a playing tab that is not on screen. */
  pollBackgroundMedia: boolean;
  /** Chromium throttles timers and painting of hidden pages (asserted on every tab page while on). */
  backgroundThrottling: boolean;
  /** Animations off in the browser UIs (motion tokens at 0). */
  reduceMotion: boolean;
}

export function energyPolicy(state: EnergyState): EnergyPolicy {
  const on = state.active;
  return {
    sleepDelayMs: (base) => (base === null || !on ? base : Math.min(base, SAVER_SLEEP_CAP_MS)),
    captureSettleMs: (base) => (on ? base * SAVER_CAPTURE_FACTOR : base),
    captureOnLoad: !on,
    pollBackgroundMedia: !on,
    backgroundThrottling: on,
    reduceMotion: on,
  };
}

/** The window bar's tooltip, or null when the saver is off. */
export function energyTooltip(state: EnergyState): string | null {
  if (!state.active) return null;
  return state.reason === "battery" ? "Économiseur d'énergie actif : l'ordinateur est sur batterie" : "Économiseur d'énergie toujours actif";
}
