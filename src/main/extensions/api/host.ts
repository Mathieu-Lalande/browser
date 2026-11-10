import { randomUUID } from "node:crypto";
import type { IpcMain, IpcMainEvent, IpcMainInvokeEvent, IpcMainServiceWorkerEvent, IpcMainServiceWorkerInvokeEvent, ServiceWorkerMain, Session, WebContents } from "electron";
import { EXTENSION_CHANNELS } from "@shared/extension-bridge";
import {
  afterMenuClick,
  canReadTab,
  extensionMenuEntries,
  manifestTabAccess,
  menuClickInfo,
  redactTab,
  tabChange,
  type ActionState,
  type ExtensionMenuEntry,
  type FullTab,
  type MenuItem,
  type MenuTarget,
} from "@shared/extension-api";
import type { TabId } from "@shared/types";
import type { SessionOptions, SessionService } from "../../services";
import type { ExtensionService, LoadedExtension } from "../service";
import { API, type ApiContext } from "./apis";
import type { BrowserTab, ExtensionBrowser } from "./ports";

/** A notification an extension shows (`chrome.notifications`), handed to the `NotificationCenter`. */
export interface ExtensionNotification {
  key: string;
  /** The extension's name (where a site's would be). */
  source: string;
  title: string;
  body: string;
  /** `data:` image. */
  icon: string | null;
  silent: boolean;
  onClick(): void;
  onClose(): void;
}

export interface ExtensionApiDeps {
  extensions: Pick<ExtensionService, "loaded" | "placesOf" | "running" | "onChanged">;
  /** The extension-context preload (`out/preload/extension-api.cjs`). */
  preloadPath: string;
  notify(notification: ExtensionNotification): void;
  /** Closes a notification shown by `notify`; false when there was none. */
  clearNotification(key: string): boolean;
}

/** Who calls: an extension page (popup, options, tab) or its background service worker. */
export interface Caller {
  extension: LoadedExtension;
  session: Session;
  /** The page, for a frame (null for the service worker). */
  contents: WebContents | null;
}

/** Contexts listening to events: frames (popups, extension pages) and service workers (woken up for them). */
interface FrameListeners {
  session: Session;
  electronId: string;
  events: Set<string>;
}

const ORIGIN = /^chrome-extension:\/\/([a-p]{32})\//;
const MAX_ARGS = 8;
const DEBOUNCE_MS = 30;
/** Synthetic tab ids (a tab never seen with a page) start here, far above webContents ids. */
const FIRST_SYNTHETIC_ID = 1_000_000;

const NEW_TAB_URL = "chrome://newtab/";

/**
 * The `chrome.*` APIs Electron lacks (ADR-053): `tabs` (create, remove, update, query, events),
 * `windows`, `action` (badges, title, icon, popup, onClicked), `contextMenus` (merged into the page
 * menu), `notifications`, `commands`, `permissions`. A session service: each tab session gets the
 * extension-context preload (frames and service workers; it does nothing outside
 * `chrome-extension:`) before any extension loads. Every call is checked here: the sender must be
 * an extension context (`chrome-extension://<id>/` frame or service worker scope) of an installed,
 * enabled extension loaded in that session; arguments are validated by each API (`./apis.ts`).
 */
export class ExtensionApiHost implements SessionService {
  private browser: ExtensionBrowser | null = null;
  private readonly sessions = new Set<Session>();
  private readonly workers = new WeakSet<ServiceWorkerMain>();
  /** Events service workers listen to, per session and Electron id (kept while they sleep: they are woken for them). */
  private readonly workerEvents = new Map<Session, Map<string, Set<string>>>();
  private readonly frames = new Map<WebContents, FrameListeners>();
  /** Our tab key ↔ the number extensions see (the page's webContents id when it had one). */
  private readonly tabIds = new Map<TabId, number>();
  private readonly tabKeys = new Map<number, TabId>();
  private nextSynthetic = FIRST_SYNTHETIC_ID;
  /** The last tabs snapshot, for the tab events. */
  private snapshot: Map<TabId, FullTab> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** `activeTab` grants: extension id → tabs (until the tab navigates or closes). */
  private readonly grants = new Map<string, Set<TabId>>();
  /** Toolbar button states (`chrome.action`), by extension id. */
  readonly actions = new Map<string, ActionState>();
  /** Context menu items (`chrome.contextMenus`), by extension id, in creation order. */
  readonly menus = new Map<string, MenuItem[]>();
  /** Notifications shown, by extension id. */
  readonly notifications = new Map<string, Set<string>>();

