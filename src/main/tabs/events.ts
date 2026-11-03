import type { WebContents } from "electron";
import type { FolderId } from "@shared/folders";
import type { TabId } from "@shared/types";
import { displayUrl, isPageOpenableUrl } from "@shared/url";
import { normalizeThemeColor } from "@shared/site-color";
import { loadFavicon } from "../favicons";
import { attachTabPrivacy, httpsFallbackFor } from "../privacy";
import { PageFind } from "../find";
import { hardenWebContents } from "../security";
import { parsePageWheel } from "../page-swipe-script";
import { parseAnnotatorMessage } from "../annotations/page";
import { showsWebPage, withoutHash, type Tab, type TabManagerHooks } from "./model";
import type { TabLayout } from "./layout";
import type { TabLifecycle } from "./lifecycle";
import type { TabPageActions } from "./page-actions";
import type { TabStore } from "./store";

/** What TabEvents needs from the rest of its TabManager. */
export interface EventDeps {
  readonly store: TabStore;
  readonly layout: TabLayout;
  readonly lifecycle: TabLifecycle;
  readonly actions: TabPageActions;
  readonly hooks: TabManagerHooks;
  /** Whether content blocking is on for `url` in the manager's session. */
  shieldsFor(url: string): boolean;
  emit(): void;
  create(input: string, options: { activate?: boolean; index?: number; folderId?: FolderId | null }): TabId;
  activate(id: TabId): void;
  zoom(id: TabId, direction: 1 | -1): void;
  /** The page closed itself (`window.close()`): the tab goes away. */
  pageClosed(tab: Tab): void;
}

/** `contents.on`, remembering each listener so that `Tab.unwire` can take them all off again. */
type Listen = WebContents["on"];

/**
 * Follows a tab's page: each concern binds its own webContents events (security and privacy,
 * navigation, page info, page hooks, find in page). Listeners are tracked so that a live tab
 * moving to another manager can be rewired there.
 */
export class TabEvents {
  constructor(private readonly deps: EventDeps) {}

  wire(tab: Tab, contents: WebContents): void {
    const listeners: [string, (...args: never[]) => void][] = [];
    const on = ((event: string, listener: (...args: never[]) => void) => {
      contents.on(event as "focus", listener as () => void);
      listeners.push([event, listener]);
    }) as unknown as Listen;
    tab.unwire = () => {
      for (const [event, listener] of listeners) contents.off(event as "focus", listener as () => void);
    };

    this.bindSecurity(tab, contents);
    // The page closed itself: never touch it again (a destroyed webContents throws).
    on("destroyed", () => this.deps.pageClosed(tab));
    this.bindPageHooks(tab, contents, on);
    // Before the finder: it resets its own state on the same navigation events, after the tab's.
    this.bindNavigation(tab, contents, on);
    this.bindFind(tab, contents, on);
    this.bindPageInfo(tab, contents, on);
    this.bindLoadErrors(tab, contents, on);
  }

  /** Records a committed page in the history (hash-only changes and pushState storms excepted). */
  visit(tab: Tab, url: string, inPage: boolean): void {
    // Hash-only changes (anchors, old-style routers) are not new visits.
    if (inPage && tab.lastVisit && withoutHash(tab.lastVisit) === withoutHash(url)) return;
    // pushState storms must not flood the history: one in-page visit per second at most (ADR-018).
    if (!inPage) tab.inPageVisits.reset(url);
    else if (!tab.inPageVisits.accept(url, Date.now())) return;
    tab.lastVisit = url;
    this.deps.hooks.onVisit?.(url);
  }

  /** Popups and links opened by the page, the popup blocker, content blocking and permission prompts. */
  private bindSecurity(tab: Tab, contents: WebContents): void {
    const { deps } = this;
    hardenWebContents(contents, {
      openTab: (url, foreground) => {
        // Defense in depth: hardenWebContents already only lets web pages and about:blank through.
        if (!isPageOpenableUrl(url)) return;
        const index = deps.store.all.indexOf(tab) + 1;
        // A link opened from a filed tab stays in its folder.
        deps.create(url, { activate: foreground, index, folderId: tab.state.folderId });
      },
      peek: deps.hooks.peekLink && ((url) => deps.hooks.peekLink?.(tab.id, url)),
      popupBlocked: (url) => {
        // The notice keeps the last blocked popup of the page; "Ouvrir" opens it (openBlockedPopup).
        if (!isPageOpenableUrl(url)) return;
        tab.state.blockedPopup = { url, count: (tab.state.blockedPopup?.count ?? 0) + 1 };
        deps.emit();
      },
    });
    attachTabPrivacy(contents, {
      blocked: () => {
        tab.state.blockedCount++;
        deps.emit();
      },
      permissionChanged: (prompt) => {
        tab.state.permissionRequest = prompt;
        deps.emit();
      },
    });
  }

