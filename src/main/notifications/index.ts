import { randomBytes } from "node:crypto";
import { nativeImage, Notification, type WebContents } from "electron";
import { webHostname } from "@shared/hosts";
import { NotificationThrottle, notificationTitle, parseWebNotification, type WebNotification } from "@shared/notifications";
import { passwordOrigin } from "@shared/passwords";
import type { Settings } from "@shared/settings";
import type { TabId } from "@shared/types";
import type { WindowPort } from "../ports";
import type { ExtensionNotification } from "../extensions/api/host";

/** Isolated world of the notification relay (… 1014/1015 autofill, 1016 notifications). */
export const NOTIFY_WORLD_ID = 1016;

/** What was shown, for the e2e test hook (`BROWSER_TEST_NOTIFICATIONS`, unpackaged app only). */
export interface ShownNotification {
  site: string;
  title: string;
  body: string;
  hasIcon: boolean;
  tabId: TabId;
  /** Simulates a click on it (test hook). */
  click(): void;
}

export interface NotificationDeps {
  settings(): Settings;
  /** Whether `origin` was allowed notifications in that page's session (permission bar decisions). */
  allowed(contents: WebContents, origin: string): boolean;
  /** Test hook: every notification shown is also handed here (the OS may show nothing under xvfb). */
  record?(shown: ShownNotification): void;
  now?: () => number;
}

/**
 * Main-world part, installed in each document: `window.Notification` keeps the page-facing API
 * (`permission`, `requestPermission`, which go through the permission bar) but the constructor
 * hands the notification to the relay below instead of Chromium's own notifier, so main can show
 * it with the site's name and favicon, and bring the tab back on click. `token` is per document.
 * Service-worker notifications (`registration.showNotification`, Web Push) are not covered: see ADR-041.
 */
function shimScript(token: string): string {
  return `((token) => {
  const Native = window.Notification;
  if (!Native || Native.__browserShim) return;
  let seq = 0;
  const live = new Map();
  class Notification extends EventTarget {
    constructor(title, options = {}) {
      super();
      this.title = String(title);
      this.body = options && options.body ? String(options.body) : "";
      this.tag = options && options.tag ? String(options.tag) : "";
      this.icon = options && options.icon ? String(options.icon) : "";
      this.data = options ? options.data : undefined;
      this.onclick = null; this.onshow = null; this.onclose = null; this.onerror = null;
      const id = (++seq).toString(36) + Math.random().toString(36).slice(2, 8);
      this._id = id;
      if (Native.permission !== "granted") {
        setTimeout(() => this._fire("error"), 0);
        return;
      }
      live.set(id, this);
      document.dispatchEvent(new CustomEvent(token, { detail: JSON.stringify({ id, title: this.title, body: this.body, tag: this.tag, silent: !!(options && options.silent) }) }));
      setTimeout(() => this._fire("show"), 0);
    }
    _fire(type) {
      const event = new Event(type, { cancelable: type === "click" });
      const handler = this["on" + type];
      if (typeof handler === "function") handler.call(this, event);
      this.dispatchEvent(event);
    }
    close() { if (live.delete(this._id)) this._fire("close"); }
    static get permission() { return Native.permission; }
    static requestPermission(callback) { return Native.requestPermission(callback); }
    static get maxActions() { return 0; }
  }
  Object.defineProperty(Notification, "__browserShim", { value: true });
  document.addEventListener(token + ":click", (event) => {
    const target = live.get(String(event.detail));
    if (target) target._fire("click");
  });
  window.Notification = Notification;
})(${JSON.stringify(token)}); true`;
}

/** Isolated-world relay: resolves with the next notification's JSON text, null when the page goes away. */
function relayScript(token: string): string {
  return `(() => {
  const state = (globalThis.__browserNotify ??= { waiters: [], queue: [], token: null });
  if (state.token !== ${JSON.stringify(token)}) {
    state.token = ${JSON.stringify(token)};
    document.addEventListener(state.token, (event) => {
      const detail = typeof event.detail === "string" ? event.detail : null;
      if (!detail) return;
      if (state.waiters.length) { const waiters = state.waiters; state.waiters = []; for (const resolve of waiters) resolve(detail); }
      else if (state.queue.length < 20) state.queue.push(detail);
    });
    window.addEventListener("pagehide", () => { const waiters = state.waiters; state.waiters = []; for (const resolve of waiters) resolve(null); }, true);
  }
  return new Promise((resolve) => { if (state.queue.length) resolve(state.queue.shift()); else state.waiters.push(resolve); });
})()`;
}

/**
 * Web notifications (ADR-041): pages' notifications shown natively, titled with the site and
 * carrying its favicon; a click brings the window and the tab forward. Permission is the
 * permission bar's (per site, also listed in the site info popover); "Ne pas déranger" drops
 * them silently. Private windows get them too (their permission decisions live in memory).
 */
