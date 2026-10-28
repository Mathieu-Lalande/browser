import { WebContentsView, type BaseWindow, type WebContents } from "electron";
import { Channels } from "@shared/ipc";
import { isPeekableUrl, peekLayout, type PeekAction, type PeekState } from "@shared/peek";
import { MAX_SPLIT_TABS } from "@shared/split";
import type { TabId } from "@shared/types";
import { displayUrl } from "@shared/url";
import type { Overlay } from "./overlay";
import { attachTabPrivacy, respondPermission } from "./privacy";
import { hardenWebContents } from "./security";
import type { TabManager } from "./tabs";

/** What the link peek needs from its window (a BrowserController). */
export interface PeekHost {
  readonly window: BaseWindow;
  readonly overlay: Overlay;
  readonly tabs: TabManager;
}

/** Corner radius of the peeked page inside the card. */
const PAGE_RADIUS = 8;

/**
 * Link peek (ADR-027): a link previewed in a card floating above the current page. The page is a
 * WebContentsView of its own, hardened like a tab's (sandbox, no preload, popup blocker, shields)
 * in the source tab's session (a private window's stays private), stacked above the overlay layer,
 * which draws the dimmed backdrop, the card and its header. One at a time; closing destroys it.
 * Nothing is recorded (history, session) until it becomes a tab.
 */
export class LinkPeek {
  private view: WebContentsView | null = null;
  /** The TabManager of the source tab (a promoted page joins it) and that tab. */
  private manager: TabManager | null = null;
  private sourceId: TabId | null = null;
  private requested = "";
  private favicons: string[] = [];
  private unlisten: (() => void) | null = null;

  constructor(private readonly host: PeekHost) {}

  get isOpen(): boolean {
    return this.view !== null;
  }

  /** Previews `url` (a link of tab `tabId`'s page): only what a page may open (http(s), about:blank). */
  open(tabId: TabId, url: string): void {
    if (!isPeekableUrl(url) || this.host.window.isDestroyed()) return;
    const source = this.host.tabs.pageOf(tabId);
    if (!source) return;
    this.discard();
    const view = new WebContentsView({
      webPreferences: {
        session: source.session,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        allowRunningInsecureContent: false,
        spellcheck: true,
      },
    });
    view.setBorderRadius(PAGE_RADIUS);
    view.setBackgroundColor("#ffffff");
    this.view = view;
    this.manager = this.host.tabs;
    this.sourceId = tabId;
    this.requested = url;
    this.favicons = [];
    const contents = view.webContents;
    this.wire(contents);
    this.host.overlay.open({ kind: "link-peek", peek: this.state() });
    this.host.window.contentView.addChildView(view);
    this.host.overlay.setTopView(view);
    this.layout();
    contents.focus();
    void contents.loadURL(url).catch(() => {
      // A failed load shows Chromium's error page in the card; the header keeps the address.
    });
  }

  /** Places the card again (the page area changed: window resized, sidebar toggled…). */
  layout(): void {
    if (!this.view || this.host.window.isDestroyed()) return;
    this.view.setBounds(peekLayout(this.area()).page);
    this.push();
  }

  /** An action of the card's header (from the overlay layer). */
  act(action: PeekAction): void {
    if (action === "close") this.close();
    else this.promote(action === "open-split");
  }

  /** Closes the peek and its overlay card; focus goes back to the page below. */
  close(): void {
    if (!this.discard()) return;
    if (this.host.overlay.shown === "link-peek") this.host.overlay.close(true);
  }

