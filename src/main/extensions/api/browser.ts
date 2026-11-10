import { session as electronSession, type WebContents } from "electron";
import { Channels } from "@shared/ipc";
import type { TabId } from "@shared/types";
import { spaces } from "../../spaces";
import { BrowserController } from "../../window";
import type { BrowserTab, ExtensionBrowser } from "./ports";

/**
 * The extension API bridge's view of the browser windows (ADR-053), over `BrowserController`:
 * normal windows only (extensions never run in a private one), every space's tabs.
 */

const normalWindows = () => BrowserController.all().filter((controller) => !controller.isPrivate && !controller.window.isDestroyed());

const byId = (id: number | null) => (id === null ? undefined : normalWindows().find((controller) => controller.window.id === id));

function entries(controller: BrowserController) {
  return controller.spaces.allTabs();
}

function find(key: TabId) {
  for (const controller of normalWindows()) {
    const entry = entries(controller).find((item) => item.tab.id === key);
    if (entry) return { controller, ...entry };
  }
  return undefined;
}

export function extensionBrowser(): ExtensionBrowser {
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
            session: spaces.sessionFor(spaceId) ?? electronSession.defaultSession,
          };
        }),
      ),
    lastFocusedWindow: () => BrowserController.lastNormal()?.window.id ?? null,
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
      const controller = byId(windowId) ?? BrowserController.lastNormal() ?? new BrowserController();
      return controller.tabs.create(url, { activate: options.active, index: options.index, extensionPage: options.extensionPage });
    },
    closeTab: (key) => find(key)?.manager.close(key),
    navigateTab: (key, url, extensionPage) => find(key)?.manager.navigate(key, url, { extensionPage }),
    activateTab: (key) => {
      const entry = find(key);
      entry?.controller.spaces.showTab(entry.spaceId, key);
    },
    createWindow: (url, extensionPage, focused) => {
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
      for (const controller of normalWindows()) controller.send(Channels.extensionsActionStates, states);
    },
  };
}
