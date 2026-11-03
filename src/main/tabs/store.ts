import { randomUUID } from "node:crypto";
import type { CloseTabActivates, NewTabPosition } from "@shared/settings";
import { storableFavicon } from "@shared/favicon";
import type { TabId } from "@shared/types";
import { closeSuccessor, tabSlot } from "@shared/tab-order";
import { InPageVisits } from "../activation";
import type { SessionTab } from "../storage/session";
import { MAX_CLOSED_TABS, defaultTitle, type Tab } from "./model";

/** What a new tab's state starts with, beyond its saved entry (it depends on the session and settings). */
export interface TabDefaults {
  shieldsEnabled: boolean;
  /** Zoom factor of sites never zoomed by hand. */
  defaultZoom: number;
}

/** Pinned flags of a tab list, for `tabSlot`. */
const pinnedFlags = (tabs: readonly Tab[]) => tabs.map((tab) => ({ pinned: tab.state.isPinned }));

/**
 * The tab records of one TabManager, in sidebar order (pinned tabs first), with the active tab, the
 * most recently used order and the recently closed tabs. Knows nothing of pages or windows.
 */
export class TabStore {
  private tabs: Tab[] = [];
  private activeId: TabId | null = null;
  /** Tab ids, least recently activated first (for "close → back to the last used tab"). */
  private recent: TabId[] = [];
  /** Recently closed tabs, last one at the end. */
  private readonly closed: { url: string; index: number }[] = [];

  constructor(private readonly newId: () => string = randomUUID) {}

  /** The tabs, in sidebar order. */
  get all(): readonly Tab[] {
    return this.tabs;
  }

  get length(): number {
    return this.tabs.length;
  }

  get active(): TabId | null {
    return this.activeId;
  }

  find(id: TabId): Tab | undefined {
    return this.tabs.find((tab) => tab.id === id);
  }

  indexOf(id: TabId): number {
    return this.tabs.findIndex((tab) => tab.id === id);
  }

  /** Creates a tab from a saved entry (or a new one) at `index` (clamped to its pinned group). */
  insert(entry: SessionTab, index: number, defaults: TabDefaults): Tab {
    const id = this.newId();
    const tab: Tab = {
      id,
      view: null,
      state: {
        id,
        url: entry.url,
        title: entry.title || defaultTitle(entry.url),
        favicon: entry.favicon,
        isLoading: false,
        canGoBack: false,
        canGoForward: false,
        isPinned: entry.pinned,
        folderId: entry.pinned ? null : (entry.folderId ?? null),
        isBookmarked: false,
        blockedCount: 0,
        shieldsEnabled: defaults.shieldsEnabled,
        permissionRequest: null,
        interstitial: null,
        lastActiveAt: 0,
        isAudible: false,
        isMuted: false,
        zoom: Math.round(defaults.defaultZoom * 100),
        find: null,
        blockedPopup: null,
      },
      // A restored tab keeps when it was last seen (auto-archiving, ADR-022).
      lastSeenAt: entry.lastSeenAt ?? Date.now(),
      inPageVisits: new InPageVisits(),
      faviconSeq: 0,
    };
    this.place(tab, index);
    return tab;
  }

  /** Adds an existing tab record at `index` (clamped to its pinned group). */
  place(tab: Tab, index: number): void {
    this.tabs.splice(tabSlot(pinnedFlags(this.tabs), tab.state.isPinned, index), 0, tab);
  }

  /** Takes a tab out of the list (and of the recently used ones); the active id is left as it is. */
  take(id: TabId): { tab: Tab; index: number } | undefined {
    const index = this.indexOf(id);
    if (index === -1) return undefined;
    const [tab] = this.tabs.splice(index, 1);
    this.recent = this.recent.filter((recentId) => recentId !== id);
    return { tab, index };
  }

  /** Moves a tab to `toIndex`, within its pinned group. */
  move(id: TabId, toIndex: number): boolean {
    const from = this.indexOf(id);
    if (from === -1) return false;
    const [tab] = this.tabs.splice(from, 1);
    this.place(tab, toIndex);
    return true;
  }

  /** A tab was pinned or unpinned: it joins the end of the pinned group, or the start of the others. */
  repin(tab: Tab): void {
    this.tabs.splice(this.tabs.indexOf(tab), 1);
    this.place(tab, tab.state.isPinned ? this.tabs.length : 0);
  }

  /** Replaces the order of the tabs (same records, e.g. the folders' visual order). */
  setOrder(tabs: Tab[]): void {
    this.tabs = tabs;
  }

  /** Pinned tabs always sit before unpinned ones (after a restore). */
  sortPinnedFirst(): void {
    this.tabs.sort((a, b) => Number(b.state.isPinned) - Number(a.state.isPinned));
  }

  /** Empties the list, returning the tabs it had (the manager is going away). */
  clear(): Tab[] {
    const tabs = this.tabs;
    this.tabs = [];
    return tabs;
  }

  /** Makes `id` the active tab and the most recently used one. */
  setActive(id: TabId | null): void {
    this.activeId = id;
    if (id) this.recent = [...this.recent.filter((recentId) => recentId !== id), id];
  }

  /** The most recently used tab other than `id`, else any other tab. */
  otherThan(id: TabId): TabId | undefined {
    const others = this.recent.filter((recentId) => recentId !== id && this.find(recentId));
    return others.at(-1) ?? this.tabs.find((tab) => tab.id !== id)?.id;
  }

  /** The tab to activate once the active tab, formerly at `index`, is removed. */
  closeSuccessor(index: number, activates: CloseTabActivates): Tab | undefined {
    return closeSuccessor(this.tabs, index, activates, () => {
      const recentId = this.recent.at(-1);
      return recentId ? this.find(recentId) : undefined;
    });
  }

  /** Right after the active tab (never among pinned tabs), or at the end. */
  indexAfterActive(): number {
    const active = this.indexOf(this.activeId ?? "");
    const pinned = this.tabs.filter((tab) => tab.state.isPinned).length;
    return active === -1 ? this.tabs.length : Math.max(active + 1, pinned);
  }

  /** Where a new tab goes: at the end, or right after the active tab. */
  newTabIndex(position: NewTabPosition): number {
    return position === "next" ? this.indexAfterActive() : this.tabs.length;
  }

  /** "Rouvrir l'onglet fermé" (ADR-033): kept in memory only, with the window (private ones too). */
  rememberClosed(url: string, index: number): void {
    if (!url) return;
    this.closed.push({ url, index });
    if (this.closed.length > MAX_CLOSED_TABS) this.closed.shift();
  }

  get canReopenClosed(): boolean {
    return this.closed.length > 0;
  }

  popClosed(): { url: string; index: number } | undefined {
    return this.closed.pop();
  }

  /** The saved form of the tabs; `onScreen` tabs are being seen right now. */
  snapshot(onScreen: (tab: Tab) => boolean, now = Date.now()): SessionTab[] {
    // Only small data: favicons go to session.json (ADR-018).
    return this.tabs.map((record) => {
      const { state, lastSeenAt } = record;
      const tab: SessionTab = { url: state.url, title: state.title, favicon: storableFavicon(state.favicon), pinned: state.isPinned };
      if (state.folderId) tab.folderId = state.folderId;
      // Tabs on screen are being seen right now (auto-archiving counts from when they left it).
      tab.lastSeenAt = onScreen(record) ? now : lastSeenAt;
      return tab;
    });
  }
}
