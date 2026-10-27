/**
 * User activation rules for tab pages (ADR-017, audit MEDIUM-1, LOW-1, MEDIUM-4). Pure: main feeds
 * them the trusted input it sees (`before-mouse-event`, `before-input-event`), which a page cannot
 * forge — unlike `disposition` or a synthetic click, which scripts control.
 */

/** A popup or an external app launch must follow a trusted input by at most this long. */
export const ACTIVATION_WINDOW_MS = 1000;
/** Tabs a single gesture may open (a click on a target=_blank link, a ctrl/middle click…). */
export const OPENS_PER_GESTURE = 1;
/** At most one external app launch (mailto:, tel:) per tab in this interval. */
export const EXTERNAL_LAUNCH_INTERVAL_MS = 3000;
/** In-page navigations (pushState) are recorded in the history at most this often per tab. */
export const IN_PAGE_VISIT_INTERVAL_MS = 1000;

/** The fields of Electron's input events (mouse, keyboard, touch) the policy looks at. */
export interface InputLike {
  type: string;
  key?: string;
  isAutoRepeat?: boolean;
}

const ACTIVATING = new Set(["mouseDown", "keyDown", "rawKeyDown", "touchStart", "gestureTap", "gestureTapDown"]);
const MODIFIERS = new Set(["Shift", "Control", "Alt", "Meta", "AltGraph", "CapsLock", "Fn"]);

/** Whether an input grants user activation, as in Chromium: a press, not a move, release or held key. */
export function isActivatingInput(input: InputLike): boolean {
  if (!ACTIVATING.has(input.type) || input.isAutoRepeat) return false;
  return !(input.key && MODIFIERS.has(input.key));
}

/** The last trusted input of one tab, and what it was already used for. */
export class UserActivation {
  private at = Number.NEGATIVE_INFINITY;
  private used = 0;
  private lastExternal = Number.NEGATIVE_INFINITY;

  /** A trusted press reached the page: a fresh gesture. */
  record(now: number): void {
    this.at = now;
    this.used = 0;
  }

  /** May the page open a tab now? Uses the gesture up. */
  consumeOpen(now: number): boolean {
    if (!this.available(now)) return false;
    this.used++;
    return true;
  }

  /** May the page launch an external app (mailto:, tel:) now? Uses the gesture up. */
  consumeExternal(now: number): boolean {
    if (!this.available(now) || now - this.lastExternal < EXTERNAL_LAUNCH_INTERVAL_MS) return false;
    this.used++;
    this.lastExternal = now;
    return true;
  }

  private available(now: number): boolean {
    return now >= this.at && now - this.at <= ACTIVATION_WINDOW_MS && this.used < OPENS_PER_GESTURE;
  }
}

/** Rate limit of in-page visits (pushState, replaceState) recorded in the history for one tab. */
export class InPageVisits {
  private lastUrl: string | null = null;
  private lastAt = Number.NEGATIVE_INFINITY;

  /** A full navigation committed `url`: in-page visits start over from it. */
  reset(url: string): void {
    this.lastUrl = url;
    this.lastAt = Number.NEGATIVE_INFINITY;
  }

  /** Whether an in-page navigation to `url` is recorded: a new URL, and not too soon after the last one. */
  accept(url: string, now: number): boolean {
    if (url === this.lastUrl || now - this.lastAt < IN_PAGE_VISIT_INTERVAL_MS) return false;
    this.lastUrl = url;
    this.lastAt = now;
    return true;
  }
}
