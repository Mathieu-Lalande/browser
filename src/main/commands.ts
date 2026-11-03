import { app, clipboard, type MenuItemConstructorOptions } from "electron";
import { effectiveAccelerator, effectiveAliases, getCommand, type CommandId } from "@shared/commands";
import { settings, updateSettings } from "./settings";
import { toggleFavorite } from "./organize";
import { profile } from "./profile";
import { toggleReader } from "./reader";
import { clearTabSiteData } from "./site-info";
import { sleepTabNow, sleepTabs } from "./sleep";
import { spaces } from "./spaces";
import { toggleSplit } from "./split";
import { appServices } from "./app-services-ref";
import { checkForUpdates, installUpdate } from "./updates";
import { BrowserController } from "./window";
import { ISSUES_URL, printPage, savePage, showAppMenu, viewSource } from "./page-actions";

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
  // Replaces another floating UI (e.g. the app menu), closes itself.
  "command-palette": (c) => (c.overlay.shown === "palette" ? c.overlay.close(true) : c.overlay.open({ kind: "palette" })),
  "open-settings": (c) => c.openSettings(),
  "toggle-zen": () => BrowserController.toggleZenMode(),
  find: onActiveTab(openFind),
  "find-next": findStep(true),
  "find-previous": findStep(false),
  "open-downloads": (c) => c.openDownloads(),
  "toggle-mute": onActiveTab((c, id) => c.tabs.toggleMute(id)),
  "picture-in-picture": onActiveTab((c, id) => c.tabs.pictureInPicture(id)),
  "pause-all-media": () => {
    for (const controller of BrowserController.all()) void controller.media.pauseAll();
  },
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
  "sync-now": () => void appServices().sync.controller.syncNow(),
  "site-info": (c) => c.showSiteInfo(),
  // The tab's own session: a private window clears its in-memory data only.
  "clear-site-data": onActiveTab((c, id) => void clearTabSiteData(c, id)),
  "toggle-favorite": onActiveTab(toggleFavorite),
  "new-folder": (c) => void c.tabs.createFolder(),
  "open-archive": (c) => c.openArchive(),
  "open-history": (c) => c.openInternal("history"),
  "import-data": (c) => c.openInternal("import"),
  "open-extensions": (c) => c.openExtensions(),
  "open-passwords": (c) => c.openPasswords(),
  "toggle-reader": onActiveTab((c, id) => void toggleReader(c, id)),
  "toggle-mobile-site": onActiveTab((c, id) => c.tabs.toggleMobileSite(id)),
  "translate-page": onActiveTab((c, id) => void c.translator.toggle(id)),
  "highlight-selection": onActiveTab((c, id) => void c.annotator.highlightSelection(id)),
  "toggle-notes-panel": (c) => c.sendUiCommand("toggle-notes"),
  "open-notes": (c) => c.openNotes(),
  "open-boosts": (c) => c.openBoosts(),
  "zap-elements": onActiveTab((c, id) => appServices().boosts.startZap(c, id)),
  // Shows the settings, where the update status is.
  "check-updates": (c) => {
    c.openSettings();
    checkForUpdates();
  },
  "install-update": () => installUpdate(),
  "page-options": (c) => appServices().capture.showPageOptions(c),
  "screenshot-visible": (c) => void appServices().capture.capture(c, "visible"),
  "screenshot-full": (c) => void appServices().capture.capture(c, "full"),
  "screenshot-element": (c) => void appServices().capture.capture(c, "element"),
  "record-video": (c) => appServices().capture.recorder.toggle(c),
  // Print preview (ADR-042).
  print: (c) => printPage(c),
  "save-page": (c) => void savePage(c),
  "view-source": (c) => viewSource(c),
  "reopen-closed-tab": (c) => void c.tabs.reopenClosed(),
  "reopen-closed-window": () => void appServices().recovery.reopenWindow(),
  "open-task-manager": (c) => c.openInternal("tasks"),
  "open-profiles": (c) => c.openInternal("profiles"),
  "new-profile": (c) => c.openInternal("profiles", "new"),
  "open-autofill": (c) => c.openInternal("settings", "autofill"),
  "select-all-tabs": (c) => c.sendUiCommand("select-all-tabs"),
  "toggle-compact-mode": () => void updateSettings({ layout: { compactMode: !settings().layout.compactMode } }),
  "toggle-sidebar-position": () => void updateSettings({ layout: { sidebarPosition: settings().layout.sidebarPosition === "left" ? "right" : "left" } }),
  "toggle-fullscreen": (c) => c.window.setFullScreen(!c.window.isFullScreen()),
  "edit-space": (c) => {
    if (!c.isPrivate) c.sendUiCommand(`edit-space:${c.spaces.activeSpaceId}`);
  },
  "app-menu": (c) => showAppMenu(c),
  "open-sync": (c) => c.openInternal("settings", "sync"),
  "keyboard-shortcuts": (c) => c.openInternal("settings", "shortcuts"),
  // The "Mises à jour" section shows the version.
  about: (c) => c.openInternal("settings", "updates"),
  "report-issue": (c) => void c.tabs.create(ISSUES_URL),
  quit: () => app.quit(),
};

/** Commands that make sense without any window (macOS keeps the app running windowless). */
const WINDOWLESS: Partial<Record<CommandId, () => void>> = {
  "new-window": () => new BrowserController(),
  "new-private-window": () => openPrivateWindow(),
  "reopen-closed-window": () => void appServices().recovery.reopenWindow(),
  "install-update": () => installUpdate(),
  quit: () => app.quit(),
};

function openPrivateWindow(): BrowserController {
  return new BrowserController(undefined, { private: true });
}

export function runCommand(id: CommandId, controller: BrowserController): void {
  RUNNERS[id](controller);
}

function runFocused(id: CommandId): void {
  const controller = BrowserController.focused();
  if (controller) RUNNERS[id](controller);
  else WINDOWLESS[id]?.();
}

/**
 * Menu items for a registry command, run against the focused window: the visible one with the
 * command's effective shortcut (the user's, ADR-028), then hidden ones for its aliases (F5…).
 * Accelerators fire whichever view (chrome UI, overlay or web page) has focus.
 */
export function commandMenuItems(id: CommandId, options: MenuItemConstructorOptions = {}): MenuItemConstructorOptions[] {
  const command = getCommand(id);
  const overrides = settings().shortcuts;
  const label = command.menuLabel ?? command.label;
  return [
    { label, accelerator: effectiveAccelerator(id, process.platform, overrides), click: () => runFocused(id), ...options },
    ...effectiveAliases(id, process.platform, overrides).map(
      (accelerator): MenuItemConstructorOptions => ({ label, accelerator, visible: false, click: () => runFocused(id) }),
    ),
  ];
}
