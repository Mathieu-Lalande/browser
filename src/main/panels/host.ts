import { t } from "@shared/i18n";
import { Menu, session, WebContentsView, type BaseWindow, type BrowserWindow, type WebContents } from "electron";
import { MAX_PANEL_FAVICON, panelBadge, panelPartition, panelToToggle, panelZoomFactor, type PanelsState, type WebPanel } from "@shared/panels";
import type { Bounds } from "@shared/types";
import { fetchImageDataUrl } from "../favicons";
import { mobileUserAgent } from "../fingerprint";
import { attachTabPrivacy, faviconRequestUrl, respondPermission } from "../privacy";
import { hardenSession, hardenWebContents } from "../security";
import type { PanelService } from "./service";

/** Corner radius of a panel's page, like a tab's card. */
const PAGE_RADIUS = 8;

/** What a window's panels need from it (a BrowserController). */
export interface PanelHostDeps {
  readonly window: BaseWindow;
  readonly isPrivate: boolean;
  readonly overlay: { readonly isOpen: boolean; raise(): void };
  readonly service: PanelService;
  /** A link the panel's page opens in a new tab (after a user gesture). */
  openTab(url: string, foreground: boolean): void;
  /** The panels' state changed: the window re-sends its state to its UIs. */
  refresh(): void;
}

interface LivePanel {
  view: WebContentsView;
  /** The URL and user agent the page was created with (a change reloads it). */
  mobile: boolean;
  badge: number | null;
  /** The zoom factor applied (ADR-059), re-applied after each load. */
  zoomFactor: number;
  unlisten: () => void;
}

/**
 * The web panels of one window (ADR-047). Each panel's page is a WebContentsView hardened like a
 * tab's (sandbox, no preload, popup blocker, shields) in the panel's own persistent partition,
 * created the first time it is opened and kept running in the background afterwards (messages,
 * music, the unread count in its title), until the window closes or the panel is removed. The
 * chrome UI draws the panel's frame beside the page and reports where its page goes (`setBounds`);
 * one panel is shown at a time. A private window has no panels (nothing of it touches them).
 */
export class PanelHost {
  private readonly live = new Map<string, LivePanel>();
  private openId: string | null = null;
  private lastId: string | null = null;
  private bounds: Bounds | null = null;
  private attached: WebContentsView | null = null;

  constructor(private readonly deps: PanelHostDeps) {}

  /** What the sidebar and the panel frame draw; null in a private window. */
  state(): PanelsState | null {
    if (this.deps.isPrivate) return null;
    return {
      openId: this.openId,
      panels: this.deps.service.list().map((panel) => {
        const live = this.live.get(panel.id);
        const contents = live && !live.view.webContents.isDestroyed() ? live.view.webContents : null;
        return {
          ...panel,
          badge: live?.badge ?? null,
          loaded: !!live,
          canGoBack: contents?.navigationHistory.canGoBack() ?? false,
          audible: contents?.isCurrentlyAudible() ?? false,
          zoomFactor: live?.zoomFactor ?? panelZoomFactor(panel.zoom, panel.width, panel.mobile),
        };
      }),
    };
  }

  /** Shows a panel (another one shown is hidden, its page keeps running), or hides it if shown. */
  toggle(id?: string): void {
    if (this.deps.isPrivate) return;
    if (id === undefined) {
      const { open } = panelToToggle(this.deps.service.list(), this.openId, this.lastId);
      return open ? this.open(open) : this.close();
    }
    if (this.openId === id) this.close();
    else this.open(id);
  }

  open(id: string): void {
    const panel = this.deps.service.find(id);
    if (this.deps.isPrivate || !panel || this.deps.window.isDestroyed()) return;
    this.openId = id;
    this.lastId = id;
    const live = this.live.get(id) ?? this.create(panel);
    this.layout();
    if (!live.view.webContents.isDestroyed()) live.view.webContents.focus();
    this.deps.refresh();
  }

  close(): void {
    if (!this.openId) return;
    this.openId = null;
    this.layout();
    this.deps.refresh();
  }

  /** Where the chrome UI's panel frame puts the page (window coordinates); null: no room for it. */
  setBounds(bounds: Bounds | null): void {
    this.bounds = bounds && bounds.width > 0 && bounds.height > 0 ? bounds : null;
    this.layout();
    // "Ajuster" follows the panel's width (ADR-059).
    if (this.openId && this.bounds) this.applyZoom(this.openId);
  }

  back(id: string): void {
    const contents = this.contentsOf(id);
    if (contents?.navigationHistory.canGoBack()) contents.navigationHistory.goBack();
  }

