/**
 * User activation rules for tab pages (ADR-018, audit MEDIUM-1, LOW-1, MEDIUM-4). Pure: main feeds
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
  /** Mouse events: "left", "middle", "right". */
  button?: string;
  /** Electron's modifier names ("shift", "control", "meta"…). */
  modifiers?: string[];
}

const ACTIVATING = new Set(["mouseDown", "keyDown", "rawKeyDown", "touchStart", "gestureTap", "gestureTapDown"]);
const MODIFIERS = new Set(["Shift", "Control", "Alt", "Meta", "AltGraph", "CapsLock", "Fn"]);

/** Whether an input grants user activation, as in Chromium: a press, not a move, release or held key. */
export function isActivatingInput(input: InputLike): boolean {
  if (!ACTIVATING.has(input.type) || input.isAutoRepeat) return false;
  return !(input.key && MODIFIERS.has(input.key));
}

const OTHER_MODIFIERS = new Set(["control", "ctrl", "alt", "meta", "command", "cmd"]);

/**
 * Whether a trusted input may be the Shift+click of a link peek (ADR-027): a left press. Electron's
 * `before-mouse-event` carries no modifiers (checked with Electron 44): Shift itself is then known
 * from Chromium's `new-window` disposition, which is safe here since a peek can do less than the
 * tab the same gesture could open anyway. Should modifiers be reported, they must be Shift alone.
 */
export function isPeekGesture(input: InputLike): boolean {
  if (input.type !== "mouseDown" || input.button !== "left") return false;
  if (!input.modifiers) return true;
  const modifiers = input.modifiers.map((name) => name.toLowerCase());
  return modifiers.includes("shift") && !modifiers.some((name) => OTHER_MODIFIERS.has(name));
}

/** The last trusted input of one tab, and what it was already used for. */
export class UserActivation {
  private at = Number.NEGATIVE_INFINITY;
  private used = 0;
  private lastExternal = Number.NEGATIVE_INFINITY;
  private peek = false;

  /** A trusted press reached the page: a fresh gesture (`peek`: a Shift+click, `isPeekGesture`). */
  record(now: number, peek = false): void {
    this.at = now;
    this.used = 0;
    this.peek = peek;
  }

  /** May the fresh gesture (a left click, `isPeekGesture`) open a link peek? Uses the gesture up. */
  consumePeek(now: number): boolean {
    if (!this.peek || !this.available(now)) return false;
    this.used++;
    return true;
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
