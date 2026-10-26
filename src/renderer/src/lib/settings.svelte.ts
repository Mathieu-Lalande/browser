import { DEFAULT_SETTINGS, mergeSettings, searchEngineOf, type Settings, type SettingsPatch, type SettingsSection } from "@shared/settings";
import type { ResolvedMode } from "@shared/theme";
import type { SearchEngine } from "@shared/url";

const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");

/**
 * Reactive mirror of the user settings. Updates apply locally at once (the UI follows the
 * pointer while dragging a slider), then go to main, which validates, saves and broadcasts them.
 */
class SettingsStore {
  current = $state<Settings>(structuredClone(DEFAULT_SETTINGS));
  /** OS preference; main sets `nativeTheme.themeSource`, so this also reflects a forced mode. */
  systemDark = $state(darkQuery.matches);

  mode: ResolvedMode = $derived(
    this.current.appearance.mode === "system" ? (this.systemDark ? "dark" : "light") : this.current.appearance.mode,
  );
  engine: SearchEngine = $derived(searchEngineOf(this.current));

  /** Updates sent but not yet acknowledged: older broadcasts must not undo newer local edits. */
  private inflight = 0;

  constructor() {
    darkQuery.addEventListener("change", (event) => (this.systemDark = event.matches));
    window.browser.settings.onChanged((next) => {
      if (this.inflight === 0) this.current = next;
    });
  }

  /** Loads the saved settings (awaited before the first render, to avoid a flash of the default theme). */
  async load(): Promise<void> {
    this.current = await window.browser.settings.get().catch(() => this.current);
  }

  update(patch: SettingsPatch): void {
    this.current = mergeSettings(this.current, patch);
    this.track(window.browser.settings.update(patch));
  }

  reset(section?: SettingsSection): void {
    this.track(window.browser.settings.reset(section));
  }

  private track(request: Promise<Settings>): void {
    this.inflight++;
    request
      .then(
        (next) => next,
        () => null,
      )
      .then((next) => {
        this.inflight--;
        if (next && this.inflight === 0) this.current = next;
      });
  }
}

export const settings = new SettingsStore();
