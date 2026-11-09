import { sanitizeSiteList } from "@shared/site-info";

/** Phone-only preferences (the shared `Settings` model covers everything else). */

export interface MobileSettings {
  /** Haptic feedback on key actions. */
  haptics: boolean;
  /** Collapse the bottom toolbar while scrolling down. */
  collapseToolbar: boolean;
  /** Ads and trackers blocked (ADR-051): native rules in a compiled app, element hiding everywhere. */
  contentBlocker: boolean;
  /** Sites (registrable domains) where the shield is off ("Bouclier"); not synced, like the desktop's shields.json. */
  shieldsOff: string[];
}

export const DEFAULT_MOBILE_SETTINGS: MobileSettings = { haptics: true, collapseToolbar: true, contentBlocker: true, shieldsOff: [] };

export function sanitizeMobileSettings(value: unknown, base: MobileSettings = DEFAULT_MOBILE_SETTINGS): MobileSettings {
  const input = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  const bool = (key: "haptics" | "collapseToolbar" | "contentBlocker") => (typeof input[key] === "boolean" ? (input[key] as boolean) : base[key]);
  return {
    haptics: bool("haptics"),
    collapseToolbar: bool("collapseToolbar"),
    contentBlocker: bool("contentBlocker"),
    shieldsOff: "shieldsOff" in input ? (sanitizeSiteList(input.shieldsOff) ?? base.shieldsOff) : base.shieldsOff,
  };
}