  constructor(readonly deps: ExtensionApiDeps) {
    deps.extensions.onChanged(() => this.prune());
  }

  /** Plugs in the windows (at startup, once they can be created) and listens to extension frames. */
  connect(browser: ExtensionBrowser, ipc: Pick<IpcMain, "handle" | "on">): void {
    this.browser = browser;
    browser.onChange(() => this.scheduleDiff());
    ipc.handle(EXTENSION_CHANNELS.call, (event, ...args) => this.callFromFrame(event, args));
    ipc.on(EXTENSION_CHANNELS.listen, (event, name) => this.listenFromFrame(event, name));
  }

  install(ses: Session, options: SessionOptions = {}): void {
    // No extension runs in a private window (ADR-049): nothing to bridge there.
    if (options.ephemeral || this.sessions.has(ses)) return;
    this.sessions.add(ses);
    // Before any extension loads. The preload returns at once outside `chrome-extension:` (web pages, their workers).
    ses.registerPreloadScript({ id: "browser-extension-api-frame", type: "frame", filePath: this.deps.preloadPath });
    ses.registerPreloadScript({ id: "browser-extension-api-worker", type: "service-worker", filePath: this.deps.preloadPath });
    ses.serviceWorkers.on("running-status-changed", ({ versionId, runningStatus }) => {
      if (runningStatus !== "starting" && runningStatus !== "running") return;
      const worker = ses.serviceWorkers.getWorkerFromVersionID(versionId);
      if (worker && ORIGIN.test(worker.scope)) this.attachWorker(worker);
    });
  }

  release(ses: Session): void {
    this.sessions.delete(ses);
    this.workerEvents.delete(ses);
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
  }

  // -------------------------------------------------------------------------------------------
  // Transport and sender checks
  // -------------------------------------------------------------------------------------------

  private attachWorker(worker: ServiceWorkerMain): void {
    if (this.workers.has(worker)) return;
    this.workers.add(worker);
    worker.ipc.handle(EXTENSION_CHANNELS.call, (event, ...args) => this.callFromWorker(event, args));
    worker.ipc.on(EXTENSION_CHANNELS.listen, (event, name) => this.listenFromWorker(event, name));
  }

  /** The extension of a frame sender, or null (a web page, the browser UI, a disabled extension…). */
  private frameCaller(event: IpcMainEvent | IpcMainInvokeEvent): Caller | null {
    const url = event.senderFrame?.url ?? "";
    const electronId = ORIGIN.exec(url)?.[1];
    if (!electronId || event.sender.isDestroyed()) return null;
    const extension = this.deps.extensions.loaded(event.sender.session, electronId);
    return extension ? { extension, session: event.sender.session, contents: event.sender } : null;
  }

  private workerCaller(event: IpcMainServiceWorkerEvent | IpcMainServiceWorkerInvokeEvent): Caller | null {
    const electronId = ORIGIN.exec(event.serviceWorker.scope)?.[1];
    if (!electronId) return null;
    const extension = this.deps.extensions.loaded(event.session, electronId);
    return extension ? { extension, session: event.session, contents: null } : null;
  }

  private callFromFrame(event: IpcMainInvokeEvent, args: unknown[]): Promise<unknown> {
    return this.call(this.frameCaller(event), args);
  }

  private callFromWorker(event: IpcMainServiceWorkerInvokeEvent, args: unknown[]): Promise<unknown> {
    return this.call(this.workerCaller(event), args);
  }

