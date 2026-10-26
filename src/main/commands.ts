import { clipboard, type MenuItemConstructorOptions } from "electron";
import { commandAccelerator, getCommand, type CommandId } from "@shared/commands";
import { profile } from "./profile";
import { BrowserController } from "./window";

type Runner = (controller: BrowserController) => void;

/** Runs `action` with the active tab's id, if there is an active tab. */
const onActiveTab =
  (action: (controller: BrowserController, tabId: string) => void): Runner =>
  (controller) => {
    const tabId = controller.tabs.activeTabId;
    if (tabId) action(controller, tabId);
  };

/** What each registry command does. Menu items and the command palette both run these. */
const RUNNERS: Record<CommandId, Runner> = {
  "new-tab": (c) => {
    c.tabs.create();
    c.sendUiCommand("focus-address");
  },
  "new-window": () => new BrowserController(),
  "close-tab": onActiveTab((c, id) => c.tabs.close(id)),
  "duplicate-tab": onActiveTab((c, id) => c.tabs.duplicate(id)),
  "toggle-pin": onActiveTab((c, id) => c.tabs.togglePin(id)),
  reload: onActiveTab((c, id) => c.tabs.reload(id)),
  back: onActiveTab((c, id) => c.tabs.back(id)),
  forward: onActiveTab((c, id) => c.tabs.forward(id)),
  "copy-url": (c) => {
    const url = c.tabs.getState().tabs.find((tab) => tab.id === c.tabs.activeTabId)?.url;
    if (url) clipboard.writeText(url);
  },
  "toggle-bookmark": (c) => c.toggleBookmark(),
  "focus-address": (c) => c.sendUiCommand("focus-address"),
  "toggle-sidebar": (c) => c.sendUiCommand("toggle-sidebar"),
  "zoom-in": onActiveTab((c, id) => c.tabs.zoom(id, 1)),
  "zoom-out": onActiveTab((c, id) => c.tabs.zoom(id, -1)),
  "zoom-reset": onActiveTab((c, id) => c.tabs.zoom(id, 0)),
  devtools: (c) => c.tabs.activeWebContents()?.toggleDevTools(),
  "clear-history": () => {
    profile().history.clear();
    profile().saveHistory();
  },
  "command-palette": (c) => c.overlay.toggle({ kind: "palette" }),
  "open-settings": (c) => c.openSettings(),
  "toggle-zen": () => BrowserController.toggleZenMode(),
};

/** Commands that make sense without any window (macOS keeps the app running windowless). */
const WINDOWLESS = new Set<CommandId>(["new-window"]);

export function runCommand(id: CommandId, controller: BrowserController): void {
  RUNNERS[id](controller);
}

/**
 * Menu item for a registry command, run against the focused window. Accelerators fire whichever
 * view (chrome UI, overlay or web page) has focus.
 */
export function commandMenuItem(id: CommandId, options: MenuItemConstructorOptions = {}): MenuItemConstructorOptions {
  const command = getCommand(id);
  return {
    label: command.menuLabel ?? command.label,
    accelerator: commandAccelerator(command, process.platform),
    click: () => {
      const controller = BrowserController.focused();
      if (controller) RUNNERS[id](controller);
      else if (WINDOWLESS.has(id)) new BrowserController();
    },
    ...options,
  };
}
