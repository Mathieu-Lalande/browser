import { getLocale, isLocale, setLocale, type Locale } from "@shared/i18n";

/**
 * The UI language in a renderer (ADR-052). Main decides it (setting, or the system's for
 * "auto") and sends it with the state; `t()` reads the shared current locale, and the roots
 * (App, Overlay, MiniBar) re-mount their content in a `{#key locale.current}` block when it
 * changes, so every text, including those computed once by a component, is in the new language.
 */
class UiLocale {
  current = $state<Locale>(getLocale());

  set(next: Locale | undefined): void {
    if (!isLocale(next)) return;
    // The shared locale first: what re-renders on `current` reads it.
    setLocale(next);
    document.documentElement.lang = next;
    if (this.current !== next) this.current = next;
  }
}

export const locale = new UiLocale();
