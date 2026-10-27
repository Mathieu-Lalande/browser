import { clipboard, type MenuItemConstructorOptions } from "electron";
import { commandAccelerator, getCommand, type CommandId } from "@shared/commands";
import { profile } from "./profile";
import { clearTabSiteData } from "./site-info";
import { sleepTabNow, sleepTabs } from "./sleep";
import { spaces } from "./spaces";
import { toggleSplit } from "./split";
import { syncController } from "./sync";
import { BrowserController } from "./window";

type Runner = (controller: BrowserController) => void;

/** Runs `action` with the active tab's id, if there is an active tab. */
const onActiveTab =
  (action: (controller: BrowserController, tabId: string) => void): Runner =>
  (controller) => {
    const tabId = controller.tabs.activeTabId;
    if (tabId) action(controller, tabId);
  };

/** Find in page: shows the bar and focuses its field (a no-op on the start page and internal pages). */
function openFind(controller: BrowserController, tabId: string): void {
  if (controller.tabs.openFind(tabId)) controller.sendUiCommand("focus-find");
}

/** F3 / Shift+F3: next or previous match, or opens the find bar when it is closed. */
const findStep = (forward: boolean): Runner =>
  onActiveTab((c, id) => {
    const open = c.tabs.getState().tabs.find((tab) => tab.id === id)?.find?.open;
    if (open) c.tabs.findStep(id, forward);
    else openFind(c, id);
  });

/** What each registry command does. Menu items and the command palette both run these. */
const RUNNERS: Record<CommandId, Runner> = {
  "new-tab": (c) => {
    c.newTab();
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
  find: onActiveTab(openFind),
  "find-next": findStep(true),
  "find-previous": findStep(false),
  "open-downloads": (c) => c.openDownloads(),
  "toggle-mute": onActiveTab((c, id) => c.tabs.toggleMute(id)),
  "picture-in-picture": onActiveTab((c, id) => c.tabs.pictureInPicture(id)),
  "toggle-split": (c) => toggleSplit(c.tabs),
  "new-space": (c) => {
    // A private window has a single ephemeral space (ADR-014).
    if (c.isPrivate) return;
    const space = spaces.create();
    if (space) c.spaces.switchTo(space.id);
  },
  "next-space": (c) => c.spaces.switchBy(1),
  "previous-space": (c) => c.spaces.switchBy(-1),
  "new-private-window": () => openPrivateWindow(),
  "sleep-tab": onActiveTab((c, id) => void sleepTabNow(c.tabs, id)),
  // Every tab of the window not on screen, in all its spaces (manual: no idle delay).
  "sleep-other-tabs": (c) => {
    for (const manager of c.spaces.tabManagers()) void sleepTabs(manager, null, null);
  },
  "sync-now": () => void syncController().syncNow(),
  "site-info": (c) => c.showSiteInfo(),
  // The tab's own session: a private window clears its in-memory data only.
  "clear-site-data": onActiveTab((c, id) => void clearTabSiteData(c, id)),
};

/** Commands that make sense without any window (macOS keeps the app running windowless). */
const WINDOWLESS: Partial<Record<CommandId, () => void>> = {
  "new-window": () => new BrowserController(),
  "new-private-window": () => openPrivateWindow(),
};

function openPrivateWindow(): BrowserController {
  return new BrowserController(undefined, { private: true });
}

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
      else WINDOWLESS[id]?.();
    },
    ...options,
  };
}
