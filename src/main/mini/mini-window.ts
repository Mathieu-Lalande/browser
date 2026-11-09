import { BaseWindow, WebContentsView, type Session, type WebContents } from "electron";
import { Channels } from "@shared/ipc";
import { MINI_PAGE_RADIUS, MINI_SIZE, miniLayout, miniShortcut, type MiniAction, type MiniState } from "@shared/mini";
import type { Settings } from "@shared/settings";
import type { ResolvedMode } from "@shared/theme";
import { isPageOpenableUrl } from "@shared/url";
import { attachTabPrivacy, respondPermission } from "../privacy";
import { TAB_WEB_PREFERENCES, hardenWebContents } from "../security";

/** What a mini window needs from the app (injected: no import of the browser windows). */
export interface MiniHost {
  /** The browser UIs' session (ADR-024): the bar's. */
  uiSession(): Session;
  /** The session of the default space's tabs: the page's, so that it can become a tab without reloading. */
  pageSession(): Session;
  /** `app://browser/mini.html` (or the dev server). */
  barUrl(): string;
  preload: string;
  settings(): Settings;
  mode(): ResolvedMode;
  /** The theme's window background. */
  background(): string;
  isMac: boolean;
  /** Copies the page's address. */
  copy(text: string): void;
  /** Makes the live page a tab of the last normal window (or reopens `url` there). */
  promote(view: WebContentsView, url: string, favicons: string[]): void;
  /** A link the page opens in a new tab (after a gesture): a tab of the last normal window. */
  openTab(url: string): void;
  /** The window is gone (closed, or its page promoted). */
  closed(mini: MiniWindow): void;
}

/**
 * One mini window (ADR-048): frameless, its bar (a browser UI page, `mini.html`) on top and the web
 * page below, hardened like a tab's (sandbox, no preload, popup blocker, shields) in the default
 * space's session. Nothing is recorded (history, session) unless it becomes a tab; closing it
 * discards the page.
 */
export class MiniWindow {
  readonly window: BaseWindow;
  readonly bar: WebContentsView;
  private page: WebContentsView | null;
  private favicons: string[] = [];
  private requested: string;
  /** Removes this window's listeners from the page (it lives on as a tab once promoted). */
  private unlistenPage: () => void = () => {};

  constructor(
    url: string,
    private readonly host: MiniHost,
  ) {
    this.requested = url;
    this.window = new BaseWindow({
      width: MINI_SIZE.width,
      height: MINI_SIZE.height,
      minWidth: MINI_SIZE.minWidth,
      minHeight: MINI_SIZE.minHeight,
      frame: false,
      roundedCorners: true,
      backgroundColor: host.background(),
      title: "Browser — Mini-fenêtre",
      show: false,
    });
    this.bar = new WebContentsView({
      webPreferences: {
        preload: host.preload,
        session: host.uiSession(),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        spellcheck: false,
      },
    });
    this.bar.setBackgroundColor(host.background());
    this.page = new WebContentsView({ webPreferences: { ...TAB_WEB_PREFERENCES, session: host.pageSession() } });
    this.page.setBorderRadius(MINI_PAGE_RADIUS);
    this.page.setBackgroundColor("#ffffff");
    this.window.contentView.addChildView(this.bar);
    this.window.contentView.addChildView(this.page);
    this.layout();
    this.window.on("resize", () => this.layout());
    this.window.on("closed", () => this.dispose());
    this.wireBar(this.bar.webContents);
    this.wirePage(this.page.webContents);
    void this.bar.webContents.loadURL(host.barUrl());
    this.bar.webContents.once("did-finish-load", () => {
      if (this.window.isDestroyed()) return;
      this.push();
      this.window.show();
      this.page?.webContents.focus();
    });
    void this.page.webContents.loadURL(url).catch(() => {
      // A failed load shows Chromium's error page; the bar keeps the address.
    });
  }

  /** The page shown (null once promoted or closed). */
  get pageContents(): WebContents | null {
    return this.page && !this.page.webContents.isDestroyed() ? this.page.webContents : null;
  }

  act(action: MiniAction): void {
    switch (action) {
      case "copy":
        this.host.copy(this.pageContents?.getURL() || this.requested);
        break;
      case "promote":
        this.promote();
        break;
      case "close":
        this.close();
        break;
      case "pin":
        this.window.setAlwaysOnTop(!this.window.isAlwaysOnTop());
        this.push();
        break;
      case "reload":
        this.pageContents?.reload();
        break;
    }
  }

