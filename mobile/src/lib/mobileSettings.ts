/** Phone-only preferences (the shared `Settings` model covers everything else). */

export interface MobileSettings {
  /** Haptic feedback on key actions. */
  haptics: boolean;
  /** Collapse the bottom toolbar while scrolling down. */
  collapseToolbar: boolean;
}

export const DEFAULT_MOBILE_SETTINGS: MobileSettings = { haptics: true, collapseToolbar: true };

export function sanitizeMobileSettings(value: unknown, base: MobileSettings = DEFAULT_MOBILE_SETTINGS): MobileSettings {
  const input = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  const bool = (key: keyof MobileSettings) => (typeof input[key] === "boolean" ? (input[key] as boolean) : base[key]);
  return { haptics: bool("haptics"), collapseToolbar: bool("collapseToolbar") };
}
