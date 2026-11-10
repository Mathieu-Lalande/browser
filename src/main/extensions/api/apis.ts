import { readFileSync, statSync } from "node:fs";
import { extname, resolve, sep } from "node:path";
import { nativeImage } from "electron";
import {
  badgeColor,
  createMenuItem,
  manifestCommands,
  manifestPermissions,
  matchesTabQuery,
  MAX_BADGE_LENGTH,
  menuItemFrom,
  resolveAction,
  withDescendants,
  type ActionProps,
  type ActionState,
  type TabQuery,
} from "@shared/extension-api";
import { isPageOpenableUrl } from "@shared/url";
import type { TabId } from "@shared/types";
import type { Caller, ExtensionApiHost } from "./host";
import type { BrowserTab, BrowserWindowInfo, ExtensionBrowser } from "./ports";

/** What an API call gets: the host (state, events), the windows, the checked caller and its window. */
export interface ApiContext {
  host: ExtensionApiHost;
  browser: ExtensionBrowser;
  caller: Caller;
  /** The caller's window (a popup's, an extension tab's), else the last focused one. */
  currentWindow: number | null;
}

type Api = (context: ApiContext, args: unknown[]) => unknown;

const IMAGE_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};
const MAX_IMAGE_FILE = 512 * 1024;
const MAX_IMAGE_SIDE = 256;
const MAX_TEXT = 1000;

const fail = (message: string): never => {
  throw new Error(message);
};

const record = (value: unknown): Record<string, unknown> => (typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {});
const optionalNumber = (value: unknown): number | undefined => (typeof value === "number" && Number.isInteger(value) ? value : undefined);
const text = (value: unknown, max = MAX_TEXT): string => (typeof value === "string" ? value.slice(0, max) : "");

/** A file of the extension (no way out of its folder) as a `data:` image, or null. */
export function extensionImage(root: string, path: string): string | null {
  const type = IMAGE_TYPES[extname(path).toLowerCase()];
  if (!type) return null;
  const base = resolve(root);
  const file = resolve(base, path.replace(/^\/+/, ""));
  if (!file.startsWith(base + sep)) return null;
  try {
    if (statSync(file).size > MAX_IMAGE_FILE) return null;
    return `data:${type};base64,${readFileSync(file).toString("base64")}`;
  } catch {
    return null;
  }
}

/** `{ width, height, data: number[] }` (an ImageData the preload flattened, RGBA) as a PNG `data:` URL. */
function imageDataUrl(value: unknown): string | null {
  const { width, height, data } = record(value);
  if (typeof width !== "number" || typeof height !== "number" || !Array.isArray(data)) return null;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > MAX_IMAGE_SIDE || height > MAX_IMAGE_SIDE) return null;
  if (data.length !== width * height * 4) return null;
  // nativeImage takes BGRA.
  const bgra = Buffer.alloc(data.length);
  for (let i = 0; i < data.length; i += 4) {
    bgra[i] = Number(data[i + 2]) & 255;
    bgra[i + 1] = Number(data[i + 1]) & 255;
    bgra[i + 2] = Number(data[i]) & 255;
    bgra[i + 3] = Number(data[i + 3]) & 255;
  }
  const image = nativeImage.createFromBitmap(bgra, { width, height });
  return image.isEmpty() ? null : image.toDataURL();
}

