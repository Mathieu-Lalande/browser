import { randomUUID } from "node:crypto";
import { WebContentsView, type BaseWindow, type WebContents } from "electron";
import type { Bounds, BrowserState, TabId, TabState } from "@shared/types";
import { displayUrl, isNavigableUrl, normalizeInput } from "@shared/url";
import { hardenWebContents } from "./security";

const START_TITLE = "Nouvel onglet";
const CONTENT_RADIUS = 10;

interface Tab {
  id: TabId;
  view: WebContentsView;
  state: TabState;
}

/**
 * Owns the web pages of one window: each tab is a sandboxed WebContentsView that is
 * attached to the window only while it is the active tab.
 */
export class TabManager {
  private tabs: Tab[] = [];
  private activeId: TabId | null = null;
  private bounds: Bounds = { x: 0, y: 0, width: 0, height: 0 };
  private attached: WebContentsView | null = null;
  private emitScheduled = false;

  constructor(
    private readonly window: BaseWindow,
    private readonly onChange: (state: BrowserState) => void,
  ) {}

  getState(): BrowserState {
    return { tabs: this.tabs.map((tab) => ({ ...tab.state })), activeTabId: this.activeId };
  }

  create(input = "", options: { activate?: boolean; index?: number } = {}): TabId {
    const view = new WebContentsView({
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        allowRunningInsecureContent: false,
        spellcheck: true,
      },
    });
    view.setBorderRadius(CONTENT_RADIUS);
    view.setBackgroundColor("#ffffff");

    const tab: Tab = {
      id: randomUUID(),
      view,
      state: {
        id: "",
        url: "",
        title: START_TITLE,
        favicon: null,
        isLoading: false,
        canGoBack: false,
        canGoForward: false,
        isPinned: false,
      },
    };
    tab.state.id = tab.id;
    this.wire(tab);

