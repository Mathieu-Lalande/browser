/**
 * Crash recovery and recently closed things (ADR-042). Pure: what the "Restaurer la session ?"
 * card shows, the startup decision, and the recently closed entries of the app menu.
 */

/** One window of a session the card offers to bring back. */
import { t } from "./i18n";

export interface RecoveryWindow {
  /** Index in the saved session's window list (what `recovery.restore` takes). */
  index: number;
  tabCount: number;
  /** A few tab titles (or addresses), for the "choose windows" list. */
  titles: string[];
}

/** What the card shows after an unclean shutdown; null when there is nothing to offer. */
export interface RecoverySummary {
  windows: RecoveryWindow[];
  tabCount: number;
}

/** A closed tab or window the app menu lists (most recent first). */
export interface ClosedEntry {
  /** Position in its list, most recent first (what `recovery.reopen` takes). */
  index: number;
  title: string;
  url?: string;
  /** Windows: how many tabs come back. */
  tabCount?: number;
}

export interface ClosedLists {
  tabs: ClosedEntry[];
  windows: ClosedEntry[];
}

/** How many closed windows are remembered (in memory only, never written). */
export const MAX_CLOSED_WINDOWS = 10;
/** Titles listed per window on the card. */
export const RECOVERY_TITLES = 3;

/** The tabs of a saved window, as far as the summary is concerned. */
interface WindowLike {
  spaces: readonly { tabs: readonly { url: string; title: string }[] }[];
}

const tabLabel = (tab: { url: string; title: string }) => tab.title || tab.url || t("recovery.newTab");

/** The card's content for a saved session (null when it holds no tab). */
export function summarizeSession(session: { windows: readonly WindowLike[] } | null): RecoverySummary | null {
  if (!session) return null;
  const windows = session.windows
    .map((window, index): RecoveryWindow => {
      const tabs = window.spaces.flatMap((space) => space.tabs);
      return { index, tabCount: tabs.length, titles: tabs.slice(0, RECOVERY_TITLES).map(tabLabel) };
    })
    .filter((window) => window.tabCount > 0);
  if (windows.length === 0) return null;
  return { windows, tabCount: windows.reduce((sum, window) => sum + window.tabCount, 0) };
}

export interface StartupInput {
  /** The previous run did not quit cleanly (its marker file was still there). */
  unclean: boolean;
  /** Settings > Au démarrage: reprendre où j'en étais. */
  restoreSession: boolean;
  /** Windows of the previous session. */
  savedWindows: number;
}

/**
 * What happens at startup: after a clean quit, the setting decides; after a crash, nothing is
 * reopened by itself (a page may have caused it) and the card offers the previous session.
 */
export function startupPlan(input: StartupInput): "restore" | "offer" | "fresh" {
  if (input.savedWindows === 0) return "fresh";
  if (input.unclean) return "offer";
  return input.restoreSession ? "restore" : "fresh";
}

/** Indexes the user picked, kept to existing windows, without duplicates (all when null). */
export function pickWindows(count: number, indexes: readonly number[] | null): number[] {
  if (indexes === null) return Array.from({ length: count }, (_, index) => index);
  return [...new Set(indexes)].filter((index) => Number.isInteger(index) && index >= 0 && index < count).sort((a, b) => a - b);
}

/** A bounded most-recent-last stack (closed windows). */
export class RecentStack<T> {
  private readonly items: T[] = [];

  constructor(private readonly max: number) {}

  push(item: T): void {
    this.items.push(item);
    if (this.items.length > this.max) this.items.shift();
  }

  /** Takes the item at `index` (0: most recent). */
  take(index = 0): T | undefined {
    const at = this.items.length - 1 - index;
    if (at < 0 || at >= this.items.length) return undefined;
    return this.items.splice(at, 1)[0];
  }

  /** Most recent first. */
  list(): T[] {
    return [...this.items].reverse();
  }

  get size(): number {
    return this.items.length;
  }
}