/** An image an extension names: a path in its folder or a `data:` image. */
function imageFrom(context: ApiContext, value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  if (/^data:image\/(png|jpeg|gif|webp);base64,/i.test(value) && value.length < MAX_IMAGE_FILE * 2) return value;
  const own = `chrome-extension://${context.caller.extension.electronId}/`;
  const path = value.startsWith(own) ? value.slice(own.length) : value;
  return /^[a-z][a-z0-9+.-]*:/i.test(path) ? null : extensionImage(context.caller.extension.root, decodeURI(path.split(/[?#]/)[0]));
}

/**
 * A URL an extension opens: relative ones resolve against its own origin. Allowed: web pages
 * (`isPageOpenableUrl`) and the extension's own pages; never `file:`, `javascript:`, `browser:` or
 * another extension. Absent: the start page.
 */
function openableUrl(context: ApiContext, value: unknown): { url: string; extensionPage: boolean } {
  if (value === undefined || value === null || value === "") return { url: "", extensionPage: false };
  if (typeof value !== "string" || value.length > 8192) return fail("Invalid url");
  const origin = `chrome-extension://${context.caller.extension.electronId}/`;
  let url: URL;
  try {
    url = new URL(value, origin);
  } catch {
    return fail(`Invalid url: "${value}"`);
  }
  if (url.protocol === "chrome-extension:") {
    if (url.origin !== new URL(origin).origin) return fail("Cannot open another extension's page");
    return { url: url.href, extensionPage: true };
  }
  if (url.href === "chrome://newtab/" || url.href === "about:newtab") return { url: "", extensionPage: false };
  if (!isPageOpenableUrl(url.href)) return fail(`Cannot navigate to ${url.protocol} URLs`);
  return { url: url.href, extensionPage: false };
}

const tabsOf = (context: ApiContext): BrowserTab[] => context.browser.tabs();

function tabById(context: ApiContext, value: unknown): BrowserTab {
  const id = optionalNumber(value);
  const key = id === undefined ? null : context.host.keyOf(id);
  const tab = key ? tabsOf(context).find((item) => item.key === key) : undefined;
  if (!tab) {
    // A tab never handed out yet (a webContents id the extension got from `sender.tab`): look it up.
    const live = id === undefined ? undefined : tabsOf(context).find((item) => context.host.idOf(item) === id);
    return live ?? fail(`No tab with id: ${String(value)}.`);
  }
  return tab;
}

const activeTabOf = (context: ApiContext, windowId: number | null) =>
  tabsOf(context).find((tab) => tab.active && tab.windowId === windowId) ?? tabsOf(context).find((tab) => tab.active);

const tabInfo = (context: ApiContext, tab: BrowserTab) => context.host.tabFor(context.caller.extension, tab);

function windowInfo(context: ApiContext, window: BrowserWindowInfo, populate: boolean) {
  return {
    id: window.id,
    focused: window.focused,
    top: window.bounds.y,
    left: window.bounds.x,
    width: window.bounds.width,
    height: window.bounds.height,
    incognito: false,
    type: "normal",
    state: window.state,
    alwaysOnTop: false,
    ...(populate ? { tabs: tabsOf(context).filter((tab) => tab.windowId === window.id).map((tab) => tabInfo(context, tab)) } : {}),
  };
}

function windowById(context: ApiContext, value: unknown): BrowserWindowInfo {
  const id = value === -2 ? context.currentWindow : optionalNumber(value);
  return context.browser.windows().find((window) => window.id === id) ?? fail(`No window with id: ${String(value)}.`);
}

const populateOf = (value: unknown) => record(value).populate === true;

/** After an action, the tab as it now is (the windows act synchronously). */
const tabNow = (context: ApiContext, key: TabId | null) => {
  const tab = key ? tabsOf(context).find((item) => item.key === key) : undefined;
  return tab ? tabInfo(context, tab) : undefined;
};

// --- chrome.action ---------------------------------------------------------------------------

function actionTarget(context: ApiContext, details: unknown): { state: ActionState; key: TabId | null } {
  const { id } = context.caller.extension;
  let state = context.host.actions.get(id);
  if (!state) context.host.actions.set(id, (state = { global: {}, tabs: {} }));
  const tabId = record(details).tabId;
  return { state, key: tabId === undefined || tabId === null ? null : tabById(context, tabId).key };
}

function setAction(context: ApiContext, details: unknown, patch: ActionProps): void {
  const { state, key } = actionTarget(context, details);
  if (key) state.tabs[key] = { ...state.tabs[key], ...patch };
  else state.global = { ...state.global, ...patch };
  context.host.pushActions();
}

function getAction(context: ApiContext, details: unknown): ActionProps {
  const { state, key } = actionTarget(context, details);
  return resolveAction(state, key);
}

const manifestAction = (context: ApiContext) => {
  const manifest = context.caller.extension.manifest;
  return record(manifest.action ?? manifest.browser_action ?? manifest.page_action);
};

const COLOR_DEFAULT = [0, 0, 0, 0];

function parseColor(value: unknown): number[] {
  if (Array.isArray(value)) return value as number[];
  const css = typeof value === "string" ? value : "";
  const hex = /^#([0-9a-f]{6})$/i.exec(css)?.[1];
  return hex ? [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16), 255] : COLOR_DEFAULT;
}

const action: Record<string, Api> = {
  setBadgeText: (context, [details]) => setAction(context, details, { badgeText: text(record(details).text, MAX_BADGE_LENGTH) }),
  getBadgeText: (context, [details]) => getAction(context, details).badgeText ?? "",
  setBadgeBackgroundColor: (context, [details]) =>
    setAction(context, details, { badgeColor: badgeColor(record(details).color) ?? fail("Invalid color") }),
  getBadgeBackgroundColor: (context, [details]) => parseColor(getAction(context, details).badgeColor),
  setBadgeTextColor: (context, [details]) => setAction(context, details, { badgeTextColor: badgeColor(record(details).color) ?? fail("Invalid color") }),
  getBadgeTextColor: (context, [details]) => parseColor(getAction(context, details).badgeTextColor),
  setTitle: (context, [details]) => setAction(context, details, { title: text(record(details).title, 200) }),
  getTitle: (context, [details]) => getAction(context, details).title ?? text(manifestAction(context).default_title, 200),
  setIcon: (context, [details]) => {
    const { imageData, path } = record(details);
    const icon = imageData !== undefined ? imageDataUrl(imageData) : imageFrom(context, path);
    setAction(context, details, { icon: icon ?? fail("Could not load the icon") });
  },
  setPopup: (context, [details]) => setAction(context, details, { popup: text(record(details).popup, 500) }),
  getPopup: (context, [details]) => {
    const popup = getAction(context, details).popup ?? text(manifestAction(context).default_popup, 500);
    return popup ? new URL(popup, `chrome-extension://${context.caller.extension.electronId}/`).href : "";
  },
  enable: (context, [tabId]) => setAction(context, tabId === undefined ? {} : { tabId }, { enabled: true }),
  disable: (context, [tabId]) => setAction(context, tabId === undefined ? {} : { tabId }, { enabled: false }),
  isEnabled: (context, [tabId]) => getAction(context, tabId === undefined ? {} : { tabId }).enabled !== false,
  getUserSettings: () => ({ isOnToolbar: true }),
  openPopup: () => fail("action.openPopup is not supported"),
};

// --- chrome.contextMenus ---------------------------------------------------------------------

const menuItems = (context: ApiContext) => context.host.menus.get(context.caller.extension.id) ?? [];

// Every change goes through `host.setMenus`, which keeps them for the next run (ADR-054).
const contextMenus: Record<string, Api> = {
  create: (context, [props]) => {
    const { id } = context.caller.extension;
    const created = createMenuItem(menuItems(context), props, context.host.restoredMenuIds(id));
    if (typeof created === "string") return fail(created);
    context.host.setMenus(id, created.items, created.id);
    return created.id;
  },
  update: (context, [id, props]) => {
    const items = [...menuItems(context)];
    const index = items.findIndex((item) => item.id === String(id));
    if (index < 0) return fail(`Cannot find menu item with id ${String(id)}`);
    const item = menuItemFrom(props, items, items[index]);
    if (typeof item === "string") return fail(item);
    items[index] = item;
    context.host.setMenus(context.caller.extension.id, items);
  },
  remove: (context, [id]) => {
    const items = menuItems(context);
    if (!items.some((item) => item.id === String(id))) return fail(`Cannot find menu item with id ${String(id)}`);
    const gone = withDescendants(items, String(id));
    context.host.setMenus(context.caller.extension.id, items.filter((item) => !gone.has(item.id)));
  },
  removeAll: (context) => {
    context.host.setMenus(context.caller.extension.id, []);
  },
};

// --- chrome.tabs -----------------------------------------------------------------------------

const tabs: Record<string, Api> = {
  get: (context, [id]) => tabInfo(context, tabById(context, id)),
  getCurrent: (context) => {
    const key = context.caller.contents ? context.browser.tabOf(context.caller.contents) : null;
    return tabNow(context, key);
  },
  query: (context, [query]) => {
    const extension = context.caller.extension;
    const windows = { current: context.currentWindow, lastFocused: context.browser.lastFocusedWindow() };
    return tabsOf(context)
      .filter((tab) => {
        const full = context.host.fullTab(tab);
        return matchesTabQuery(full, record(query) as TabQuery, windows, context.host.readable(extension, tab.key, full.url));
      })
      .map((tab) => tabInfo(context, tab));
  },
  create: (context, [props]) => {
    const p = record(props);
    const { url, extensionPage } = openableUrl(context, p.url);
    const windowId = p.windowId === undefined ? context.currentWindow : windowById(context, p.windowId).id;
    const key = context.browser.createTab(windowId, url, { active: p.active !== false && p.selected !== false, index: optionalNumber(p.index), extensionPage });
    return key ? tabNow(context, key) : fail("Could not create the tab");
  },
  update: (context, args) => {
    const [first, second] = args;
    const hasId = typeof first === "number";
    const tab = hasId ? tabById(context, first) : (activeTabOf(context, context.currentWindow) ?? fail("No current tab"));
    const p = record(hasId || first === undefined || first === null ? second : first);
    if (p.url !== undefined) {
      const { url, extensionPage } = openableUrl(context, p.url);
      context.browser.navigateTab(tab.key, url, extensionPage);
    }
    if (p.active === true || p.highlighted === true || p.selected === true) context.browser.activateTab(tab.key);
    return tabNow(context, tab.key);
  },
  remove: (context, [ids]) => {
    const list = Array.isArray(ids) ? ids : [ids];
    const keys = list.map((id) => tabById(context, id).key);
    for (const key of keys) context.browser.closeTab(key);
  },
};

// --- chrome.windows --------------------------------------------------------------------------

const windows: Record<string, Api> = {
  getAll: (context, [options]) => context.browser.windows().map((window) => windowInfo(context, window, populateOf(options))),
  get: (context, [id, options]) => windowInfo(context, windowById(context, id), populateOf(options)),
  getCurrent: (context, [options]) => windowInfo(context, windowById(context, -2), populateOf(options)),
  getLastFocused: (context, [options]) => windowInfo(context, windowById(context, context.browser.lastFocusedWindow()), populateOf(options)),
  create: (context, [data]) => {
    const p = record(data);
    if (p.incognito === true) return fail("Private windows cannot be opened by extensions");
    const urls = (Array.isArray(p.url) ? p.url : p.url === undefined ? [] : [p.url]).slice(0, 20).map((url) => openableUrl(context, url));
    const first = urls[0];
    const id = context.browser.createWindow(first?.url ?? null, first?.extensionPage ?? false, p.focused !== false);
    if (id === null) return fail("Could not create the window");
    for (const extra of urls.slice(1)) context.browser.createTab(id, extra.url, { active: false, extensionPage: extra.extensionPage });
    return windowInfo(context, windowById(context, id), true);
  },
  update: (context, [id, info]) => {
    const window = windowById(context, id);
    if (record(info).focused === true || record(info).drawAttention === true) context.browser.focusWindow(window.id);
    return windowInfo(context, windowById(context, window.id), false);
  },
  remove: (context, [id]) => {
    context.browser.closeWindow(windowById(context, id).id);
  },
};

// --- chrome.notifications, chrome.commands, chrome.permissions --------------------------------

const notifications: Record<string, Api> = {
  create: (context, [id, options]) => {
    const p = record(options);
    const notificationId = typeof id === "string" && id ? id.slice(0, 500) : context.host.newId();
    const title = text(p.title, 200);
    if (!title && !text(p.message)) return fail("Some of the required properties are missing: title and message");
    context.host.showNotification(context.caller.extension, notificationId, {
      title,
      body: [text(p.message), text(p.contextMessage, 200)].filter(Boolean).join("\n"),
      icon: imageFrom(context, p.iconUrl),
      silent: p.silent === true,
    });
    return notificationId;
  },
  update: (context, [id, options]) => {
    if (typeof id !== "string" || !context.host.notifications.get(context.caller.extension.id)?.has(id)) return false;
    notifications.create(context, [id, options]);
    return true;
  },
  clear: (context, [id]) => (typeof id === "string" ? context.host.clearNotification(context.caller.extension, id) : false),
  getAll: (context) => Object.fromEntries([...(context.host.notifications.get(context.caller.extension.id) ?? [])].map((id) => [id, true])),
  getPermissionLevel: () => "granted",
};

const commands: Record<string, Api> = {
  getAll: (context) => manifestCommands(context.caller.extension.manifest, context.host.shortcutsOf(context.caller.extension.id)),
};

function containsPermissions(context: ApiContext, wanted: unknown): boolean {
  const granted = manifestPermissions(context.caller.extension.manifest);
  const p = record(wanted);
  const permissions = Array.isArray(p.permissions) ? p.permissions : [];
  const origins = Array.isArray(p.origins) ? p.origins : [];
  return permissions.every((item) => granted.permissions.includes(String(item))) && origins.every((item) => granted.origins.includes(String(item)));
}

const permissions: Record<string, Api> = {
  getAll: (context) => manifestPermissions(context.caller.extension.manifest),
  contains: (context, [wanted]) => containsPermissions(context, wanted),
  // Optional permissions are never granted (ADR-049): a request succeeds only for what the manifest already has.
  request: (context, [wanted]) => containsPermissions(context, wanted),
  remove: () => false,
};

const namespaces: Record<string, Record<string, Api>> = { action, contextMenus, tabs, windows, notifications, commands, permissions };

/** Every call the bridge accepts, by `namespace.method`. */
export const API: Readonly<Record<string, Api>> = Object.freeze(
  Object.fromEntries(Object.entries(namespaces).flatMap(([namespace, methods]) => Object.entries(methods).map(([method, run]) => [`${namespace}.${method}`, run]))),
);
