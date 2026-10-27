import { ipcMain, type IpcMainEvent, type IpcMainInvokeEvent } from "electron";
import { isCommandId, type CommandId } from "@shared/commands";
import { Channels } from "@shared/ipc";
import { isSettingsSection } from "@shared/settings";
import { isSpaceId, isSpaceInput } from "@shared/spaces";
import type { BookmarkInput, Bounds, SpaceInput } from "@shared/types";
import { runCommand } from "./commands";
import {
  cancelDownload,
  chooseDownloadsFolder,
  clearDownloads,
  isDownloadVisible,
  keepDownload,
  listDownloads,
  openDownload,
  pauseDownload,
  removeDownload,
  resumeDownload,
  showDownloadInFolder,
} from "./downloads";
import { profile } from "./profile";
import { resetSettingsSection, settings, updateSettings } from "./settings";
import { spaces } from "./spaces";
import { startImage } from "./start-image";
import { showTabMenu } from "./tab-menu";
import { BrowserController } from "./window";

type Handler = (controller: BrowserController, ...args: unknown[]) => void;

const isString = (value: unknown): value is string => typeof value === "string";
const isBoolean = (value: unknown): value is boolean => typeof value === "boolean";
const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

function isBounds(value: unknown): value is Bounds {
  if (typeof value !== "object" || value === null) return false;
  const b = value as Record<string, unknown>;
  return isNumber(b.x) && isNumber(b.y) && isNumber(b.width) && isNumber(b.height);
}

const MAX_QUERY_LENGTH = 1024;
const MAX_URL_LENGTH = 8192;
const MAX_RESULTS = 100;
const MAX_SETTINGS_PATCH = 16 * 1024;

/** Undefined (use the default) or an integer in 1…MAX_RESULTS. */
const isLimit = (value: unknown) =>
  value === undefined || (Number.isInteger(value) && (value as number) >= 1 && (value as number) <= MAX_RESULTS);

function isBookmarkInput(value: unknown): value is BookmarkInput {
  if (typeof value !== "object" || value === null) return false;
  const b = value as Record<string, unknown>;
  const optionalString = (field: unknown) => field === undefined || isString(field);
  return (
    isString(b.url) &&
    b.url.length <= MAX_URL_LENGTH &&
    optionalString(b.title) &&
    (b.favicon === null || optionalString(b.favicon)) &&
    optionalString(b.folderId)
  );
}

/** Same as `on` for request/response channels: rejected calls reject the renderer's promise. */
function handle(channel: string, guard: (args: unknown[]) => boolean, handler: (...args: unknown[]) => unknown): void {
  ipcMain.handle(channel, (event: IpcMainInvokeEvent, ...args: unknown[]) => {
    if (!BrowserController.fromUi(event.sender) || !guard(args)) throw new Error(`Rejected ${channel}`);
    return handler(...args);
  });
}

/** Wraps a handler so it only runs for messages from a known browser UI (chrome or overlay), with validated arguments. */
function on(channel: string, guard: (args: unknown[]) => boolean, handler: Handler): void {
  ipcMain.on(channel, (event: IpcMainEvent, ...args: unknown[]) => {
    const controller = BrowserController.fromUi(event.sender);
    if (!controller || !guard(args)) return;
    handler(controller, ...args);
  });
}

const id = (args: unknown[]) => isString(args[0]);

