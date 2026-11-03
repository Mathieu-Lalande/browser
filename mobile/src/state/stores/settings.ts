import { DEFAULT_SETTINGS, mergeSettings, sanitizeSettings, type Settings, type SettingsPatch } from "@shared/settings";
import { DEFAULT_MOBILE_SETTINGS, sanitizeMobileSettings, type MobileSettings } from "../../lib/mobileSettings";
import { Store } from "../store";

export interface SettingsState {
  /** The preferences shared with the desktop (synced). */
  settings: Settings;
  /** The phone's own preferences. */
  mobile: MobileSettings;
}

export class SettingsStore extends Store<SettingsState> {
  constructor() {
    super({ settings: DEFAULT_SETTINGS, mobile: DEFAULT_MOBILE_SETTINGS });
  }

  get settings(): Settings {
    return this.get().settings;
  }
  get mobile(): MobileSettings {
    return this.get().mobile;
  }

  hydrate(stored: { settings: unknown; mobile: unknown }): void {
    this.set({ settings: sanitizeSettings(stored.settings), mobile: sanitizeMobileSettings(stored.mobile) });
  }

  update(patch: SettingsPatch): void {
    this.set((state) => ({ ...state, settings: mergeSettings(state.settings, patch) }));
  }

  /** Settings as the sync engine merged them. */
  setSettings(settings: Settings): void {
    this.set((state) => ({ ...state, settings }));
  }

  updateMobile(patch: Partial<MobileSettings>): void {
    this.set((state) => ({ ...state, mobile: sanitizeMobileSettings(patch, state.mobile) }));
  }
}
