import { nativeTheme } from "electron";
import { mergeSettings, resetSettings, sameSettings, type Settings, type SettingsSection } from "@shared/settings";
import { derivePalette, type ResolvedMode } from "@shared/theme";
import { profile } from "./profile";

/**
 * Main-process side of the settings: the single writer of `settings.json`. Every change goes
 * through `updateSettings`/`resetSettings`, is validated, saved, then announced to listeners
 * (windows re-apply themselves and broadcast `settings:changed` to their chrome UI).
 */

type Listener = (settings: Settings) => void;
const listeners = new Set<Listener>();

export function settings(): Settings {
  return profile().settings;
}

export function onSettingsChanged(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function commit(next: Settings): Settings {
  if (sameSettings(next, settings())) return next;
  profile().saveSettings(next);
  applyNativeTheme(next);
  for (const listener of listeners) listener(next);
  return next;
}

/** Applies an untrusted partial update (validated field by field). */
export function updateSettings(patch: unknown): Settings {
  return commit(mergeSettings(settings(), patch));
}

export function resetSettingsSection(section?: SettingsSection): Settings {
  return commit(resetSettings(settings(), section));
}

/** Light/dark as currently shown (the "system" mode follows the OS). */
export function resolvedMode(): ResolvedMode {
  return nativeTheme.shouldUseDarkColors ? "dark" : "light";
}

/** Native window color behind the UI: the theme's background, so no white flash on open/resize. */
export function windowBackground(current = settings()): string {
  return derivePalette(current.appearance.accent, current.appearance.accent2, resolvedMode()).bg;
}

/**
 * The chosen mode drives `prefers-color-scheme` everywhere: chrome UI and web pages alike, as in
 * other browsers. It must be applied before the first window so it opens in the right colors.
 */
export function applyNativeTheme(current = settings()): void {
  if (nativeTheme.themeSource !== current.appearance.mode) nativeTheme.themeSource = current.appearance.mode;
}