  private async call(caller: Caller | null, [namespace, method, args]: unknown[]): Promise<unknown> {
    if (!caller || !this.browser) throw new Error("Extension API unavailable");
    const run = typeof namespace === "string" && typeof method === "string" ? API[`${namespace}.${method}`] : undefined;
    if (!run || !Array.isArray(args) || args.length > MAX_ARGS) throw new Error(`Unsupported call: ${String(namespace)}.${String(method)}`);
    return run(this.context(caller), args);
  }

  private listenFromFrame(event: IpcMainEvent, name: unknown): void {
    const caller = this.frameCaller(event);
    if (!caller?.contents || typeof name !== "string" || name.length > 64) return;
    const contents = caller.contents;
    let entry = this.frames.get(contents);
    if (!entry) {
      entry = { session: caller.session, electronId: caller.extension.electronId, events: new Set() };
      this.frames.set(contents, entry);
      contents.once("destroyed", () => this.frames.delete(contents));
      // A frame navigating elsewhere loses its listeners (its next document listens again).
      contents.on("did-start-navigation", (details) => {
        if (details.isMainFrame && !details.isSameDocument) this.frames.delete(contents);
      });
    }
    entry.events.add(name);
  }

  private listenFromWorker(event: IpcMainServiceWorkerEvent, name: unknown): void {
    const caller = this.workerCaller(event);
    if (!caller || typeof name !== "string" || name.length > 64) return;
    let bySession = this.workerEvents.get(caller.session);
    if (!bySession) this.workerEvents.set(caller.session, (bySession = new Map()));
    let events = bySession.get(caller.extension.electronId);
    if (!events) bySession.set(caller.extension.electronId, (events = new Set()));
    events.add(name);
  }

  /**
   * Sends an event to the contexts listening to it: the extension's frames, and its service workers
   * (started if asleep, as Chrome wakes them). `argsFor` gives each extension its arguments (null: none).
   * `only`: that extension alone.
   */
  dispatch(event: string, argsFor: (extension: LoadedExtension) => unknown[] | null, only?: string): void {
    for (const [session, byId] of this.workerEvents) {
      for (const [electronId, events] of byId) {
        if (!events.has(event)) continue;
        const extension = this.deps.extensions.loaded(session, electronId);
        if (!extension || (only && extension.id !== only)) continue;
        const args = argsFor(extension);
        if (!args) continue;
        session.serviceWorkers
          .startWorkerForScope(`chrome-extension://${electronId}/`)
          .then((worker) => worker.send(EXTENSION_CHANNELS.event, event, args))
          .catch(() => undefined);
      }
    }
    for (const [contents, entry] of this.frames) {
      if (!entry.events.has(event) || contents.isDestroyed()) continue;
      const extension = this.deps.extensions.loaded(entry.session, entry.electronId);
      if (!extension || (only && extension.id !== only)) continue;
      const args = argsFor(extension);
      if (args) contents.send(EXTENSION_CHANNELS.event, event, args);
    }
  }

  private listening(prefix: string): boolean {
    for (const byId of this.workerEvents.values()) for (const events of byId.values()) for (const event of events) if (event.startsWith(prefix)) return true;
    for (const entry of this.frames.values()) for (const event of entry.events) if (event.startsWith(prefix)) return true;
    return false;
  }

  // -------------------------------------------------------------------------------------------
  // Tabs and windows as extensions see them
  // -------------------------------------------------------------------------------------------

  private context(caller: Caller): ApiContext {
    const browser = this.browser as ExtensionBrowser;
    return { host: this, browser, caller, currentWindow: (caller.contents && browser.windowOf(caller.contents)) ?? browser.lastFocusedWindow() };
  }

  /** The number extensions know a tab by (stable for the tab's life). */
  idOf(tab: BrowserTab): number {
    let id = this.tabIds.get(tab.key);
    if (id === undefined) {
      id = tab.contents && !this.tabKeys.has(tab.contents.id) ? tab.contents.id : this.nextSynthetic++;
      this.tabIds.set(tab.key, id);
      this.tabKeys.set(id, tab.key);
    }
    return id;
  }