  /**
   * "Ouvrir dans un onglet" / "Ouvrir en vue scindée": the live page becomes a tab next to its
   * source, without reloading (same session); otherwise the URL is opened again in a new tab.
   */
  private promote(split: boolean): void {
    const view = this.view;
    const manager = this.manager;
    if (!view || !manager) return;
    const index = this.sourceId ? manager.indexOf(this.sourceId) + 1 || undefined : undefined;
    const favicons = this.favicons;
    const requested = this.requested;
    this.detach();
    let id = manager.adoptPage(view, { activate: !split, index, favicons });
    if (!id) {
      if (!view.webContents.isDestroyed()) view.webContents.close();
      id = isPeekableUrl(requested) ? manager.create(requested, { activate: !split, index }) : null;
    }
    if (id && split) manager.openSplit(id);
    if (this.host.overlay.shown === "link-peek") this.host.overlay.close(false);
  }

  /** Removes the peek's view and destroys its page. Returns whether there was one. */
  private discard(): boolean {
    const view = this.view;
    if (!view) return false;
    this.detach();
    if (!view.webContents.isDestroyed()) view.webContents.close();
    return true;
  }

  /** Takes the view off the window and stops listening to its page (it is kept alive). */
  private detach(): void {
    const view = this.view;
    this.view = null;
    this.manager = null;
    this.sourceId = null;
    this.unlisten?.();
    this.unlisten = null;
    this.host.overlay.setTopView(null);
    if (view && !this.host.window.isDestroyed() && this.host.window.contentView.children.includes(view)) {
      this.host.window.contentView.removeChildView(view);
    }
  }

  private area() {
    return (this.manager ?? this.host.tabs).area;
  }

  private state(): PeekState {
    const contents = this.view && !this.view.webContents.isDestroyed() ? this.view.webContents : null;
    const url = contents?.getURL() || this.requested;
    const manager = this.manager ?? this.host.tabs;
    const split = manager.getState().split;
    return {
      url,
      title: contents?.getTitle() || displayUrl(url),
      isLoading: contents?.isLoading() ?? false,
      canSplit: !(manager.splitVisible && (split?.tabIds.length ?? 0) >= MAX_SPLIT_TABS),
      card: peekLayout(this.area()).card,
    };
  }

  private push(): void {
    if (this.view) this.host.overlay.send(Channels.peekState, this.state());
  }

  private wire(contents: WebContents): void {
    // Same rules as a tab's page: popup blocker, web schemes only, mail/phone links after a gesture.
    hardenWebContents(contents, {
      // A link the peeked page opens in a new tab (after a user gesture) becomes a real tab.
      openTab: (url, foreground) => {
        const manager = this.manager;
        if (!manager || !isPeekableUrl(url)) return;
        manager.create(url, { activate: foreground });
        if (foreground) this.close();
      },
      popupBlocked: () => {},
    });
    // Shields, HTTPS-Only and GPC come with the session; the card has no permission bar: denied.
    attachTabPrivacy(contents, {
      blocked: () => {},
      permissionChanged: (prompt) => {
        if (prompt) respondPermission(contents.id, prompt.id, false, false);
      },
    });
    const listeners: [string, (...args: never[]) => void][] = [];
    const on = (event: string, listener: (...args: never[]) => void) => {
      contents.on(event as "focus", listener as () => void);
      listeners.push([event, listener]);
    };
    this.unlisten = () => {
      if (contents.isDestroyed()) return;
      for (const [event, listener] of listeners) contents.off(event as "focus", listener as () => void);
    };
    const push = () => this.push();
    for (const event of ["did-navigate", "did-navigate-in-page", "page-title-updated", "did-start-loading", "did-stop-loading"]) on(event, push);
    on("page-favicon-updated", (_event: Electron.Event, favicons: string[]) => {
      this.favicons = favicons;
    });
    // Escape in the peeked page closes the peek (the page never sees that key press).
    on("before-input-event", (event: Electron.Event, input: Electron.Input) => {
      if (input.type === "keyDown" && input.key === "Escape" && !input.control && !input.meta && !input.alt && !input.shift) {
        event.preventDefault();
        this.close();
      }
    });
    // The page closed itself (window.close()).
    on("destroyed", () => {
      if (this.view?.webContents === contents) this.close();
    });
  }
}
