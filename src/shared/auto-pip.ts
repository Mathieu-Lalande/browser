/**
 * Automatic picture-in-picture (ADR-047), off by default (`settings.media.autoPictureInPicture`):
 * leaving a tab that plays a visible video pops the video out; coming back to it puts it back.
 * Pure policy: main runs the actions in the pages (isolated world, ADR-035's picture-in-picture
 * script) and reports what happened, so only the windows this feature opened are closed again.
 */

export type AutoPipAction = { kind: "enter"; tabId: string } | { kind: "exit"; tabId: string };

/** What a page answered to "enter": a video popped out, nothing suitable, or the site refused it. */
export type AutoPipOutcome = "entered" | "none" | "disabled" | "unsupported" | "failed";

export class AutoPipPolicy {
  private active: string | null = null;
  /** Tabs whose video this feature popped out (and has not put back yet). */
  private readonly popped = new Set<string>();

  /**
   * The window shows `next` (a tab switch, a space switch, a closed tab…). `enabled`: the setting;
   * `canEnter`: whether the tab left behind still has a live page (not asleep, not closed).
   */
  activate(next: string | null, options: { enabled: boolean; canEnter: (tabId: string) => boolean }): AutoPipAction[] {
    const previous = this.active;
    this.active = next;
    if (previous === next) return [];
    const actions: AutoPipAction[] = [];
    if (next && this.popped.delete(next)) actions.push({ kind: "exit", tabId: next });
    if (options.enabled && previous && !this.popped.has(previous) && options.canEnter(previous)) actions.push({ kind: "enter", tabId: previous });
    return actions;
  }

  /** The page's answer to an "enter": remembered only when a video really popped out. */
  entered(tabId: string, outcome: AutoPipOutcome): void {
    // The user may have come back before the page answered: put it back at once then.
    if (outcome === "entered" && tabId !== this.active) this.popped.add(tabId);
  }

  /** Whether an answer arrived too late (the tab is on screen again): its video should go back. */
  isOnScreen(tabId: string): boolean {
    return this.active === tabId;
  }

  /** The tab went away (closed): nothing to put back. */
  forget(tabId: string): void {
    this.popped.delete(tabId);
  }

  /** Tabs currently popped out by the feature (tests, diagnostics). */
  get poppedTabs(): string[] {
    return [...this.popped];
  }
}