  keyOf(id: number): TabId | null {
    return this.tabKeys.get(id) ?? null;
  }

  fullTab(tab: BrowserTab): FullTab {
    return {
      id: this.idOf(tab),
      index: tab.index,
      windowId: tab.windowId,
      active: tab.active,
      highlighted: tab.active,
      selected: tab.active,
      pinned: tab.pinned,
      incognito: false,
      discarded: tab.discarded,
      autoDiscardable: true,
      groupId: -1,
      status: tab.loading ? "loading" : tab.discarded ? "unloaded" : "complete",
      url: tab.url || NEW_TAB_URL,
      title: tab.title,
      ...(tab.favicon ? { favIconUrl: tab.favicon } : {}),
    };
  }

  /** Whether an extension may read a tab's URL and title (`tabs`, host permissions, or an `activeTab` grant). */
  readable(extension: LoadedExtension, key: TabId, url: string): boolean {
    const access = manifestTabAccess(extension.manifest);
    const granted = access.activeTab && !!this.grants.get(extension.id)?.has(key);
    return canReadTab({ tabs: access.tabs, hosts: access.hosts, activeTab: granted }, url);
  }

  /** The tab as `extension` may see it. */
  tabFor(extension: LoadedExtension, tab: BrowserTab) {
    const full = this.fullTab(tab);
    return redactTab(full, this.readable(extension, tab.key, full.url));
  }

  /** `activeTab` (a click on the extension's button or menu item): the tab becomes readable until it navigates. */
  grant(extensionId: string, key: TabId): void {
    let tabs = this.grants.get(extensionId);
    if (!tabs) this.grants.set(extensionId, (tabs = new Set()));
    tabs.add(key);
  }

