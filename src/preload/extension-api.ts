import { contextBridge, ipcRenderer } from "electron";
import { EXTENSION_CHANNELS } from "@shared/extension-bridge";

/**
 * The extension-context preload (ADR-053). Registered on tab sessions for frames and service
 * workers, so Chromium runs it for every document and worker of those sessions — web pages
 * included. It therefore does **nothing** unless the context is an extension's
 * (`chrome-extension:`): no global, no listener, no IPC. There, it completes `chrome.*` with the
 * APIs Electron lacks (tabs, windows, action, contextMenus, notifications, commands, permissions),
 * each a call to main, which checks the sender again (an installed, enabled extension).
 *
 * Bundles nothing but `@shared/extension-bridge`: a sandboxed preload cannot load shared chunks.
 */

type Bridge = {
  call(namespace: string, method: string, args: unknown[]): Promise<unknown>;
  listen(event: string): void;
  onEvent(callback: (event: string, args: unknown[]) => void): void;
};

/**
 * Runs in the extension's main world (serialized by `executeInMainWorld`: self-contained, it may
 * use nothing from this module). Adds the missing namespaces and methods to `chrome`, keeping
 * Electron's own (`tabs.sendMessage`, `runtime`, `storage`…).
 */
function installApis(bridge: Bridge, manifestVersion: number): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g = globalThis as any;
  const chrome = g.chrome;
  if (!chrome || g.__browserExtensionApis) return;
  Object.defineProperty(g, "__browserExtensionApis", { value: true });

  type Listener = (...args: unknown[]) => unknown;
  const listeners = new Map<string, Set<Listener>>();
  /** `menus.create({ onclick })` (MV2): kept here, functions do not cross to main. */
  const menuClicks = new Map<string, Listener>();
  bridge.onEvent((name, args) => {
    if (name === "contextMenus.onClicked") {
      const info = args[0] as { menuItemId?: unknown } | undefined;
      const onclick = menuClicks.get(String(info?.menuItemId));
      if (onclick) onclick(...args);
    }
    for (const listener of [...(listeners.get(name) ?? [])]) {
      try {
        listener(...args);
      } catch (error) {
        console.error(error);
      }
    }
  });
  const event = (name: string) => ({
    addListener(listener: Listener) {
      if (typeof listener !== "function") return;
      let set = listeners.get(name);
      if (!set) {
        listeners.set(name, (set = new Set()));
        bridge.listen(name);
      }
      set.add(listener);
    },
    removeListener(listener: Listener) {
      listeners.get(name)?.delete(listener);
    },
    hasListener(listener: Listener) {
      return !!listeners.get(name)?.has(listener);
    },
    hasListeners() {
      return (listeners.get(name)?.size ?? 0) > 0;
    },
  });
  const clean = (error: unknown) => new Error(String((error as Error)?.message ?? error).replace(/^Error invoking remote method '[^']*': (Error: )?/, ""));
  /** A method with Chrome's two styles: a trailing callback, or a promise. */
  const method =
    (namespace: string, name: string, prepare?: (args: unknown[]) => unknown[]) =>
    (...args: unknown[]) => {
      const callback = typeof args[args.length - 1] === "function" ? (args.pop() as Listener) : null;
      while (args.length && args[args.length - 1] === undefined) args.pop();
      const promise = Promise.resolve()
        .then(() => bridge.call(namespace, name, prepare ? prepare(args) : args))
        .catch((error) => {
          throw clean(error);
        });
      if (!callback) return promise;
      promise.then(
        (result) => callback(result),
        (error) => {
          console.error(`chrome.${namespace}.${name}: ${error.message}`);
          callback(undefined);
        },
      );
      return undefined;
    };
  const largest = (value: Record<string, unknown>) =>
    value[Object.keys(value).sort((a, b) => Number(b) - Number(a))[0] as string];
  /** `setIcon`: ImageData (or a dict of them) flattened, the largest path of a dict. */
  const iconArgs = (args: unknown[]) => {
    const details = { ...(args[0] as Record<string, unknown>) };
    let image = details.imageData as Record<string, unknown> | undefined;
    if (image && !("data" in image)) image = largest(image) as Record<string, unknown>;
    if (image) details.imageData = { width: image.width, height: image.height, data: Array.from(image.data as ArrayLike<number>) };
    if (details.path && typeof details.path === "object") details.path = largest(details.path as Record<string, unknown>);
    return [details];
  };
  const define = (name: string, api: Record<string, unknown>) => {
    const base = chrome[name];
    const merged = Object.assign({}, base, api);
    try {
      Object.defineProperty(chrome, name, { value: merged, enumerable: true, configurable: true, writable: true });
    } catch {
      // Electron's namespace cannot be replaced: complete it in place.
      if (base) for (const key of Object.keys(api)) if (!(key in base)) base[key] = api[key];
    }
    return chrome[name];
  };
  const calls = (namespace: string, names: string[]) => Object.fromEntries(names.map((name) => [name, method(namespace, name)]));

  define("tabs", {
    ...calls("tabs", ["get", "getCurrent", "query", "create", "update", "remove"]),
    onCreated: event("tabs.onCreated"),
    onUpdated: event("tabs.onUpdated"),
    onActivated: event("tabs.onActivated"),
    onRemoved: event("tabs.onRemoved"),
    TAB_ID_NONE: -1,
  });
  define("windows", {
    ...calls("windows", ["get", "getAll", "getCurrent", "getLastFocused", "create", "update", "remove"]),
    onCreated: event("windows.onCreated"),
    onRemoved: event("windows.onRemoved"),
    onFocusChanged: event("windows.onFocusChanged"),
    WINDOW_ID_NONE: -1,
    WINDOW_ID_CURRENT: -2,
  });
  const action = define("action", {
    ...calls("action", [
      "setBadgeText",
      "getBadgeText",
      "setBadgeBackgroundColor",
      "getBadgeBackgroundColor",
      "setBadgeTextColor",
      "getBadgeTextColor",
      "setTitle",
      "getTitle",
      "setPopup",
      "getPopup",
      "enable",
      "disable",
      "isEnabled",
      "getUserSettings",
      "openPopup",
    ]),
    setIcon: method("action", "setIcon", iconArgs),
    onClicked: event("action.onClicked"),
  });
  if (manifestVersion === 2) {
    // MV2's names for the same button.
    chrome.browserAction = action;
    chrome.pageAction = Object.assign({}, action, { show: action.enable, hide: action.disable });
  }
  let nextMenuId = Math.floor(Math.random() * 1e6);
  const menus = define("contextMenus", {
    create(props: Record<string, unknown>, callback?: Listener) {
      const { onclick, ...rest } = props ?? {};
      const id = rest.id ?? ++nextMenuId;
      if (typeof onclick === "function") menuClicks.set(String(id), onclick as Listener);
      const pending = method("contextMenus", "create")({ ...rest, id }, ...(callback ? [callback] : []));
      if (pending) pending.catch((error: Error) => console.error(`chrome.contextMenus.create: ${error.message}`));
      return id;
    },
    update(id: unknown, props: Record<string, unknown>, callback?: Listener) {
      const { onclick, ...rest } = props ?? {};
      if (typeof onclick === "function") menuClicks.set(String(id), onclick as Listener);
      return method("contextMenus", "update")(id, rest, ...(callback ? [callback] : []));
    },
    ...calls("contextMenus", ["remove", "removeAll"]),
    onClicked: event("contextMenus.onClicked"),
    ACTION_MENU_TOP_LEVEL_LIMIT: 6,
  });
  chrome.menus = menus;
  define("notifications", {
    // create(options) or create(id, options).
    create: (...args: unknown[]) => {
      const withId = typeof args[0] === "string" || args[0] === undefined;
      return method("notifications", "create")(...(withId ? args : ["", ...args]));
    },
    ...calls("notifications", ["update", "clear", "getAll", "getPermissionLevel"]),
    onClicked: event("notifications.onClicked"),
    onClosed: event("notifications.onClosed"),
    onButtonClicked: event("notifications.onButtonClicked"),
  });
  define("commands", { ...calls("commands", ["getAll"]), onCommand: event("commands.onCommand") });
  if (!chrome.permissions) {
    define("permissions", {
      ...calls("permissions", ["getAll", "contains", "request", "remove"]),
      onAdded: event("permissions.onAdded"),
      onRemoved: event("permissions.onRemoved"),
    });
  }
  // Promise-style `browser` (Firefox-first code, webextension-polyfill): MV3 APIs return promises.
  // Chromium now defines its own `browser` for MV3, a separate object: it gets the same namespaces
  // (ColorZilla's "browser.tabs.create is not a function").
  const alias = g.browser;
  if (alias === undefined) {
    if (manifestVersion === 3) g.browser = chrome;
  } else if (alias && alias !== chrome) {
    for (const name of ["tabs", "windows", "action", "contextMenus", "menus", "notifications", "commands", "permissions"]) {
      try {
        Object.defineProperty(alias, name, { value: chrome[name], enumerable: true, configurable: true, writable: true });
      } catch {
        // Not replaceable: left as Chromium made it.
      }
    }
  }
}

