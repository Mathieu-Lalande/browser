import { privateSettings } from "@shared/private";
import type { Settings } from "@shared/settings";
import { themeVariables, type ResolvedMode } from "@shared/theme";

/**
 * Applies the theme to the chrome UI: every color, size and font token is a CSS custom
 * property on :root (see global.css for the fallbacks), so components never read settings.
 * A private window always shows the private theme (dark, violet), whatever the user's colors.
 */
export function applyTheme(settings: Settings, mode: ResolvedMode, isPrivate = false): void {
  if (isPrivate) {
    settings = privateSettings(settings);
    mode = "dark";
  }
  const root = document.documentElement;
  for (const [name, value] of Object.entries(themeVariables(settings, mode))) root.style.setProperty(name, value);
  root.dataset.theme = mode;
  root.dataset.background = settings.appearance.background;
  root.dataset.density = settings.appearance.density;
  root.toggleAttribute("data-reduce-motion", settings.appearance.reduceMotion);
  root.toggleAttribute("data-private", isPrivate);
  root.toggleAttribute("data-arrow-cursor", !settings.appearance.pointerCursor);
}
