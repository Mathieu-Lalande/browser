import type { MiniState } from "@shared/mini";
import { locale } from "../lib/i18n.svelte";
import { applyTheme } from "../lib/theme";

/** What main last sent to this mini window's bar (ADR-048); the theme follows. */
class MiniStateStore {
  current = $state<MiniState | null>(null);

  set(state: MiniState): void {
    locale.set(state.locale);
    this.current = state;
    applyTheme(state.settings, state.mode);
  }
}

export const miniState = new MiniStateStore();
