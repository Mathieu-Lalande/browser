import { ipcMain } from "electron";
import type { Channels } from "@shared/ipc";
import { appServices } from "../app-services-ref";
import { BrowserController } from "../window";
import { downloadHandlers } from "./downloads";
import { mediaHandlers } from "./media";
import { panelHandlers, readingHandlers } from "./panels";
import { annotationHandlers } from "./annotations";
import { archiveHandlers, favoriteHandlers, folderHandlers, spaceHandlers } from "./organize";
import { passwordHandlers } from "./passwords";
import { autofillHandlers, spellcheckHandlers } from "./autofill";
import { boostHandlers, captureHandlers } from "./page";
import { historyHandlers, settingsHandlers, weatherHandlers } from "./profile";
import { defaultBrowserHandlers, drmHandlers, importHandlers } from "./import";
import { registerHandlers, type ChannelName, type Entry } from "./registry";
import { startSyncBroadcast, syncHandlers, themeHandlers, updateHandlers } from "./services";
import { extensionHandlers, privacyPageHandlers, siteInfoHandlers } from "./site";
import { tabHandlers } from "./tabs";
import { translateHandlers } from "./translate";
import { assistantHandlers } from "./assistant";
import { windowHandlers } from "./window";
import { lifecycleHandlers } from "./lifecycle";

/** Channels main sends to the UI (the preload subscribes to them): no handler. */
type EventChannel = (typeof Channels)[
  | "state"
  | "uiCommand"
  | "windowMaximized"
  | "windowTopBarLeft"
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
  | "autofillChanged"
  | "boostsChanged"
  | "peekState"
  | "mediaChanged"
  | "pageSwipeState"
  | "annotationsChanged"
  | "assistantChanged"
  | "readingChanged"
  | "importProgress"
  | "miniState"];

/** Registered by `MiniWindows.registerIpc` (ADR-048): its sender is a mini window's bar, not a browser window's UI. */
type OwnChannel = (typeof Channels)["miniAction"];

/** Every channel the UI sends or invokes: the compiler checks each one has exactly one handler. */
type RequestChannel = Exclude<ChannelName, EventChannel | OwnChannel>;

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
  ...privacyPageHandlers,
  ...extensionHandlers,
  ...passwordHandlers,
  ...autofillHandlers,
  ...spellcheckHandlers,
  ...boostHandlers,
  ...captureHandlers,
  ...syncHandlers,
  ...updateHandlers,
  ...themeHandlers,
  ...mediaHandlers,
  ...panelHandlers,
  ...readingHandlers,
  ...translateHandlers,
  ...assistantHandlers,
  ...annotationHandlers,
  ...defaultBrowserHandlers,
  ...drmHandlers,
  ...importHandlers,
  ...lifecycleHandlers,
} satisfies Record<RequestChannel, Entry> & { [C in EventChannel]?: never };

export function registerIpc(): void {
  registerHandlers<Electron.WebContents, BrowserController>(ipcMain, {
    fromUi: (sender) => BrowserController.fromUi(sender),
    fromChrome: (sender) => BrowserController.fromChrome(sender),
    isPrivate: (controller) => controller.isPrivate,
  }, handlers);
  appServices().capture.recorder.install();
  startSyncBroadcast();
}
