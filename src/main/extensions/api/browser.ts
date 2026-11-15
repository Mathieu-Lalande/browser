import { session as electronSession, type WebContents } from "electron";
import { Channels } from "@shared/ipc";
import type { TabId } from "@shared/types";
import { spaces } from "../../spaces";
import { BrowserController } from "../../window";
import type { BrowserTab, ExtensionBrowser } from "./ports";

/**
 * The extension API bridge's view of the browser windows (ADR-053), over `BrowserController`,
 * every space's tabs. `scope` null: the normal windows. A private window's session (ADR-057): that
 * window alone — an extension allowed in private browsing sees its private tabs there, never the
 * normal ones, and the normal instance never sees the private window.
 */

function entries(controller: BrowserController) {
  return controller.spaces.allTabs();
}

export function extensionBrowser(scope: Electron.Session | null = null): ExtensionBrowser {
  const normalWindows = () =>
    BrowserController.all().filter((controller) => !controller.window.isDestroyed() && (scope ? controller.isPrivate && controller.tabSession === scope : !controller.isPrivate));
  const byId = (id: number | null) => (id === null ? undefined : normalWindows().find((controller) => controller.window.id === id));
  const find = (key: TabId) => {
    for (const controller of normalWindows()) {
      const entry = entries(controller).find((item) => item.tab.id === key);
      if (entry) return { controller, ...entry };
    }
    return undefined;
  };
  const sessionOf = (spaceId: string) => scope ?? spaces.sessionFor(spaceId) ?? electronSession.defaultSession;
  return {
    windows: () =>
      normalWindows().map((controller) => {
        const { window } = controller;
        return {
          id: window.id,
          focused: window.isFocused(),
          bounds: window.getBounds(),
          state: window.isFullScreen() ? "fullscreen" : window.isMinimized() ? "minimized" : window.isMaximized() ? "maximized" : "normal",
        };
      }),
    tabs: () =>
      normalWindows().flatMap((controller) =>
        entries(controller).map(({ spaceId, manager, tab }, index): BrowserTab => {
          const contents = manager.pageOf(tab.id);
          return {
            key: tab.id,
            windowId: controller.window.id,
            index,
            active: spaceId === controller.spaces.activeSpaceId && manager.activeTabId === tab.id,
            pinned: tab.isPinned,
            url: tab.url,
            title: tab.title,
            favicon: tab.favicon,
            loading: tab.isLoading,
            discarded: !contents && /^https?:/i.test(tab.url),
            contents,
            session: sessionOf(spaceId),
          };
        }),
      ),
    lastFocusedWindow: () => (scope ? (normalWindows()[0]?.window.id ?? null) : (BrowserController.lastNormal()?.window.id ?? null)),
    windowOf: (contents: WebContents) => {
      for (const controller of normalWindows()) {
        if (controller.extensionPopup.contents === contents) return controller.window.id;
        if (entries(controller).some(({ manager, tab }) => manager.pageOf(tab.id) === contents)) return controller.window.id;
      }
      return null;
    },
    tabOf: (contents: WebContents) => {
      for (const controller of normalWindows()) {
        const entry = entries(controller).find(({ manager, tab }) => manager.pageOf(tab.id) === contents);
        if (entry) return entry.tab.id;
      }
      return null;
    },
    createTab: (windowId, url, options) => {
      const controller = byId(windowId) ?? (scope ? normalWindows()[0] : (BrowserController.lastNormal() ?? new BrowserController()));
      return controller ? controller.tabs.create(url, { activate: options.active, index: options.index, extensionPage: options.extensionPage }) : null;
    },
    closeTab: (key) => find(key)?.manager.close(key),
    navigateTab: (key, url, extensionPage) => find(key)?.manager.navigate(key, url, { extensionPage }),
    activateTab: (key) => {
      const entry = find(key);
      entry?.controller.spaces.showTab(entry.spaceId, key);
    },
    createWindow: (url, extensionPage, focused) => {
      // A private window's instance opens no window (a new one would be another private session).
      if (scope) return null;
      const controller = new BrowserController();
      const tabId = controller.tabs.activeTabId;
      if (url && tabId) controller.tabs.navigate(tabId, url, { extensionPage });
      if (focused) controller.focus();
      return controller.window.id;
    },
    focusWindow: (id) => byId(id)?.focus(),
    closeWindow: (id) => byId(id)?.window.close(),
    onChange: (listener) => BrowserController.changed.on(listener),
    pushActionStates: (states) => {
      // Every window: a private window shows the buttons of the extensions allowed there (ADR-057).
      for (const controller of BrowserController.all()) if (!controller.window.isDestroyed()) controller.send(Channels.extensionsActionStates, states);
    },
  };
}