export function registerIpc(): void {
  ipcMain.handle(Channels.getState, (event) => BrowserController.fromUi(event.sender)?.spaces.getState() ?? null);

  on(Channels.tabCreate, (args) => args[0] === undefined || isString(args[0]), (c, input) =>
    c.tabs.create(input as string | undefined),
  );
  on(Channels.tabClose, id, (c, tabId) => c.tabs.close(tabId as string));
  on(Channels.tabActivate, id, (c, tabId) => c.tabs.activate(tabId as string));
  on(Channels.tabNavigate, (args) => isString(args[0]) && isString(args[1]), (c, tabId, input) =>
    c.tabs.navigate(tabId as string, input as string),
  );
  on(Channels.tabBack, id, (c, tabId) => c.tabs.back(tabId as string));
  on(Channels.tabForward, id, (c, tabId) => c.tabs.forward(tabId as string));
  on(Channels.tabReload, id, (c, tabId) => c.tabs.reload(tabId as string));
  on(Channels.tabStop, id, (c, tabId) => c.tabs.stop(tabId as string));
  on(Channels.tabTogglePin, id, (c, tabId) => c.tabs.togglePin(tabId as string));
  on(Channels.tabMove, (args) => isString(args[0]) && isNumber(args[1]), (c, tabId, index) =>
    c.tabs.move(tabId as string, index as number),
  );
  on(Channels.tabToggleShields, id, (c, tabId) => c.tabs.toggleShields(tabId as string));
  on(Channels.tabProceedHttp, id, (c, tabId) => c.tabs.proceedHttp(tabId as string));
  on(
    Channels.permissionRespond,
    (args) => isString(args[0]) && isString(args[1]) && isBoolean(args[2]) && isBoolean(args[3]),
    (c, tabId, promptId, allow, remember) =>
      c.tabs.respondPermission(tabId as string, promptId as string, allow as boolean, remember as boolean),
  );
  on(Channels.tabContextMenu, id, (c, tabId) => showTabMenu(c, tabId as string));
  // Popup blocker notice: the renderer names the tab only, main keeps the blocked URL.
  on(Channels.tabOpenBlockedPopup, id, (c, tabId) => c.tabs.openBlockedPopup(tabId as string));
  on(Channels.tabDismissBlockedPopup, id, (c, tabId) => c.tabs.dismissBlockedPopup(tabId as string));
  on(Channels.tabMoveToSpace, (args) => isString(args[0]) && isSpaceId(args[1]), (c, tabId, spaceId) =>
    c.spaces.moveTab(tabId as string, spaceId as string),
  );

  // Spaces are shared by every window; the one that creates a space shows it. A private window
  // only has its own ephemeral space: it cannot see nor edit the shared ones (ADR-014).
  ipcMain.handle(Channels.spaceCreate, (event, input: unknown) => {
    const controller = BrowserController.fromUi(event.sender);
    if (!controller || controller.isPrivate || !(input === undefined || isSpaceInput(input))) throw new Error(`Rejected ${Channels.spaceCreate}`);
    const space = spaces.create(input);
    if (space) controller.spaces.switchTo(space.id);
    return space;
  });
  on(Channels.spaceUpdate, (args) => isSpaceId(args[0]) && isSpaceInput(args[1]), (c, spaceId, input) => {
    if (!c.isPrivate) spaces.update(spaceId as string, input as SpaceInput);
  });
  on(Channels.spaceRemove, (args) => isSpaceId(args[0]), (c, spaceId) => {
    if (!c.isPrivate) spaces.remove(spaceId as string);
  });
  on(Channels.spaceSwitch, (args) => isSpaceId(args[0]), (c, spaceId) => c.spaces.switchTo(spaceId as string));

  on(Channels.splitOpen, id, (c, tabId) => c.tabs.openSplit(tabId as string));
  on(Channels.splitExit, () => true, (c) => c.tabs.exitSplit());
  on(Channels.splitRatios, (args) => isNumber(args[0]) && isNumber(args[1]), (c, x, y) =>
    c.tabs.setSplitRatios(x as number, y as number),
  );

  on(Channels.layoutBounds, (args) => isBounds(args[0]), (c, bounds) => c.spaces.setBounds(bounds as Bounds));

  const none = () => true;
  on(Channels.windowMinimize, none, (c) => c.window.minimize());
  on(Channels.windowToggleMaximize, none, (c) => (c.window.isMaximized() ? c.window.unmaximize() : c.window.maximize()));
  on(Channels.windowClose, none, (c) => c.window.close());

  // History and bookmarks: chrome UI only (pages have no preload, and other senders are refused).
  const query = (args: unknown[]) => isString(args[0]) && args[0].length <= MAX_QUERY_LENGTH && isLimit(args[1]);
  handle(Channels.historySearch, query, (text, limit) =>
    profile().history.search(text as string, (limit as number | undefined) ?? 10, Date.now()),
  );
  handle(Channels.historyTopSites, (args) => isLimit(args[0]), (limit) =>
    profile().history.topSites((limit as number | undefined) ?? 8, Date.now()),
  );
  handle(Channels.historyClear, none, () => {
    profile().history.clear();
    profile().saveHistory();
  });

  const bookmarksChanged = () => {
    profile().saveBookmarks();
    BrowserController.refreshAll();
  };
  handle(Channels.bookmarksList, none, () => profile().bookmarks.list());
  handle(Channels.bookmarksAdd, (args) => isBookmarkInput(args[0]), (input) => {
    const bookmark = profile().bookmarks.add(input as BookmarkInput, Date.now());
    if (bookmark) bookmarksChanged();
    return bookmark;
  });
  handle(Channels.bookmarksRemove, id, (bookmarkId) => {
    if (profile().bookmarks.remove(bookmarkId as string)) bookmarksChanged();
  });
  on(Channels.bookmarksToggleActive, none, (c) => c.toggleBookmark());

  // Command palette: registry commands and the overlay layer.
  on(Channels.commandRun, (args) => isCommandId(args[0]), (c, commandId) => runCommand(commandId as CommandId, c));
  on(Channels.overlayClose, (args) => args[0] === undefined || typeof args[0] === "boolean", (c, restoreFocus) =>
    c.overlay.close(restoreFocus as boolean | undefined),
  );
  // Settings: the patch is an untrusted object, validated field by field by `sanitizeSettings`.
  const isPatch = (value: unknown) =>
    typeof value === "object" && value !== null && !Array.isArray(value) && JSON.stringify(value).length <= MAX_SETTINGS_PATCH;
  handle(Channels.settingsGet, none, () => settings());
  handle(Channels.settingsUpdate, (args) => isPatch(args[0]), (patch) => updateSettings(patch));
  handle(Channels.settingsReset, (args) => args[0] === undefined || isSettingsSection(args[0]), (section) =>
    resetSettingsSection(section as Parameters<typeof resetSettingsSection>[0]),
  );
  on(Channels.settingsOpen, none, (c) => c.openSettings());
  // The URL comes from the settings, never from the renderer; private windows get nothing (ADR-017).
  ipcMain.handle(Channels.startImage, (event) => {
    const controller = BrowserController.fromUi(event.sender);
    if (!controller) throw new Error(`Rejected ${Channels.startImage}`);
    const { background, backgroundImage } = settings().startPage;
    return controller.isPrivate || background !== "image" ? null : startImage(backgroundImage);
  });

  // Tab media and find in page (the find bar sends the query typed by the user).
  on(Channels.tabToggleMute, id, (c, tabId) => c.tabs.toggleMute(tabId as string));
  on(
    Channels.findQuery,
    (args) => isString(args[0]) && isString(args[1]) && args[1].length <= MAX_QUERY_LENGTH && isBoolean(args[2]),
    (c, tabId, text, matchCase) => c.tabs.findQuery(tabId as string, text as string, matchCase as boolean),
  );
  on(Channels.findStep, (args) => isString(args[0]) && isBoolean(args[1]), (c, tabId, forward) =>
    c.tabs.findStep(tabId as string, forward as boolean),
  );
  on(Channels.findClose, id, (c, tabId) => c.tabs.closeFind(tabId as string));

  // Downloads: the UI only names downloads by id; paths never come from the renderer.
  // A window only lists and acts on the downloads it may see (a private window's stay its own).
  const downloadId = (args: unknown[]) => isString(args[0]) && args[0].length <= 64;
  const onDownload = (channel: string, action: (id: string, c: BrowserController) => void) =>
    on(channel, downloadId, (c, downloadId) => {
      if (isDownloadVisible(downloadId as string, c.downloadViewer)) action(downloadId as string, c);
    });
  ipcMain.handle(Channels.downloadsList, (event) => {
    const controller = BrowserController.fromUi(event.sender);
    if (!controller) throw new Error(`Rejected ${Channels.downloadsList}`);
    return listDownloads(controller.downloadViewer);
  });
  onDownload(Channels.downloadsPause, pauseDownload);
  onDownload(Channels.downloadsResume, resumeDownload);
  onDownload(Channels.downloadsCancel, cancelDownload);
  onDownload(Channels.downloadsKeep, (downloadId, c) => void keepDownload(downloadId, c.window));
  onDownload(Channels.downloadsOpen, openDownload);
  onDownload(Channels.downloadsShowInFolder, showDownloadInFolder);
  onDownload(Channels.downloadsRemove, removeDownload);
  on(Channels.downloadsClear, none, (c) => clearDownloads(c.downloadViewer));
  ipcMain.handle(Channels.downloadsChooseFolder, (event) => {
    const controller = BrowserController.fromUi(event.sender);
    if (!controller) throw new Error(`Rejected ${Channels.downloadsChooseFolder}`);
    return chooseDownloadsFolder(controller.window);
  });
  on(Channels.downloadsShowPanel, (args) => isBounds(args[0]), (c, anchor) =>
    c.overlay.open({ kind: "downloads", anchor: anchor as Bounds }),
  );
  on(Channels.downloadsOpenPage, none, (c) => c.openDownloads());
}
