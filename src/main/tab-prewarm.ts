import type { WebContents } from "electron";
import {
  PREWARM_FLIGHT_MS,
  PREWARM_SETTLE_MS,
  PREWARM_TTL_MS,
  nextInCycle,
  predictNextTabs,
  prewarmBlocker,
  prewarmExpired,
  prewarmTarget,
  type PrewarmReason,
  type PrewarmTab,
} from "@shared/tab-prewarm";
import type { TabId } from "@shared/types";
import { sleepTabs, type SleepTarget } from "./sleep";

/** A tab list the prewarmer works on (a `TabManager`: one space of one window). */
export interface PrewarmTarget extends SleepTarget {
  readonly activeTabId: TabId | null;
  /** Its tabs in sidebar order (without the activation counts, kept here). */
  prewarmTabs(): Omit<PrewarmTab, "activations">[];
  /** Wakes a sleeping background tab off screen; its page, or null when it could not. */
  prewarm(id: TabId): WebContents | null;
}

export interface PrewarmDeps {
  /** "Précharger les onglets en veille" (`settings.behavior.prewarmSleepingTabs`). */
  enabled(): boolean;
  /** Tabs sleep at all (the idle delay is not "never"). */
  sleeping(): boolean;
  /** Energy saver on (ADR-048). */
  energySaver(): boolean;
  /** System memory (KiB, `process.getSystemMemoryInfo`), when known. */
  memory(): { freeKb: number; totalKb: number } | null;
  now?: () => number;
  /** Test hook: each wake-up, with why. */
  log?: (entry: { id: TabId; reason: PrewarmReason }) => void;
}

/**
 * Smart preloading of sleeping tabs (ADR-057): a sleeping tab hovered in the sidebar, the next
 * stop of Ctrl+Tab, or the tab predicted after a switch (`predictNextTabs`) is woken off screen,
 * so that it shows without a reload. One wake-up at a time (until its page stops loading), none
 * while saving energy or with little free memory; a tab woken for nothing sleeps again after
 * `PREWARM_TTL_MS` (same checks as a manual sleep: sound, prompts, unsaved input keep it awake).
 */
export class PrewarmService {
  private readonly inFlight = new Map<TabId, ReturnType<typeof setTimeout>>();
  private readonly woken = new Map<TabId, { at: number; target: PrewarmTarget; timer: ReturnType<typeof setTimeout> }>();
  private readonly activations = new Map<TabId, number>();
  private settle: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly deps: PrewarmDeps) {}

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  private tabsOf(target: PrewarmTarget): PrewarmTab[] {
    return target.prewarmTabs().map((tab) => ({ ...tab, activations: this.activations.get(tab.id) ?? 0 }));
  }

  /** A sleeping tab of the sidebar was hovered for `PREWARM_HOVER_MS` (the UI waits). */
  hovered(target: PrewarmTarget, id: TabId): TabId | null {
    return this.request(target, [id], "hover");
  }

  /** Ctrl+Tab / Ctrl+Shift+Tab just moved: the next stop wakes before the key is pressed again. */
  cycled(target: PrewarmTarget, direction: 1 | -1): TabId | null {
    const order = target.prewarmTabs().map((tab) => tab.id);
    const next = nextInCycle(order, target.activeTabId, direction);
    return next ? this.request(target, [next], "cycle") : null;
  }

  /** A tab was shown: it counts as used; once the user settles on it, the likely next one wakes. */
  activated(target: PrewarmTarget, id: TabId): void {
    this.activations.set(id, (this.activations.get(id) ?? 0) + 1);
    const woken = this.woken.get(id);
    if (woken) {
      clearTimeout(woken.timer);
      this.woken.delete(id);
    }
    clearTimeout(this.settle);
    this.settle = setTimeout(() => {
      this.settle = undefined;
      if (target.activeTabId !== id) return;
      this.request(target, predictNextTabs(this.tabsOf(target), id), "predicted");
    }, PREWARM_SETTLE_MS);
    this.settle.unref?.();
  }

  /** A tab went away (closed): what is known about it goes too. */
  forget(id: TabId): void {
    this.activations.delete(id);
    const woken = this.woken.get(id);
    if (woken) clearTimeout(woken.timer);
    this.woken.delete(id);
    this.land(id);
  }

  dispose(): void {
    clearTimeout(this.settle);
    for (const timer of this.inFlight.values()) clearTimeout(timer);
    for (const entry of this.woken.values()) clearTimeout(entry.timer);
    this.inFlight.clear();
    this.woken.clear();
  }

  /** Wakes the first of `ids` worth it, if the conditions allow one now; the tab woken, or null. */
  request(target: PrewarmTarget, ids: readonly TabId[], reason: PrewarmReason): TabId | null {
    const blocker = prewarmBlocker({
      enabled: this.deps.enabled(),
      sleeping: this.deps.sleeping(),
      energySaver: this.deps.energySaver(),
      memory: this.deps.memory(),
      inFlight: this.inFlight.size,
    });
    if (blocker) return null;
    const id = prewarmTarget(this.tabsOf(target), ids);
    if (!id) return null;
    const page = target.prewarm(id);
    if (!page) return null;
    this.deps.log?.({ id, reason });
    this.takeOff(id, page);
    const at = this.now();
    const timer = setTimeout(() => void this.expire(id), PREWARM_TTL_MS);
    timer.unref?.();
    this.woken.set(id, { at, target, timer });
    return id;
  }

  /** In flight until the page stops loading (or `PREWARM_FLIGHT_MS`): no other wake-up meanwhile. */
  private takeOff(id: TabId, page: WebContents): void {
    const timer = setTimeout(() => this.land(id), PREWARM_FLIGHT_MS);
    timer.unref?.();
    this.inFlight.set(id, timer);
    const done = () => this.land(id);
    page.once("did-stop-loading", done);
    page.once("destroyed", done);
  }

  private land(id: TabId): void {
    const timer = this.inFlight.get(id);
    if (timer) clearTimeout(timer);
    this.inFlight.delete(id);
  }

  /** Woken for nothing: back to sleep, unless shown since (or kept awake by sound, a prompt, input). */
  private async expire(id: TabId): Promise<void> {
    const entry = this.woken.get(id);
    if (!entry) return;
    this.woken.delete(id);
    const candidate = entry.target.sleepCandidates(this.now()).find((tab) => tab.id === id);
    if (!candidate || !prewarmExpired(entry.at, candidate.lastSeenAt, candidate.shown, this.now())) return;
    await sleepTabs(entry.target, [id], null).catch(() => []);
  }
}
