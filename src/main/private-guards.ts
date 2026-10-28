import type { TabManagerHooks } from "./tabs";

/**
 * "Never persist" rules of private windows (ADR-014), kept pure so they are unit-tested. Anything
 * that writes to the profile must go through one of these, or check `BrowserController.isPrivate`
 * (per window) / `isPrivateSession(session)` (per session, e.g. a download hook) itself.
 */

/** Something that may be a private window. */
export interface MaybePrivate {
  readonly isPrivate: boolean;
}

/**
 * Tab integrations for a window: a private window keeps the bookmark star (reading) and the page
 * context menu (which checks `isPrivate` itself) and the saved-passwords key (filling reads the
 * vault), but neither records visits nor updates titles/favicons in the history (so no top sites
 * either), nor watches login forms (never a save prompt, ADR-025).
 */
export function tabHooksFor(hooks: TabManagerHooks, isPrivate: boolean): TabManagerHooks {
  return isPrivate
    ? { isBookmarked: hooks.isBookmarked, isFavorite: hooks.isFavorite, contextMenu: hooks.contextMenu, hasPasswords: hooks.hasPasswords }
    : hooks;
}

/** The windows that belong in session.json: never a private one. */
export function persistentWindows<T extends MaybePrivate>(windows: readonly T[]): T[] {
  return windows.filter((window) => !window.isPrivate);
}

/**
 * What to do with the saved session when `closing` closes, `open` being every window still
 * registered (`closing` included): closing the last normal window keeps it in the session (that is
 * how the app usually quits on Windows/Linux), closing one of several forgets it, and a private
 * window never touches the session.
 */
export function sessionOnClose<T extends MaybePrivate>(closing: T, open: readonly T[]): "keep" | "forget" | "ignore" {
  if (closing.isPrivate) return "ignore";
  return persistentWindows(open).length === 1 ? "keep" : "forget";
}