export class NotificationCenter {
  private readonly throttle = new NotificationThrottle();
  /** Shown notifications, kept so they are not collected (their click handler would be lost). */
  private readonly shown = new Map<string, Notification>();
  private readonly tokens = new WeakMap<WebContents, string>();

  constructor(private readonly deps: NotificationDeps) {}

  /** A new document of a tab (dom-ready): the shim and its relay go in. */
  watch(c: WindowPort, tabId: TabId, contents: WebContents): void {
    if (!passwordOrigin(contents.getURL())) return;
    const token = `__browser_notify_${randomBytes(9).toString("hex")}`;
    this.tokens.set(contents, token);
    contents.executeJavaScript(shimScript(token)).catch(() => undefined);
    void (async () => {
      while (!contents.isDestroyed() && this.tokens.get(contents) === token) {
        let detail: unknown;
        try {
          detail = await contents.executeJavaScriptInIsolatedWorld(NOTIFY_WORLD_ID, [{ code: relayScript(token) }]);
        } catch {
          return;
        }
        if (detail === null) return;
        const notification = parseWebNotification(detail);
        if (notification) this.show(c, tabId, contents, notification);
      }
    })();
  }

  private show(c: WindowPort, tabId: TabId, contents: WebContents, notification: WebNotification): void {
    if (contents.isDestroyed() || c.window.isDestroyed()) return;
    const origin = passwordOrigin(contents.getURL());
    if (!origin || !this.deps.allowed(contents, origin)) return;
    if (this.deps.settings().notifications.doNotDisturb) return;
    const site = webHostname(origin) ?? origin;
    if (!this.throttle.take(site, (this.deps.now ?? Date.now)())) return;
    const favicon = c.tabs.getState().tabs.find((tab) => tab.id === tabId)?.favicon ?? null;
    const icon = favicon?.startsWith("data:image/") ? nativeImage.createFromDataURL(favicon) : undefined;
    const key = `${site}\n${notification.tag || notification.id}`;
    const click = () => this.clicked(c, tabId, contents, notification.id);
    this.deps.record?.({ site, title: notification.title, body: notification.body, hasIcon: !!icon && !icon.isEmpty(), tabId, click });
    if (!Notification.isSupported()) return;
    this.shown.get(key)?.close();
    const native = new Notification({ title: notificationTitle(site, notification.title), body: notification.body, icon, silent: notification.silent });
    native.on("click", click);
    native.on("close", () => {
      if (this.shown.get(key) === native) this.shown.delete(key);
    });
    this.shown.set(key, native);
    native.show();
  }

  /** The notification was clicked: window and tab forward, then the page hears the click. */
  private clicked(c: WindowPort, tabId: TabId, contents: WebContents, id: string): void {
    if (c.window.isDestroyed()) return;
    if (c.window.isMinimized()) c.window.restore();
    c.window.show();
    c.window.focus();
    if (c.tabs.getState().tabs.some((tab) => tab.id === tabId)) c.tabs.activate(tabId);
    const token = this.tokens.get(contents);
    if (!token || contents.isDestroyed()) return;
    const code = `document.dispatchEvent(new CustomEvent(${JSON.stringify(`${token}:click`)}, { detail: ${JSON.stringify(id)} }))`;
    contents.executeJavaScriptInIsolatedWorld(NOTIFY_WORLD_ID, [{ code }]).catch(() => undefined);
  }

  /**
   * A notification of an extension (`chrome.notifications`, ADR-053): named after the extension,
   * "Ne pas déranger" applies; clicks and closes go back to the extension.
   */
  showExtension(notification: ExtensionNotification): void {
    if (this.deps.settings().notifications.doNotDisturb) return;
    if (!this.throttle.take(notification.source, (this.deps.now ?? Date.now)())) return;
    const icon = notification.icon ? nativeImage.createFromDataURL(notification.icon) : undefined;
    this.deps.record?.({ site: notification.source, title: notification.title, body: notification.body, hasIcon: !!icon && !icon.isEmpty(), tabId: "", click: notification.onClick });
    if (!Notification.isSupported()) return;
    const key = `extension\n${notification.key}`;
    this.shown.get(key)?.close();
    const native = new Notification({ title: notificationTitle(notification.source, notification.title), body: notification.body, icon, silent: notification.silent });
    native.on("click", notification.onClick);
    native.on("close", () => {
      if (this.shown.get(key) === native) this.shown.delete(key);
      notification.onClose();
    });
    this.shown.set(key, native);
    native.show();
  }

  /** Closes an extension's notification; false when it was not shown. */
  clearExtension(key: string): boolean {
    const native = this.shown.get(`extension\n${key}`);
    if (!native) return false;
    this.shown.delete(`extension\n${key}`);
    // Cleared by the extension: no onClosed back to it.
    native.removeAllListeners("close");
    native.close();
    return true;
  }

  dispose(): void {
    for (const native of this.shown.values()) native.close();
    this.shown.clear();
  }
}