/** The context's URL (a frame's `location`; a service worker's, read from its own world). */
function contextUrl(): string {
  const own = (globalThis as { location?: { href: string } }).location;
  if (own) return own.href;
  try {
    return String(contextBridge.executeInMainWorld({ func: () => String((globalThis as { location?: { href: string } }).location?.href ?? "") }));
  } catch {
    return "";
  }
}

const url = contextUrl();
if (url.startsWith("chrome-extension://")) {
  const bridge: Bridge = {
    call: (namespace, method, args) => ipcRenderer.invoke(EXTENSION_CHANNELS.call, namespace, method, args),
    listen: (event) => ipcRenderer.send(EXTENSION_CHANNELS.listen, event),
    onEvent: (callback) => {
      ipcRenderer.on(EXTENSION_CHANNELS.event, (_event, name: string, args: unknown[]) => callback(name, Array.isArray(args) ? args : []));
    },
  };
  // The extension's manifest version decides the MV2 aliases and `browser`.
  const manifestVersion = Number(contextBridge.executeInMainWorld({ func: () => (globalThis as { chrome?: { runtime?: { getManifest?: () => { manifest_version?: number } } } }).chrome?.runtime?.getManifest?.()?.manifest_version ?? 3 }));
  contextBridge.executeInMainWorld({ func: installApis, args: [bridge, manifestVersion] });
}
