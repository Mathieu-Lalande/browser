import { MAX_CLOSED_WINDOWS, RecentStack, pickWindows, summarizeSession, type ClosedEntry, type RecoverySummary } from "@shared/recovery";
import type { WindowDirectory, WindowPort } from "../ports";
import type { Session, SessionWindow } from "../storage/session";

export interface RecoveryDeps {
  windows: WindowDirectory;
  /** Opens a window with these tabs (discarded: they load when shown). */
  openWindow(saved: SessionWindow): unknown;
}

interface ClosedWindow {
  saved: SessionWindow;
  title: string;
  tabCount: number;
}

/**
 * Crash recovery and recently closed windows (ADR-042). After an unclean shutdown the previous
 * session is kept here (in memory) instead of being reopened, and the start page offers it; closed
 * windows are remembered (in memory only, never private ones) for "Rouvrir la fenêtre fermée".
 */
export class RecoveryService {
  private offered: Session | null = null;
  private readonly closed = new RecentStack<ClosedWindow>(MAX_CLOSED_WINDOWS);

  constructor(private readonly deps: RecoveryDeps) {}

  /** The previous session, to offer on the start page. */
  offer(session: Session): void {
    this.offered = summarizeSession(session) ? session : null;
  }

  /** What the "Restaurer la session ?" card shows (null: no card). */
  summary(): RecoverySummary | null {
    return summarizeSession(this.offered);
  }

  /**
   * Reopens the chosen windows of the offered session (all when `indexes` is null). The asking
   * window goes away if it only shows an empty start page.
   */
  restore(from: WindowPort | null, indexes: readonly number[] | null): number {
    const session = this.offered;
    if (!session) return 0;
    this.offered = null;
    const chosen = pickWindows(session.windows.length, indexes).map((index) => session.windows[index]);
    for (const saved of chosen) this.deps.openWindow(saved);
    if (chosen.length && from && isBlank(from)) from.window.close();
    this.notify();
    return chosen.length;
  }

  /** "Ignorer": the card goes everywhere. */
  dismiss(): void {
    this.offered = null;
    this.notify();
  }

  /** A normal window closed while others stay open: it can be reopened. */
  rememberWindow(saved: SessionWindow): void {
    const tabs = saved.spaces.flatMap((space) => space.tabs);
    if (tabs.length === 0) return;
    const active = saved.spaces.find((space) => space.spaceId === saved.activeSpaceId) ?? saved.spaces[0];
    const shown = active.tabs[active.activeIndex] ?? tabs[0];
    this.closed.push({ saved, title: shown.title || shown.url || "Nouvel onglet", tabCount: tabs.length });
  }

  closedWindows(): ClosedEntry[] {
    return this.closed.list().map((entry, index) => ({ index, title: entry.title, tabCount: entry.tabCount }));
  }

  /** Reopens a closed window (0: the last one); false when there is none. */
  reopenWindow(index = 0): boolean {
    const entry = this.closed.take(index);
    if (!entry) return false;
    this.deps.openWindow(entry.saved);
    return true;
  }

  private notify(): void {
    for (const window of this.deps.windows.all()) window.spaces.refresh();
  }
}

/** A window showing nothing but the start page. */
function isBlank(window: WindowPort): boolean {
  const tabs = window.spaces.allTabs();
  return tabs.length === 0 || (tabs.length === 1 && !tabs[0].tab.url);
}