    const index = options.index ?? this.tabs.length;
    this.tabs.splice(Math.max(0, Math.min(index, this.tabs.length)), 0, tab);
    if (options.activate ?? true) this.activate(tab.id);
    this.navigate(tab.id, input);
    this.emit();
    return tab.id;
  }

  close(id: TabId): void {
    const index = this.tabs.findIndex((tab) => tab.id === id);
    if (index === -1) return;
    const [tab] = this.tabs.splice(index, 1);
    if (this.activeId === id) {
      const next = this.tabs[Math.min(index, this.tabs.length - 1)];
      this.activeId = null;
      if (next) this.activate(next.id);
      else this.detach();
    }
    tab.view.webContents.close();
    if (this.tabs.length === 0) this.create();
    this.emit();
  }

  activate(id: TabId): void {
    const tab = this.find(id);
    if (!tab) return;
    this.activeId = id;
    this.syncAttachment();
    this.emit();
  }

  navigate(id: TabId, input: string): void {
    const tab = this.find(id);
    if (!tab) return;
    const url = normalizeInput(input);
    tab.state.url = url;
    if (!url) {
      tab.state.title = START_TITLE;
      tab.state.favicon = null;
      tab.state.isLoading = false;
      if (tab.view.webContents.getURL()) tab.view.webContents.loadURL("about:blank").catch(() => {});
    } else {
      tab.state.title = displayUrl(url);
      tab.view.webContents.loadURL(url).catch(() => {
        // Load failures are reported through did-fail-load.
      });
    }
    if (id === this.activeId) this.syncAttachment();
    this.emit();
  }

  back(id: TabId): void {
    this.find(id)?.view.webContents.navigationHistory.goBack();
  }

  forward(id: TabId): void {
    this.find(id)?.view.webContents.navigationHistory.goForward();
  }

  reload(id: TabId): void {
    const tab = this.find(id);
    if (tab?.state.url) tab.view.webContents.reload();
  }

  stop(id: TabId): void {
    this.find(id)?.view.webContents.stop();
  }

  togglePin(id: TabId): void {
    const tab = this.find(id);
    if (!tab) return;
    tab.state.isPinned = !tab.state.isPinned;
    // Pinned tabs always sit before unpinned ones.
    this.tabs.sort((a, b) => Number(b.state.isPinned) - Number(a.state.isPinned));
    this.emit();
  }

  move(id: TabId, toIndex: number): void {
    const from = this.tabs.findIndex((tab) => tab.id === id);
    if (from === -1) return;
    const [tab] = this.tabs.splice(from, 1);
    this.tabs.splice(Math.max(0, Math.min(toIndex, this.tabs.length)), 0, tab);
    this.emit();
  }

  /** Cycle through tabs in sidebar order (Ctrl+Tab / Ctrl+Shift+Tab). */
  cycle(direction: 1 | -1): void {
    if (this.tabs.length < 2 || !this.activeId) return;
    const index = this.tabs.findIndex((tab) => tab.id === this.activeId);
    const next = this.tabs[(index + direction + this.tabs.length) % this.tabs.length];
    this.activate(next.id);
  }

  activateIndex(index: number): void {
    const tab = index < 0 ? this.tabs.at(-1) : this.tabs[index];
    if (tab) this.activate(tab.id);
  }

  get activeTabId(): TabId | null {
    return this.activeId;
  }

  activeWebContents(): WebContents | null {
    const tab = this.activeId ? this.find(this.activeId) : undefined;
    return tab?.state.url ? tab.view.webContents : null;
  }

  setBounds(bounds: Bounds): void {
    this.bounds = {
      x: Math.round(bounds.x),
      y: Math.round(bounds.y),
      width: Math.max(0, Math.round(bounds.width)),
      height: Math.max(0, Math.round(bounds.height)),
    };
    this.attached?.setBounds(this.bounds);
  }

  destroy(): void {
    for (const tab of this.tabs) tab.view.webContents.close();
    this.tabs = [];
  }

  private find(id: TabId): Tab | undefined {
    return this.tabs.find((tab) => tab.id === id);
  }

  /** The active tab's view is attached unless it shows the start page (rendered by the chrome UI). */
  private syncAttachment(): void {
    const tab = this.activeId ? this.find(this.activeId) : undefined;
    const wanted = tab && tab.state.url ? tab.view : null;
    if (wanted === this.attached) return;
    this.detach();
    if (wanted) {
      this.window.contentView.addChildView(wanted);
      wanted.setBounds(this.bounds);
      this.attached = wanted;
    }
  }

  private detach(): void {
    if (this.attached) this.window.contentView.removeChildView(this.attached);
    this.attached = null;
  }

  private wire(tab: Tab): void {
    const contents = tab.view.webContents;
    hardenWebContents(contents, {
      openTab: (url, foreground) => {
        const index = this.tabs.indexOf(tab) + 1;
        this.create(url, { activate: foreground, index });
      },
    });

    const refresh = () => {
      const url = contents.getURL();
      if (url && url !== "about:blank") tab.state.url = url;
      tab.state.canGoBack = contents.navigationHistory.canGoBack();
      tab.state.canGoForward = contents.navigationHistory.canGoForward();
      this.emit();
    };

    contents.on("did-start-loading", () => {
      tab.state.isLoading = true;
      this.emit();
    });
    contents.on("did-stop-loading", () => {
      tab.state.isLoading = false;
      refresh();
    });
    contents.on("did-navigate", refresh);
    contents.on("did-navigate-in-page", refresh);
    contents.on("page-title-updated", (_event, title) => {
      tab.state.title = title || displayUrl(contents.getURL());
      this.emit();
    });
    contents.on("page-favicon-updated", (_event, favicons) => {
      tab.state.favicon = favicons.find(isNavigableUrl) ?? null;
      this.emit();
    });
    contents.on("did-fail-load", (_event, code, description, url, isMainFrame) => {
      // -3 is ERR_ABORTED: a navigation replaced by another one, not a real failure.
      if (!isMainFrame || code === -3) return;
      tab.state.title = `Erreur : ${displayUrl(url) || description}`;
      tab.state.isLoading = false;
      this.emit();
    });
  }

  /** Coalesce bursts of webContents events into one state push per tick. */
  private emit(): void {
    if (this.emitScheduled) return;
    this.emitScheduled = true;
    queueMicrotask(() => {
      this.emitScheduled = false;
      this.onChange(this.getState());
    });
  }
}
