import type { WebContents, WebContentsView } from "electron";
import { displayUrl } from "@shared/url";
import type { SleepCandidate } from "../sleep";
import { historyOf, isDiscarded, liveContents, showsWebPage, unwire, type Tab } from "./model";
import type { TabLayout } from "./layout";
import type { TabStore } from "./store";

/** What TabLifecycle needs from the rest of its TabManager. */
export interface LifecycleDeps {
  readonly store: TabStore;
  readonly layout: TabLayout;
  /** A new, hardened-session page view for a tab (radius and background already set). */
  createView(): WebContentsView;
  /** Listens to a tab's new page (see `TabEvents`). */
  wire(tab: Tab, contents: WebContents): void;
  /** A tab got a new page: per-tab settings that live on the page (mobile user agent) are applied. */
  viewCreated(tab: Tab, contents: WebContents): void;
  /** Gives the page its site's zoom. */
  applyZoom(tab: Tab): void;
  /** Whether content blocking is on for `url` in the manager's session. */
  shieldsFor(url: string): boolean;
  emit(): void;
}

/**
 * When a tab has a page: the "view null + URL" mechanism (ADR-014). A tab's page is created on
 * first load, destroyed when the tab sleeps (`discard`), and created again from the saved URL and
 * back/forward list when it wakes. Also the page parked below the start page or an internal page.
 */
export class TabLifecycle {
  constructor(private readonly deps: LifecycleDeps) {}

  /** The tab's page view, created (and wired) if it has none. */
  ensureView(tab: Tab): WebContentsView {
    if (tab.view && liveContents(tab)) return tab.view;
    const view = this.deps.createView();
    tab.view = view;
    this.deps.wire(tab, view.webContents);
    this.deps.viewCreated(tab, view.webContents);
    return view;
  }

  /** Loads the URL a discarded tab kept from the saved session (or from when it went to sleep). */
  wake(tab: Tab): void {
    if (!isDiscarded(tab)) return;
    tab.waking = tab.state.url;
    const contents = this.ensureView(tab).webContents;
    const load = () => contents.loadURL(tab.state.url).catch(() => {
      // Load failures are reported through did-fail-load.
    });
    // A tab put to sleep gets its back/forward list back (a restored tab has none).
    const history = tab.sleptHistory;
    tab.sleptHistory = undefined;
    if (history?.entries[history.index]?.url === tab.state.url) contents.navigationHistory.restore(history).catch(load);
    else void load();
  }

  /**
   * Puts a background tab to sleep: its page is destroyed, url/title/favicon (and the back/forward
   * list) are kept, and it loads again when activated. Refused for tabs on screen.
   */
  discard(tab: Tab | undefined): boolean {
    if (!tab?.view || this.deps.layout.visibleTabs().includes(tab)) return false;
    this.deps.layout.detachView(tab.view);
    tab.sleptHistory = historyOf(tab) ?? tab.sleptHistory;
    const contents = liveContents(tab);
    unwire(tab);
    tab.view = null;
    contents?.close();
    Object.assign(tab.state, { isLoading: false, blockedCount: 0, permissionRequest: null });
    // A page parked below the start page or an internal page is gone: nothing left to go back to.
    if (!showsWebPage(tab.state.url)) this.updateHistory(tab);
    this.deps.emit();
    return true;
  }

  /** Closes a tab's page for good (another session takes over): it reloads when shown. */
  closePage(tab: Tab): void {
    if (!tab.view) return;
    unwire(tab);
    liveContents(tab)?.close();
    tab.view = null;
    tab.forwardTo = undefined;
    Object.assign(tab.state, { isLoading: false, canGoBack: false, canGoForward: false, blockedCount: 0, permissionRequest: null });
  }

  /** Tabs on screen were seen now (their idle time starts when they leave the screen). */
  markSeen(now = Date.now()): void {
    for (const tab of this.deps.layout.visibleTabs()) tab.lastSeenAt = now;
  }

  /** What the sleep policy needs to know about each tab; tabs on screen are marked seen now. */
  sleepCandidates(now = Date.now()): SleepCandidate[] {
    this.markSeen(now);
    const shown = new Set(this.deps.layout.visibleTabs());
    return this.deps.store.all.map((tab) => {
      const contents = liveContents(tab);
      return {
        id: tab.id,
        hasView: !!contents,
        shown: shown.has(tab),
        // Muted tabs still count: the user may unmute them at any time.
        audible: tab.state.isAudible || (contents?.isCurrentlyAudible() ?? false),
        permissionPending: tab.state.permissionRequest !== null,
        devTools: contents?.isDevToolsOpened() ?? false,
        lastSeenAt: tab.lastSeenAt,
        pinned: tab.state.isPinned,
        url: tab.state.url,
        inSplit: this.deps.layout.inSplit(tab.id),
      };
    });
  }

  /**
   * Back from the start page or an internal page: the page parked below it is shown again, as it
   * was (its own history untouched), and Forward leads back to what was left.
   */
  unpark(tab: Tab, contents: WebContents): void {
    tab.forwardTo = tab.state.url;
    const url = contents.getURL();
    Object.assign(tab.state, {
      url,
      title: contents.getTitle() || displayUrl(url),
      favicon: tab.parkedFavicon ?? null,
      isLoading: contents.isLoading(),
      shieldsEnabled: this.deps.shieldsFor(url),
    });
    this.updateHistory(tab);
    this.deps.layout.syncAttachment();
    this.deps.applyZoom(tab);
    this.deps.emit();
  }

  /** Back/forward availability of the tab, page history and parked page included. */
  updateHistory(tab: Tab): void {
    const contents = liveContents(tab);
    if (!showsWebPage(tab.state.url)) {
      // Start page or internal page: Back shows the page parked below it, if any.
      tab.state.canGoBack = !!contents?.getURL();
      tab.state.canGoForward = false;
    } else {
      tab.state.canGoBack = contents?.navigationHistory.canGoBack() ?? false;
      tab.state.canGoForward = tab.forwardTo !== undefined || (contents?.navigationHistory.canGoForward() ?? false);
    }
  }
}