  /** Settings or OS theme changed: the bar follows. */
  refresh(): void {
    if (this.window.isDestroyed()) return;
    this.window.setBackgroundColor(this.host.background());
    this.bar.setBackgroundColor(this.host.background());
    this.push();
  }

  close(): void {
    if (!this.window.isDestroyed()) this.window.close();
  }

  focus(): void {
    if (this.window.isDestroyed()) return;
    if (this.window.isMinimized()) this.window.restore();
    this.window.show();
    this.window.focus();
  }

  /** "Ouvrir dans le navigateur": the live page moves to a tab, then this window goes. */
  private promote(): void {
    const view = this.page;
    if (!view) return;
    const url = view.webContents.isDestroyed() ? this.requested : view.webContents.getURL() || this.requested;
    this.page = null;
    this.unlistenPage();
    if (!this.window.isDestroyed()) this.window.contentView.removeChildView(view);
    this.host.promote(view, url, this.favicons);
    this.close();
  }

  private layout(): void {
    if (this.window.isDestroyed()) return;
    const { width, height } = this.window.getContentBounds();
    const { bar, page } = miniLayout(width, height);
    this.bar.setBounds(bar);
    this.page?.setBounds(page);
  }

  private state(): MiniState {
    const contents = this.pageContents;
    const url = contents?.getURL() || this.requested;
    let host = url;
    let secure = false;
    try {
      const parsed = new URL(url);
      host = parsed.hostname.replace(/^www\./, "");
      secure = parsed.protocol === "https:";
    } catch {
      // Not a URL yet: shown as typed.
    }
    return {
      url,
      title: contents?.getTitle() || host,
      host,
      secure,
      isLoading: contents?.isLoading() ?? false,
      alwaysOnTop: !this.window.isDestroyed() && this.window.isAlwaysOnTop(),
      settings: this.host.settings(),
      mode: this.host.mode(),
    };
  }

  private push(): void {
    if (!this.bar.webContents.isDestroyed()) this.bar.webContents.send(Channels.miniState, this.state());
  }

  /** Ctrl+O / Ctrl+W, from the bar or the page. */
  private readonly onKey = (event: Electron.Event, input: Electron.Input): void => {
    const action = miniShortcut(input, this.host.isMac);
    if (!action) return;
    event.preventDefault();
    this.act(action);
  };

  private wireBar(contents: WebContents): void {
    contents.on("before-input-event", this.onKey);
    // The bar never navigates nor opens anything.
    contents.on("will-navigate", (event) => event.preventDefault());
    contents.setWindowOpenHandler(() => ({ action: "deny" }));
  }

  private wirePage(contents: WebContents): void {
    hardenWebContents(contents, {
      openTab: (url) => {
        if (isPageOpenableUrl(url)) this.host.openTab(url);
      },
      popupBlocked: () => {},
    });
    // Shields, HTTPS-Only and GPC come with the session; no permission bar here: denied.
    attachTabPrivacy(contents, {
      blocked: () => {},
      permissionChanged: (prompt) => {
        if (prompt) respondPermission(contents.id, prompt.id, false, false);
      },
    });
    const push = () => this.push();
    const events = ["did-navigate", "did-navigate-in-page", "page-title-updated", "did-start-loading", "did-stop-loading"] as const;
    const onFavicons = (_event: Electron.Event, favicons: string[]) => {
      this.favicons = favicons;
    };
    // The page closed itself (window.close()): the window goes too.
    const onDestroyed = () => {
      if (this.page?.webContents === contents) {
        this.page = null;
        this.close();
      }
    };
    contents.on("before-input-event", this.onKey);
    for (const event of events) contents.on(event as "did-stop-loading", push);
    contents.on("page-favicon-updated", onFavicons);
    contents.on("destroyed", onDestroyed);
    this.unlistenPage = () => {
      if (contents.isDestroyed()) return;
      contents.off("before-input-event", this.onKey);
      for (const event of events) contents.off(event as "did-stop-loading", push);
      contents.off("page-favicon-updated", onFavicons);
      contents.off("destroyed", onDestroyed);
    };
  }

  private dispose(): void {
    const page = this.page;
    this.page = null;
    if (page && !page.webContents.isDestroyed()) page.webContents.close();
    if (!this.bar.webContents.isDestroyed()) this.bar.webContents.close();
    this.host.closed(this);
  }
}
