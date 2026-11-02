import { ipcMain } from "electron";
import type { Channels } from "@shared/ipc";
import { installRecorder } from "../capture/record";
import { BrowserController } from "../window";
import { downloadHandlers } from "./downloads";
import { mediaHandlers } from "./media";
import { archiveHandlers, favoriteHandlers, folderHandlers, spaceHandlers } from "./organize";
import { passwordHandlers } from "./passwords";
import { boostHandlers, captureHandlers } from "./page";
import { historyHandlers, settingsHandlers, weatherHandlers } from "./profile";
import { registerHandlers, type ChannelName, type Entry } from "./registry";
import { startSyncBroadcast, syncHandlers, themeHandlers, updateHandlers } from "./services";
import { extensionHandlers, siteInfoHandlers } from "./site";
import { tabHandlers } from "./tabs";
import { windowHandlers } from "./window";

/** Channels main sends to the UI (the preload subscribes to them): no handler. */
type EventChannel = (typeof Channels)[
  | "state"
  | "uiCommand"
  | "windowMaximized"
  | "overlayShow"
  | "overlayBackdrop"
  | "settingsChanged"
  | "shortcutKey"
  | "downloadsChanged"
  | "updatesChanged"
  | "syncChanged"
  | "recordingControl"
  | "archiveChanged"
  | "extensionsChanged"
  | "passwordsChanged"
  | "boostsChanged"
  | "peekState"
  | "mediaChanged"
  | "pageSwipeState"];

/** Every channel the UI sends or invokes: the compiler checks each one has exactly one handler. */
type RequestChannel = Exclude<ChannelName, EventChannel>;

const handlers = {
  ...windowHandlers,
  ...tabHandlers,
  ...folderHandlers,
  ...favoriteHandlers,
  ...archiveHandlers,
  ...spaceHandlers,
  ...historyHandlers,
  ...settingsHandlers,
  ...weatherHandlers,
  ...downloadHandlers,
  ...siteInfoHandlers,
  ...extensionHandlers,
  ...passwordHandlers,
  ...boostHandlers,
  ...captureHandlers,
  ...syncHandlers,
  ...updateHandlers,
  ...themeHandlers,
  ...mediaHandlers,
} satisfies Record<RequestChannel, Entry> & { [C in EventChannel]?: never };

export function registerIpc(): void {
  registerHandlers<Electron.WebContents, BrowserController>(ipcMain, {
    fromUi: (sender) => BrowserController.fromUi(sender),
    fromChrome: (sender) => BrowserController.fromChrome(sender),
    isPrivate: (controller) => controller.isPrivate,
  }, handlers);
  installRecorder();
  startSyncBroadcast();
}