  /** Opens the panel's current page in a tab of the window (the panel keeps its own session). */
  openInTab(id: string): void {
    const contents = this.contentsOf(id);
    const url = contents?.getURL() || this.deps.service.find(id)?.url;
    if (url) this.deps.openTab(url, true);
  }

  /** Unloads the panel's page to free memory (it reloads when shown again); the shown one is hidden. */
  sleep(id: string): void {
    if (this.openId === id) this.openId = null;
    this.discard(id);
    this.layout();
    this.deps.refresh();
  }

  private contentsOf(id: string): WebContents | null {
    const contents = this.live.get(id)?.view.webContents;
    return contents && !contents.isDestroyed() ? contents : null;
  }

  /** Applies the panel's zoom (a percentage, or "fit" at the width it is shown at). */
  private applyZoom(id: string): void {
    const live = this.live.get(id);
    const panel = this.deps.service.find(id);
    const contents = this.contentsOf(id);
    if (!live || !panel || !contents) return;
    const width = this.openId === id && this.bounds ? this.bounds.width : panel.width;
    const factor = panelZoomFactor(panel.zoom, width, panel.mobile);
    if (contents.getZoomFactor() !== factor) contents.setZoomFactor(factor);
    if (factor !== live.zoomFactor) {
      live.zoomFactor = factor;
      this.deps.refresh();
    }
  }

  reload(id: string): void {
    const live = this.live.get(id);
    if (live && !live.view.webContents.isDestroyed()) live.view.webContents.reload();
  }

  /** Back to the panel's own page (its "home"). */
  home(id: string): void {
    const live = this.live.get(id);
    const panel = this.deps.service.find(id);
    if (live && panel && !live.view.webContents.isDestroyed()) void live.view.webContents.loadURL(panel.url).catch(() => {});
  }

  /** Native menu of a panel's icon: reload, its home page, mobile version, move, remove. */
  contextMenu(id: string): void {
    const { service } = this.deps;
    const index = service.list().findIndex((panel) => panel.id === id);
    const panel = service.list()[index];
    if (!panel || this.deps.isPrivate) return;
    const loaded = this.live.has(id);
    Menu.buildFromTemplate([
      { label: this.openId === id ? t("panelsHost.hidePanel") : t("panelsHost.showPanel"), click: () => this.toggle(id) },
      { label: t("panelsHost.reload"), enabled: loaded, click: () => this.reload(id) },
      { label: t("panelsHost.backPanelsPage"), enabled: loaded, click: () => this.home(id) },
      { label: t("panelsHost.mobileSite"), type: "checkbox", checked: panel.mobile, click: () => service.update(id, { mobile: !panel.mobile }) },
      { label: t("panelsHost.muted"), type: "checkbox", checked: panel.muted, click: () => service.update(id, { muted: !panel.muted }) },
      { label: t("panelsHost.openInTab"), enabled: loaded, click: () => this.openInTab(id) },
      { label: t("panelsHost.sleep"), enabled: loaded, click: () => this.sleep(id) },
      { type: "separator" },
      { label: t("panelsHost.moveUp"), enabled: index > 0, click: () => service.move(id, index - 1) },
      { label: t("panelsHost.moveDown"), enabled: index < service.list().length - 1, click: () => service.move(id, index + 1) },
      { type: "separator" },
      { label: t("panelsHost.removePanel"), click: () => service.remove(id) },
    ]).popup({ window: this.deps.window as BrowserWindow });
  }

  /** The panel list changed (added, removed, edited, synced): drops removed pages, applies the mobile switch. */
  sync(): void {
    const panels = new Map(this.deps.service.list().map((panel) => [panel.id, panel]));
    for (const [id, live] of this.live) {
      const panel = panels.get(id);
      if (!panel) this.discard(id);
      else {
        if (panel.mobile !== live.mobile) {
          live.mobile = panel.mobile;
          this.applyUserAgent(live.view.webContents, panel.mobile);
          live.view.webContents.reload();
        }
        if (!live.view.webContents.isDestroyed()) live.view.webContents.setAudioMuted(panel.muted);
        this.applyZoom(id);
      }
    }
    if (this.openId && !panels.has(this.openId)) this.openId = null;
    this.layout();
  }

  destroy(): void {
    for (const id of [...this.live.keys()]) this.discard(id);
    this.openId = null;
  }

