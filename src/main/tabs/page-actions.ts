import type { Session, WebContents } from "electron";
import type { TabId } from "@shared/types";
import { webHostname } from "@shared/hosts";
import { allowHttp, respondPermission, setShieldsEnabled } from "../privacy";
import { mobileUserAgent } from "../fingerprint";
import { isPageReaderable } from "../reader/page";
import { togglePictureInPicture } from "../media/pip";
import { browserPagesZoomFactor, rememberBrowserPagesZoom, rememberSiteZoom, siteZoomFactor } from "../zoom";
import { nextZoomFactor, sameFactor } from "../zoom/levels";
import { liveContents, showsWebPage, type Tab, type TabOptions } from "./model";
import type { TabLayout } from "./layout";
import type { TabStore } from "./store";

/** What TabPageActions needs from the rest of its TabManager. */
export interface PageActionDeps {
  readonly store: TabStore;
  readonly layout: TabLayout;
  options(): TabOptions;
  session(): Session | undefined;
  emit(): void;
  reload(id: TabId): void;
  navigate(id: TabId, input: string): void;
  create(input: string, options: { index: number }): TabId;
}

/**
 * What the user does to a tab's page beyond navigating: zoom, mute, find in page, picture in
 * picture, reader mode, mobile site, shields, the HTTPS-Only interstitial, blocked popups and
 * permission prompts.
 */
export class TabPageActions {
  constructor(private readonly deps: PageActionDeps) {}

  /**
   * Zooms the tab's page one step in (1) or out (-1), or back to the default zoom (0). The level
   * is remembered for the site (every tab on it follows), except for pages without a web host.
   * The pages the chrome UI draws (start page, browser://…) share one remembered level (ADR-045),
   * which the UI applies to them alone, never to the sidebar.
   */
  zoom(id: TabId, direction: 1 | -1 | 0): void {
    const tab = this.deps.store.find(id);
    if (tab && !showsWebPage(tab.state.url)) {
      const { defaultZoom } = this.deps.options();
      const next = nextZoomFactor(this.browserPagesZoom(), direction, defaultZoom);
      if (next !== undefined) rememberBrowserPagesZoom(next, defaultZoom, this.deps.session());
      return;
    }
    const contents = tab && liveContents(tab);
    if (!tab || !contents || !showsWebPage(tab.state.url)) return;
    const { defaultZoom } = this.deps.options();
    const next = nextZoomFactor(contents.getZoomFactor(), direction, defaultZoom);
    if (next === undefined) return;
    if (webHostname(contents.getURL())) rememberSiteZoom(contents.getURL(), next, defaultZoom, this.deps.session());
    else contents.setZoomFactor(next);
    this.applyZoom(tab);
  }

  /** The zoom factor of the pages the chrome UI draws, in this tab session. */
  browserPagesZoom(): number {
    return browserPagesZoomFactor(this.deps.options().defaultZoom, this.deps.session());
  }

  /** Gives the page its site's zoom (or the default zoom), and mirrors it in the tab state. */
  applyZoom(tab: Tab): void {
    const contents = liveContents(tab);
    if (!contents) return;
    const factor = siteZoomFactor(contents.getURL(), this.deps.options().defaultZoom, this.deps.session());
    if (factor !== undefined && !sameFactor(contents.getZoomFactor(), factor)) contents.setZoomFactor(factor);
    const zoom = Math.round((factor ?? contents.getZoomFactor()) * 100);
    if (zoom === tab.state.zoom) return;
    tab.state.zoom = zoom;
    this.deps.emit();
  }

  toggleMute(id: TabId): void {
    const tab = this.deps.store.find(id);
    const contents = tab && liveContents(tab);
    if (!tab || !contents) return;
    contents.setAudioMuted(!contents.isAudioMuted());
    tab.state.isMuted = contents.isAudioMuted();
    this.deps.emit();
  }

  /** Opens the find bar on the tab's page; false (no-op) on the start page and internal pages. */
  openFind(id: TabId): boolean {
    const tab = this.deps.store.find(id);
    if (!tab?.finder || !showsWebPage(tab.state.url) || tab.state.interstitial) return false;
    tab.finder.open();
    return true;
  }