  private scheduleDiff(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.diff();
    }, DEBOUNCE_MS);
  }

  /** Tab events (created, updated, activated, removed) from two snapshots; grants and per-tab states follow. */
  private diff(): void {
    if (!this.browser) return;
    const tabs = this.browser.tabs();
    const next = new Map(tabs.map((tab) => [tab.key, this.fullTab(tab)] as const));
    const before = this.snapshot;
    this.snapshot = next;
    if (!before) return;
    const byKey = new Map(tabs.map((tab) => [tab.key, tab] as const));
    const events = this.listening("tabs.");
    for (const [key, tab] of next) {
      const old = before.get(key);
      const live = byKey.get(key) as BrowserTab;
      if (!old) {
        if (events) this.dispatch("tabs.onCreated", (extension) => [this.tabFor(extension, live)]);
        continue;
      }
      if (old.url !== tab.url) for (const granted of this.grants.values()) granted.delete(key);
      if (events) {
        this.dispatch("tabs.onUpdated", (extension) => {
          const readable = this.readable(extension, key, tab.url);
          const change = tabChange(old, tab, readable);
          return change ? [tab.id, change, redactTab(tab, readable)] : null;
        });
        if (tab.active && !old.active) this.dispatch("tabs.onActivated", () => [{ tabId: tab.id, windowId: tab.windowId }]);
      }
    }
    let actionsChanged = false;
    for (const [key, old] of before) {
      if (next.has(key)) continue;
      const windowGone = ![...next.values()].some((tab) => tab.windowId === old.windowId);
      if (events) this.dispatch("tabs.onRemoved", () => [old.id, { windowId: old.windowId, isWindowClosing: windowGone }]);
      for (const granted of this.grants.values()) granted.delete(key);
      for (const state of this.actions.values()) {
        if (key in state.tabs) {
          delete state.tabs[key];
          actionsChanged = true;
        }
      }
      this.tabIds.delete(key);
      this.tabKeys.delete(old.id);
    }
    if (actionsChanged) this.pushActions();
  }

  // -------------------------------------------------------------------------------------------
  // Toolbar buttons, context menus, notifications
  // -------------------------------------------------------------------------------------------

  pushActions(): void {
    this.browser?.pushActionStates(this.actionStates());
  }

  actionStates(): Record<string, ActionState> {
    return Object.fromEntries(this.actions);
  }

  /**
   * A click on an extension's button without a popup (ADR-053): `activeTab` for the window's active
   * tab, then `action.onClicked` (also `browserAction.onClicked`, the same event in MV2).
   */
  clickAction(extensionId: string, windowId: number): void {
    const tab = this.browser?.tabs().find((item) => item.windowId === windowId && item.active);
    if (!tab) return;
    this.grant(extensionId, tab.key);
    this.dispatch("action.onClicked", (extension) => [this.tabFor(extension, tab)], extensionId);
  }

  /** The popup a click opens for a tab: a path set by `action.setPopup` ("" = none), or undefined (the manifest's). */
  popupFor(extensionId: string, key: TabId | null): string | undefined {
    const state = this.actions.get(extensionId);
    return (key ? state?.tabs[key]?.popup : undefined) ?? state?.global.popup;
  }

  /** Whether `action.disable` turned the button off for that tab. */
  actionEnabled(extensionId: string, key: TabId | null): boolean {
    const state = this.actions.get(extensionId);
    return ((key ? state?.tabs[key]?.enabled : undefined) ?? state?.global.enabled) !== false;
  }

  /** The page menu's extension entries for a right click in `session` (extensions loaded there). */
  menuEntries(session: Session, target: MenuTarget): ExtensionMenuEntry[] {
    const groups = [...this.menus]
      .filter(([id, items]) => items.length && this.deps.extensions.placesOf(id).some((place) => place.session === session))
      .flatMap(([id, items]) => {
        const extension = this.deps.extensions.running(id);
        return extension ? [{ extensionId: id, name: extension.name, icon: extension.icon, items }] : [];
      });
    return extensionMenuEntries(groups, target);
  }

  /** An extension's menu item was clicked on a tab's page: checked states, `activeTab`, then `contextMenus.onClicked`. */
  menuClicked(extensionId: string, itemId: string, target: MenuTarget, key: TabId): void {
    const items = this.menus.get(extensionId);
    const item = items?.find((entry) => entry.id === itemId);
    if (!items || !item) return;
    this.menus.set(extensionId, afterMenuClick(items, itemId));
    this.grant(extensionId, key);
    const tab = this.browser?.tabs().find((entry) => entry.key === key);
    const info = menuClickInfo(item, target, item.checked);
    this.dispatch("contextMenus.onClicked", (extension) => [info, tab ? this.tabFor(extension, tab) : undefined], extensionId);
  }

  /** A notification of an extension, shown by the notification center; its clicks and closes come back as events. */
  showNotification(extension: LoadedExtension, id: string, content: Omit<ExtensionNotification, "key" | "source" | "onClick" | "onClose">): void {
    let shown = this.notifications.get(extension.id);
    if (!shown) this.notifications.set(extension.id, (shown = new Set()));
    shown.add(id);
    this.deps.notify({
      ...content,
      key: `${extension.id}\n${id}`,
      source: extension.name,
      onClick: () => this.dispatch("notifications.onClicked", () => [id], extension.id),
      onClose: () => {
        this.notifications.get(extension.id)?.delete(id);
        this.dispatch("notifications.onClosed", () => [id, true], extension.id);
      },
    });
  }

  clearNotification(extension: LoadedExtension, id: string): boolean {
    this.notifications.get(extension.id)?.delete(id);
    return this.deps.clearNotification(`${extension.id}\n${id}`);
  }

  /** A generated id (`notifications.create` without one). */
  newId(): string {
    return randomUUID();
  }

  /** An extension went away (disabled, removed, updated): its menus, button state and grants go too. */
  private prune(): void {
    let changed = false;
    for (const id of new Set([...this.actions.keys(), ...this.menus.keys(), ...this.grants.keys()])) {
      if (this.deps.extensions.running(id)) continue;
      if (this.actions.delete(id)) changed = true;
      this.menus.delete(id);
      this.grants.delete(id);
    }
    if (changed) this.pushActions();
  }
}