  private create(panel: WebPanel): LivePanel {
    const ses = hardenSession(session.fromPartition(panelPartition(panel.id)));
    const view = new WebContentsView({
      webPreferences: {
        session: ses,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        nodeIntegrationInSubFrames: false,
        webSecurity: true,
        allowRunningInsecureContent: false,
        spellcheck: true,
      },
    });
    view.setBorderRadius(PAGE_RADIUS);
    view.setBackgroundColor("#ffffff");
    const contents = view.webContents;
    this.applyUserAgent(contents, panel.mobile);
    contents.setAudioMuted(panel.muted);
    const live: LivePanel = { view, mobile: panel.mobile, badge: null, zoomFactor: 1, unlisten: () => {} };
    live.unlisten = this.wire(panel.id, contents, live);
    this.live.set(panel.id, live);
    void contents.loadURL(panel.url).catch(() => {
      // A failed load shows Chromium's error page in the panel.
    });
    return live;
  }

  private applyUserAgent(contents: WebContents, mobile: boolean): void {
    const base = contents.session.getUserAgent();
    contents.setUserAgent(mobile ? mobileUserAgent(base) : base);
  }

  private wire(id: string, contents: WebContents, live: LivePanel): () => void {
    // Same rules as a tab's page: popup blocker, web schemes only; new windows become tabs.
    hardenWebContents(contents, {
      openTab: (url, foreground) => this.deps.openTab(url, foreground),
      popupBlocked: () => {},
    });
    // Shields, HTTPS-Only and GPC come with the session; a panel has no permission bar: denied.
    attachTabPrivacy(contents, {
      blocked: () => {},
      permissionChanged: (prompt) => {
        if (prompt) respondPermission(contents.id, prompt.id, false, false);
      },
    });
    const onTitle = (_event: Electron.Event, title: string) => {
      const badge = panelBadge(title);
      if (badge === live.badge) return;
      live.badge = badge;
      this.deps.refresh();
    };
    const onFavicons = (_event: Electron.Event, favicons: string[]) => void this.saveFavicon(id, contents, favicons[0]);
    // Chromium resets the zoom of a new document to the origin's: the panel's own wins.
    const onLoaded = () => this.applyZoom(id);
    // The back button and the sound indicator of the frame follow the page.
    const onChanged = () => this.deps.refresh();
    const onGone = () => {
      if (this.live.get(id) === live) this.discard(id);
      this.deps.refresh();
    };
    contents.on("page-title-updated", onTitle);
    contents.on("page-favicon-updated", onFavicons);
    contents.on("render-process-gone", onGone);
    contents.on("did-finish-load", onLoaded);
    contents.on("did-navigate", onChanged);
    contents.on("did-navigate-in-page", onChanged);
    contents.on("audio-state-changed", onChanged);
    return () => {
      if (contents.isDestroyed()) return;
      contents.off("did-finish-load", onLoaded);
      contents.off("did-navigate", onChanged);
      contents.off("did-navigate-in-page", onChanged);
      contents.off("audio-state-changed", onChanged);
      contents.off("page-title-updated", onTitle);
      contents.off("page-favicon-updated", onFavicons);
      contents.off("render-process-gone", onGone);
    };
  }

  /** The first favicon the page declares, fetched as `data:` by main (ADR-018), kept once. */
  private async saveFavicon(id: string, contents: WebContents, url: string | undefined): Promise<void> {
    if (!url || this.deps.service.find(id)?.favicon) return;
    const allowed = faviconRequestUrl(contents, url, contents.getURL());
    const favicon = allowed ? await fetchImageDataUrl(contents.session, allowed, MAX_PANEL_FAVICON).catch(() => null) : null;
    if (favicon && !this.deps.service.find(id)?.favicon) this.deps.service.update(id, { favicon });
  }

  /** Attaches the open panel's page at its bounds (or nothing), keeping the overlay above it. */
  private layout(): void {
    if (this.deps.window.isDestroyed()) return;
    const wanted = this.openId && this.bounds ? (this.live.get(this.openId)?.view ?? null) : null;
    const children = this.deps.window.contentView.children;
    if (this.attached && this.attached !== wanted && children.includes(this.attached)) this.deps.window.contentView.removeChildView(this.attached);
    if (wanted && this.bounds) {
      if (!children.includes(wanted)) {
        this.deps.window.contentView.addChildView(wanted);
        if (this.deps.overlay.isOpen) this.deps.overlay.raise();
      }
      wanted.setBounds(this.bounds);
    }
    this.attached = wanted;
  }

  private discard(id: string): void {
    const live = this.live.get(id);
    if (!live) return;
    this.live.delete(id);
    live.unlisten();
    if (this.attached === live.view) {
      if (!this.deps.window.isDestroyed() && this.deps.window.contentView.children.includes(live.view)) this.deps.window.contentView.removeChildView(live.view);
      this.attached = null;
    }
    if (!live.view.webContents.isDestroyed()) live.view.webContents.close();
  }
}