  findQuery(id: TabId, query: string, matchCase: boolean): void {
    const tab = this.deps.store.find(id);
    if (tab && showsWebPage(tab.state.url)) tab.finder?.search(query, matchCase);
  }

  findStep(id: TabId, forward: boolean): void {
    const tab = this.deps.store.find(id);
    if (tab && showsWebPage(tab.state.url) && !tab.state.interstitial) tab.finder?.step(forward);
  }

  /** Closes the find bar; the page gets the focus back when it is the active tab. */
  closeFind(id: TabId): void {
    const tab = this.deps.store.find(id);
    if (!tab?.finder) return;
    tab.finder.close();
    if (id === this.deps.store.active && this.deps.layout.isAttached(tab.view)) liveContents(tab)?.focus();
  }

  /** Picture-in-picture on the page's main video (or back from it). */
  pictureInPicture(id: TabId): void {
    const tab = this.deps.store.find(id);
    const contents = tab && liveContents(tab);
    if (contents && showsWebPage(tab.state.url)) void togglePictureInPicture(contents);
  }

  /**
   * Turns reader mode on (main extracted the article of `url`) or off. Refused when the tab moved
   * on to another page meanwhile.
   */
  setReader(id: TabId, on: boolean, url?: string): boolean {
    const tab = this.deps.store.find(id);
    const contents = tab && liveContents(tab);
    if (!tab || (on && (!contents || contents.getURL() !== url || !showsWebPage(tab.state.url)))) return false;
    if (!!tab.state.reader === on) return true;
    tab.state.reader = on;
    this.deps.layout.syncAttachment();
    this.deps.emit();
    return true;
  }

  /** Readability's quick check, after each load: the address bar shows the reader button. */
  async checkReaderable(tab: Tab, contents: WebContents): Promise<void> {
    if (!showsWebPage(tab.state.url)) return;
    const url = contents.getURL();
    const readerable = await isPageReaderable(contents);
    if (contents.isDestroyed() || contents.getURL() !== url || readerable === !!tab.state.readerable) return;
    tab.state.readerable = readerable;
    this.deps.emit();
  }

  /** "Demander la version mobile" (ADR-026): a mobile user agent for this tab's page, then a reload. */
  toggleMobileSite(id: TabId): void {
    const tab = this.deps.store.find(id);
    const contents = tab && liveContents(tab);
    if (!tab || !contents || !showsWebPage(tab.state.url)) return;
    tab.state.mobileSite = !tab.state.mobileSite;
    this.applyUserAgent(tab, contents);
    contents.reload();
    this.deps.emit();
  }

  applyUserAgent(tab: Tab, contents: WebContents): void {
    const base = contents.session.getUserAgent();
    contents.setUserAgent(tab.state.mobileSite ? mobileUserAgent(base) : base);
  }

  /** Turn content blocking off (or back on) for the tab's site, then reload to apply it. */
  toggleShields(id: TabId): void {
    const tab = this.deps.store.find(id);
    if (!tab?.state.url || tab.state.interstitial) return;
    setShieldsEnabled(tab.state.url, !tab.state.shieldsEnabled, this.deps.session());
    this.deps.reload(id);
  }

  /** HTTPS-Only interstitial: the user accepts plain http for this host (until the browser quits). */
  proceedHttp(id: TabId): void {
    const url = this.deps.store.find(id)?.state.interstitial?.url;
    if (!url) return;
    allowHttp(url);
    this.deps.navigate(id, url);
  }

  /** The user opens the popup the blocker stopped ("Ouvrir" in the notice), next to its tab. */
  openBlockedPopup(id: TabId): void {
    const tab = this.deps.store.find(id);
    const url = tab?.state.blockedPopup?.url;
    if (!tab || !url) return;
    tab.state.blockedPopup = null;
    this.deps.create(url, { index: this.deps.store.all.indexOf(tab) + 1 });
  }

  dismissBlockedPopup(id: TabId): void {
    const tab = this.deps.store.find(id);
    if (!tab?.state.blockedPopup) return;
    tab.state.blockedPopup = null;
    this.deps.emit();
  }

  respondPermission(id: TabId, promptId: string, allow: boolean, remember: boolean): void {
    const tab = this.deps.store.find(id);
    const contents = tab && liveContents(tab);
    if (contents) respondPermission(contents.id, promptId, allow, remember);
  }
}