  /** Split pane focus, page gestures and highlights, document hooks, zoom, context menu, media. */
  private bindPageHooks(tab: Tab, contents: WebContents, on: Listen): void {
    const { deps } = this;
    const { hooks } = deps;
    // Clicking a pane of a visible split makes its tab the active one (address bar, shortcuts…).
    on("focus", () => {
      if (deps.layout.splitVisible && tab.id !== deps.store.active && deps.layout.inSplit(tab.id)) deps.activate(tab.id);
    });
    // Two-finger swipe back/forward (ADR-033): the watcher in the page's isolated world reports
    // swipe candidates as tagged debug messages of the main frame (`input-event` has no deltas).
    on("console-message", (details: Electron.Event<Electron.WebContentsConsoleMessageEventParams>) => {
      if (details.frame !== contents.mainFrame) return;
      const sample = parsePageWheel(details.message);
      if (sample) return hooks.pageWheel?.(tab.id, sample);
      const click = parseAnnotatorMessage(details.message);
      if (click) hooks.annotationClick?.(tab.id, click);
    });
    on("dom-ready", () => {
      hooks.boostPage?.(contents);
      hooks.gesturePage?.(contents);
      hooks.pageReady?.(tab.id, contents);
      hooks.notifyPage?.(tab.id, contents);
      hooks.translatePage?.(tab.id, contents);
      hooks.annotatePage?.(tab.id, contents);
    });
    // Ctrl+wheel and pinch: same steps as the zoom commands, remembered per site, paced by the window.
    on("zoom-changed", (_event, direction) => {
      const step = direction === "in" ? 1 : -1;
      if (hooks.pageZoom) hooks.pageZoom(tab.id, step);
      else deps.zoom(tab.id, step);
    });
    on("context-menu", (_event, params) => {
      // A parked page (below the start page or an internal page) is not on screen.
      if (showsWebPage(tab.state.url) && !tab.state.interstitial && !tab.state.loadError) hooks.contextMenu?.(tab.id, params);
    });
    on("audio-state-changed", (event) => {
      tab.state.isAudible = event.audible;
      deps.emit();
    });
    on("media-started-playing", () => hooks.media?.(tab.id, contents, true));
    on("media-paused", () => hooks.media?.(tab.id, contents, false));
  }

  /** Loading, committed navigations (full and in-page), the tab's address and history. */
  private bindNavigation(tab: Tab, contents: WebContents, on: Listen): void {
    const { deps } = this;
    const refresh = () => {
      if (contents.isDestroyed()) return;
      const url = contents.getURL();
      // A parked page (below the start page or an internal page) does not change the tab's
      // address, and while an interstitial is shown, the tab keeps the address the user asked for.
      if (url && showsWebPage(tab.state.url) && !tab.state.interstitial) {
        tab.state.url = url;
        tab.state.shieldsEnabled = deps.shieldsFor(url);
      }
      deps.lifecycle.updateHistory(tab);
      deps.emit();
    };
    /** A page committed in the main frame: the start/internal page left with Back is no longer ahead. */
    const committed = () => {
      if (showsWebPage(tab.state.url)) tab.forwardTo = undefined;
    };

    on("did-start-navigation", (details) => {
      if (!details.isMainFrame || details.isSameDocument) return;
      // A new page: fresh blocked counter, no blocked popup, and any interstitial gives way to it.
      tab.state.blockedCount = 0;
      tab.state.blockedPopup = null;
      tab.state.readerable = false;
      if (tab.state.interstitial || tab.state.loadError || tab.state.reader) {
        tab.state.interstitial = null;
        tab.state.loadError = null;
        tab.state.reader = false;
        deps.layout.syncAttachment();
      }
      deps.emit();
    });
    on("did-start-loading", () => {
      // A parked page loading (script navigation) does not make the start/internal page spin.
      if (!showsWebPage(tab.state.url)) return;
      tab.state.isLoading = true;
      deps.emit();
    });
    on("did-stop-loading", () => {
      tab.state.isLoading = false;
      refresh();
      void deps.actions.checkReaderable(tab, contents);
    });
    on("did-navigate", (_event, url) => {
      // A new document: its favicon comes with it (or not at all).
      if (tab.faviconKey && !tab.faviconKey.startsWith(`${url}\n`)) {
        tab.faviconKey = undefined;
        tab.faviconSeq++;
        if (tab.waking) {
          // A woken tab keeps its saved favicon until the page reports its own.
        } else if (showsWebPage(tab.state.url)) tab.state.favicon = null;
        else tab.parkedFavicon = null;
      }
      if (url === tab.waking) tab.lastVisit = url;
      else this.visit(tab, url, false);
      tab.waking = undefined;
      committed();
      deps.actions.applyZoom(tab);
      refresh();
    });
    on("did-navigate-in-page", (_event, url, isMainFrame) => {
      if (isMainFrame) {
        this.visit(tab, url, true);
        committed();
      }
      refresh();
    });
  }

