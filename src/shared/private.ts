import type { Settings } from "./settings";
import type { SpaceInfo } from "./types";

/**
 * Private windows (ADR-014): one ephemeral space (never in the shared space list nor the session)
 * and a fixed dark theme, so they cannot be mistaken for a normal window.
 */
export const PRIVATE_SPACE: SpaceInfo = {
  id: "private",
  name: "Navigation privée",
  icon: "🕶️",
  color: null,
  isolated: true,
};

/** Accent pair of the private theme: a deep violet that reads as "night mode", whatever the user's theme. */
export const PRIVATE_ACCENT = { accent: "#9b7bff", accent2: "#5b3fd9" } as const;

/** The user's settings as a private window shows them: same layout and fonts, private colors, always dark. */
export function privateSettings(settings: Settings): Settings {
  return {
    ...settings,
    appearance: { ...settings.appearance, ...PRIVATE_ACCENT, mode: "dark", background: "mesh" },
  };
}
