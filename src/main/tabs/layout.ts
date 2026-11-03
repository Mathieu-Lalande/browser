import type { WebContents, WebContentsView } from "electron";
import { clampRatio, splitLayout, splitWith, splitWithout } from "@shared/split";
import type { Bounds, SplitState, TabId } from "@shared/types";
import type { SessionSplit } from "../storage/session";
import { showsWebPage, type Tab } from "./model";
import type { TabStore } from "./store";

/** The part of a window TabLayout uses: where page views are attached. */
export interface ViewHost {
  readonly contentView: { addChildView(view: WebContentsView): void; removeChildView(view: WebContentsView): void };
}

/**
 * Which tabs of a TabManager are on screen and where: the page area's bounds, the split view's
 * panes, and the page views attached to the window (only while the manager is visible).
 */
export class TabLayout {
  private bounds: Bounds = { x: 0, y: 0, width: 0, height: 0 };
  private attached = new Set<WebContentsView>();
  private splitState: SplitState | null = null;

  constructor(
    private readonly window: ViewHost,
    private readonly store: TabStore,
    /** A hidden manager (space not shown) attaches no view. */
    public visible: boolean,
  ) {}

  get split(): SplitState | null {
    return this.splitState;
  }

  /** Whether the split is on screen (the active tab is one of its tabs). */
  get splitVisible(): boolean {
    const active = this.store.active;
    return !!active && !!this.splitState?.tabIds.includes(active);
  }

  inSplit(id: TabId): boolean {
    return !!this.splitState?.tabIds.includes(id);
  }

  /** The tabs on screen: the split's when it is visible, else the active one. */
  shownTabs(): Tab[] {
    if (this.splitVisible) return this.splitState!.tabIds.map((id) => this.store.find(id)).filter((tab) => tab !== undefined);
    const active = this.store.active ? this.store.find(this.store.active) : undefined;
    return active ? [active] : [];
  }

  /** The tabs on screen while the manager is visible (none while hidden). */
  visibleTabs(): Tab[] {
    return this.visible ? this.shownTabs() : [];
  }

  isAttached(view: WebContentsView | null): view is WebContentsView {
    return !!view && this.attached.has(view);
  }

  /** The page of `id` when it is on screen (attached). */
  visiblePage(tab: Tab | undefined): WebContents | null {
    return tab?.view && this.attached.has(tab.view) && !tab.view.webContents.isDestroyed() ? tab.view.webContents : null;
  }

  /** "Ouvrir en vue scindée avec l'onglet actif": false when the split cannot take `id`. */
  openSplit(id: TabId): boolean {
    const split = splitWith(this.splitState, this.store.active, id);
    if (!split) return false;
    this.splitState = split;
    return true;
  }

  /** Leaves split view (the caller re-syncs the attachment). */
  exitSplit(): boolean {
    if (!this.splitState) return false;
    this.splitState = null;
    return true;
  }

  /** A tab left the manager: it leaves the split too. */
  removeFromSplit(id: TabId): void {
    this.splitState = splitWithout(this.splitState, id);
  }

  /** Divider positions (from the chrome UI's drag), 0…1 each, clamped. */
  setRatios(ratioX: number, ratioY: number): boolean {
    if (!this.splitState) return false;
    this.splitState = { ...this.splitState, ratioX: clampRatio(ratioX), ratioY: clampRatio(ratioY) };
    this.layout();
    return true;
  }

  /** Brings back a saved split (`tabIds` of the restored tabs, in its order). */
  restoreSplit(saved: SessionSplit | null | undefined, tabIds: TabId[]): void {
    if (saved && tabIds.length >= 2) this.splitState = { tabIds, ratioX: clampRatio(saved.ratioX), ratioY: clampRatio(saved.ratioY) };
  }

  /** The saved form of the split, by index in the tab list. */
  snapshotSplit(): SessionSplit | null {
    return this.splitState && { tabIndexes: this.splitState.tabIds.map((id) => this.store.indexOf(id)), ratioX: this.splitState.ratioX, ratioY: this.splitState.ratioY };
  }

  /** The whole page area (every pane of a split), in window content coordinates. */
  get area(): Bounds {
    return { ...this.bounds };
  }

  /** Where the active page is drawn, in window content coordinates (its pane in a split). */
  get viewBounds(): Bounds {
    const shown = this.shownTabs();
    const index = shown.findIndex((tab) => tab.id === this.store.active);
    if (shown.length < 2 || index === -1) return { ...this.bounds };
    return splitLayout(this.bounds, shown.length, this.splitState?.ratioX, this.splitState?.ratioY).panes[index];
  }

  setBounds(bounds: Bounds): void {
    this.bounds = {
      x: Math.round(bounds.x),
      y: Math.round(bounds.y),
      width: Math.max(0, Math.round(bounds.width)),
      height: Math.max(0, Math.round(bounds.height)),
    };
    this.layout();
  }

  /** Reader mode (ADR-026) is drawn by the chrome UI over a web page, outside split view only. */
  showsReader(tab: Tab): boolean {
    return !!tab.state.reader && showsWebPage(tab.state.url) && !tab.state.interstitial && !tab.state.loadError && !(this.splitVisible && this.inSplit(tab.id));
  }

  /**
   * The shown tabs' views are attached (laid out side by side in a split), except where the chrome
   * UI renders in their place (start page, internal page, interstitial), and none while hidden.
   */
  syncAttachment(): void {
    const wanted = new Set(this.visible ? this.paneViews().filter((view) => view !== null) : []);
    for (const view of this.attached) if (!wanted.has(view)) this.window.contentView.removeChildView(view);
    for (const view of wanted) if (!this.attached.has(view)) this.window.contentView.addChildView(view);
    this.attached = wanted;
    this.layout();
  }

  /** Takes one view off the window (its tab leaves or sleeps). */
  detachView(view: WebContentsView | null): void {
    if (!view || !this.attached.has(view)) return;
    this.window.contentView.removeChildView(view);
    this.attached.delete(view);
  }

  /** Takes every view off the window. */
  detach(): void {
    for (const view of this.attached) this.window.contentView.removeChildView(view);
    this.attached.clear();
  }

  /** The window is closing: its views go with it (removing them from a destroyed window hangs). */
  forget(): void {
    this.attached.clear();
  }

  /** One entry per pane on screen: the view to show there, or null when the chrome UI draws it. */
  private paneViews(): (WebContentsView | null)[] {
    const shown = this.shownTabs();
    return shown.map((tab) =>
      showsWebPage(tab.state.url) && !tab.state.interstitial && !tab.state.loadError && !(shown.length === 1 && this.showsReader(tab)) ? tab.view : null,
    );
  }

  /** Bounds of the attached views: the whole viewport, or the split's panes. */
  private layout(): void {
    if (!this.attached.size) return;
    const panes = this.paneViews();
    const { panes: rects } = splitLayout(this.bounds, panes.length, this.splitState?.ratioX, this.splitState?.ratioY);
    panes.forEach((view, index) => {
      if (view && this.attached.has(view)) view.setBounds(rects[index]);
    });
  }
}