  /** Title, favicon and theme color of the page. */
  private bindPageInfo(tab: Tab, contents: WebContents, on: Listen): void {
    const { deps } = this;
    // Dynamic theme (ADR-038): Chromium reports each change of the document's theme-color (null when none).
    on("did-change-theme-color", (_event, color) => {
      const themeColor = normalizeThemeColor(color);
      if (!showsWebPage(tab.state.url) || themeColor === (tab.state.themeColor ?? null)) return;
      tab.state.themeColor = themeColor;
      deps.emit();
    });
    on("page-title-updated", (_event, title) => {
      // A parked view (behind the start page or an internal page) does not name the tab.
      if (!showsWebPage(tab.state.url)) return;
      tab.state.title = title || displayUrl(contents.getURL());
      if (title) deps.hooks.onPageInfo?.(contents.getURL(), { title });
      deps.emit();
    });
    on("page-favicon-updated", (_event, favicons) => {
      // Fetched by main with the tab's own session, handed to the UI as a data: URL (ADR-018).
      const pageUrl = contents.getURL();
      const key = `${pageUrl}\n${favicons.join("\n")}`;
      if (key === tab.faviconKey) return;
      tab.faviconKey = key;
      this.fetchFavicon(tab, contents, favicons, pageUrl, true);
    });
  }

  /**
   * Fetches the page's favicon (newest request wins). A parked page's favicon (`keepParked`) is kept
   * for when Back shows it again.
   */
  fetchFavicon(tab: Tab, contents: WebContents, favicons: string[], pageUrl: string, keepParked: boolean): void {
    const seq = ++tab.faviconSeq;
    void loadFavicon(contents, favicons, pageUrl).then((favicon) => {
      if (seq !== tab.faviconSeq || contents.isDestroyed()) return;
      if (!showsWebPage(tab.state.url)) {
        if (keepParked) tab.parkedFavicon = favicon;
        return;
      }
      tab.state.favicon = favicon;
      if (favicon) this.deps.hooks.onPageInfo?.(pageUrl, { favicon });
      this.deps.emit();
    });
  }

  /** Find in page, listening through `on` so a tab moving to another space keeps a single finder. */
  private bindFind(tab: Tab, contents: WebContents, on: Listen): void {
    tab.finder = new PageFind(contents, on, tab.state.find, (find) => {
      tab.state.find = find;
      this.deps.emit();
    });
  }

  /** Failed loads: the HTTPS-Only interstitial, or the chrome UI's error page. */
  private bindLoadErrors(tab: Tab, contents: WebContents, on: Listen): void {
    const { deps } = this;
    on("did-fail-load", (_event, code, description, url, isMainFrame) => {
      // -3 is ERR_ABORTED: a navigation replaced by another one, not a real failure.
      // A parked page's failures do not concern the start/internal page shown in the tab.
      if (!isMainFrame || code === -3 || !showsWebPage(tab.state.url)) return;
      const httpUrl = httpsFallbackFor(contents.id, url, code);
      if (httpUrl) {
        // HTTPS-Only: the upgraded load failed; the chrome UI asks before falling back to http.
        tab.state.interstitial = { kind: "https-only", url: httpUrl };
        tab.state.url = httpUrl;
        tab.state.title = displayUrl(httpUrl);
        tab.state.isLoading = false;
        deps.layout.syncAttachment();
        deps.emit();
        return;
      }
      tab.state.title = `Erreur : ${displayUrl(url) || description}`;
      tab.state.isLoading = false;
      // The chrome UI explains the failure (LoadErrorPage) instead of Chromium's blank error page.
      tab.state.loadError = { code, description, url };
      deps.layout.syncAttachment();
      deps.emit();
    });
  }
}
