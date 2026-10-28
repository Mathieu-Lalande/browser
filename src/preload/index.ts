import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type { DownloadsChange } from "@shared/downloads";
import { Channels, type BrowserApi } from "@shared/ipc";
import type { PeekState } from "@shared/peek";
import type { Settings } from "@shared/settings";
import type { KeyPress } from "@shared/accelerators";
import type { SyncStatus } from "@shared/sync/controller";
import type { BrowserState, OverlayBackdrop, OverlayRequest, UiCommand } from "@shared/types";

function subscribe<T>(channel: string, listener: (payload: T) => void): () => void {
  const wrapped = (_event: IpcRendererEvent, payload: T) => listener(payload);
  ipcRenderer.on(channel, wrapped);
  return () => ipcRenderer.removeListener(channel, wrapped);
}

const send = (channel: string, ...args: unknown[]) => ipcRenderer.send(channel, ...args);

// Only these narrow functions reach the chrome UI; ipcRenderer itself is never exposed.
const api: BrowserApi = {
  getState: () => ipcRenderer.invoke(Channels.getState),
  onState: (listener) => subscribe<BrowserState>(Channels.state, listener),
  onUiCommand: (listener) => subscribe<UiCommand>(Channels.uiCommand, listener),
  tabs: {
    create: (input) => send(Channels.tabCreate, input),
    close: (id) => send(Channels.tabClose, id),
    activate: (id) => send(Channels.tabActivate, id),
    navigate: (id, input) => send(Channels.tabNavigate, id, input),
    back: (id) => send(Channels.tabBack, id),
    forward: (id) => send(Channels.tabForward, id),
    reload: (id) => send(Channels.tabReload, id),
    stop: (id) => send(Channels.tabStop, id),
    togglePin: (id) => send(Channels.tabTogglePin, id),
    move: (id, toIndex) => send(Channels.tabMove, id, toIndex),
    toggleShields: (id) => send(Channels.tabToggleShields, id),
    proceedHttp: (id) => send(Channels.tabProceedHttp, id),
    toggleMute: (id) => send(Channels.tabToggleMute, id),
    contextMenu: (id) => send(Channels.tabContextMenu, id),
    moveToSpace: (id, spaceId) => send(Channels.tabMoveToSpace, id, spaceId),
    openBlockedPopup: (id) => send(Channels.tabOpenBlockedPopup, id),
    dismissBlockedPopup: (id) => send(Channels.tabDismissBlockedPopup, id),
    place: (id, folderId, beforeId) => send(Channels.tabPlace, id, folderId, beforeId),
  },
  folders: {
    create: (input, parentId, tabIds) => send(Channels.folderCreate, input, parentId, tabIds),
    update: (id, input) => send(Channels.folderUpdate, id, input),
    remove: (id, closeTabs) => send(Channels.folderRemove, id, closeTabs),
    move: (id, parentId, index) => send(Channels.folderMove, id, parentId, index),
  },
  favorites: {
    add: (tabId, index) => send(Channels.favoritesAdd, tabId, index),
    remove: (url) => send(Channels.favoritesRemove, url),
    move: (url, index) => send(Channels.favoritesMove, url, index),
    open: (url) => send(Channels.favoritesOpen, url),
    contextMenu: (url) => send(Channels.favoritesContextMenu, url),
  },
  archive: {
    list: (query) => ipcRenderer.invoke(Channels.archiveList, query),
    restore: (id) => send(Channels.archiveRestore, id),
    remove: (id) => send(Channels.archiveRemove, id),
    clear: () => send(Channels.archiveClear),
    onChanged: (listener) => subscribe<void>(Channels.archiveChanged, () => listener()),
  },
  extensions: {
    list: () => ipcRenderer.invoke(Channels.extensionsList),
    installFromFolder: () => ipcRenderer.invoke(Channels.extensionsInstallFolder),
    installFromFile: () => ipcRenderer.invoke(Channels.extensionsInstallFile),
    setEnabled: (id, enabled) => ipcRenderer.invoke(Channels.extensionsSetEnabled, id, enabled),
    setPrivateAllowed: (id, allowed) => ipcRenderer.invoke(Channels.extensionsSetPrivateAllowed, id, allowed),
    remove: (id) => ipcRenderer.invoke(Channels.extensionsRemove, id),
    onChanged: (listener) => subscribe<void>(Channels.extensionsChanged, () => listener()),
  },
  boosts: {
    list: () => ipcRenderer.invoke(Channels.boostsList),
    forTab: (tabId) => ipcRenderer.invoke(Channels.boostsForTab, tabId),
    createForTab: (tabId) => ipcRenderer.invoke(Channels.boostsCreateForTab, tabId),
    save: (boost) => ipcRenderer.invoke(Channels.boostsSave, boost),
    remove: (id) => ipcRenderer.invoke(Channels.boostsRemove, id),
    unzap: (tabId, selector) => ipcRenderer.invoke(Channels.boostsUnzap, tabId, selector),
    zap: (tabId) => send(Channels.boostsZap, tabId),
    onChanged: (listener) => subscribe<void>(Channels.boostsChanged, () => listener()),
  },
  passwords: {
    status: () => ipcRenderer.invoke(Channels.passwordsStatus),
    list: () => ipcRenderer.invoke(Channels.passwordsList),
    neverList: () => ipcRenderer.invoke(Channels.passwordsNeverList),
    reveal: (id) => ipcRenderer.invoke(Channels.passwordsReveal, id),
    copy: (id) => ipcRenderer.invoke(Channels.passwordsCopy, id),
    update: (id, edit) => ipcRenderer.invoke(Channels.passwordsUpdate, id, edit),
    remove: (id) => ipcRenderer.invoke(Channels.passwordsRemove, id),
    removeNever: (origin) => ipcRenderer.invoke(Channels.passwordsRemoveNever, origin),
    exportCsv: () => ipcRenderer.invoke(Channels.passwordsExport),
    onChanged: (listener) => subscribe<void>(Channels.passwordsChanged, () => listener()),
    showFill: (anchor) => send(Channels.passwordsShowFill, anchor),
    accounts: (tabId) => ipcRenderer.invoke(Channels.passwordsAccounts, tabId),
    fill: (tabId, id) => ipcRenderer.invoke(Channels.passwordsFill, tabId, id),
    prompt: (captureId) => ipcRenderer.invoke(Channels.passwordsPrompt, captureId),
    answer: (captureId, answer) => ipcRenderer.invoke(Channels.passwordsAnswer, captureId, answer),
  },
  reader: {
    article: (tabId) => ipcRenderer.invoke(Channels.readerArticle, tabId),
  },
  peek: {
    onState: (listener) => subscribe<PeekState>(Channels.peekState, listener),
    action: (action) => send(Channels.peekAction, action),
  },
  spaces: {
    create: (input) => ipcRenderer.invoke(Channels.spaceCreate, input),
    update: (id, input) => send(Channels.spaceUpdate, id, input),
    remove: (id) => send(Channels.spaceRemove, id),
    switchTo: (id) => send(Channels.spaceSwitch, id),
  },
  split: {
    open: (tabId) => send(Channels.splitOpen, tabId),
    exit: () => send(Channels.splitExit),
    setRatios: (ratioX, ratioY) => send(Channels.splitRatios, ratioX, ratioY),
  },
  permissions: {
    respond: (tabId, promptId, allow, remember) => send(Channels.permissionRespond, tabId, promptId, allow, remember),
  },
  layout: {
    setContentBounds: (bounds) => send(Channels.layoutBounds, bounds),
  },
  window: {
    minimize: () => send(Channels.windowMinimize),
    toggleMaximize: () => send(Channels.windowToggleMaximize),
    close: () => send(Channels.windowClose),
    isMaximized: () => ipcRenderer.invoke(Channels.windowIsMaximized),
    onMaximizedChange: (listener) => subscribe<boolean>(Channels.windowMaximized, listener),
  },
  history: {
    search: (query, limit) => ipcRenderer.invoke(Channels.historySearch, query, limit),
    topSites: (limit) => ipcRenderer.invoke(Channels.historyTopSites, limit),
    clear: () => ipcRenderer.invoke(Channels.historyClear),
  },
  bookmarks: {
    list: () => ipcRenderer.invoke(Channels.bookmarksList),
    add: (input) => ipcRenderer.invoke(Channels.bookmarksAdd, input),
    remove: (id) => ipcRenderer.invoke(Channels.bookmarksRemove, id),
    toggleActive: () => send(Channels.bookmarksToggleActive),
  },
  commands: {
    run: (id) => send(Channels.commandRun, id),
  },
  overlay: {
    onShow: (listener) => subscribe<OverlayRequest>(Channels.overlayShow, listener),
    onBackdrop: (listener) => subscribe<OverlayBackdrop>(Channels.overlayBackdrop, listener),
    close: (restoreFocus) => send(Channels.overlayClose, restoreFocus),
  },
  settings: {
    get: () => ipcRenderer.invoke(Channels.settingsGet),
    update: (patch) => ipcRenderer.invoke(Channels.settingsUpdate, patch),
    reset: (section) => ipcRenderer.invoke(Channels.settingsReset, section),
    onChanged: (listener) => subscribe<Settings>(Channels.settingsChanged, listener),
    open: () => send(Channels.settingsOpen),
    captureShortcut: (active) => send(Channels.shortcutCapture, active),
    onShortcutKey: (listener) => subscribe<KeyPress>(Channels.shortcutKey, listener),
    startImage: () => ipcRenderer.invoke(Channels.startImage),
  },
  find: {
    query: (tabId, query, matchCase) => send(Channels.findQuery, tabId, query, matchCase),
    step: (tabId, forward) => send(Channels.findStep, tabId, forward),
    close: (tabId) => send(Channels.findClose, tabId),
  },
  downloads: {
    list: () => ipcRenderer.invoke(Channels.downloadsList),
    onChanged: (listener) => subscribe<DownloadsChange>(Channels.downloadsChanged, listener),
    pause: (id) => send(Channels.downloadsPause, id),
    resume: (id) => send(Channels.downloadsResume, id),
    cancel: (id) => send(Channels.downloadsCancel, id),
    keep: (id) => send(Channels.downloadsKeep, id),
    open: (id) => send(Channels.downloadsOpen, id),
    showInFolder: (id) => send(Channels.downloadsShowInFolder, id),
    remove: (id) => send(Channels.downloadsRemove, id),
    retry: (id) => send(Channels.downloadsRetry, id),
    clear: () => send(Channels.downloadsClear),
    chooseFolder: () => ipcRenderer.invoke(Channels.downloadsChooseFolder),
    showPanel: (anchor) => send(Channels.downloadsShowPanel, anchor),
    openPage: () => send(Channels.downloadsOpenPage),
  },
  sync: {
    status: () => ipcRenderer.invoke(Channels.syncStatus),
    onChanged: (listener) => subscribe<SyncStatus>(Channels.syncChanged, listener),
    createAccount: (serverUrl, registrationSecret) => ipcRenderer.invoke(Channels.syncCreate, serverUrl, registrationSecret),
    pair: (code) => ipcRenderer.invoke(Channels.syncPair, code),
    pairingCode: () => ipcRenderer.invoke(Channels.syncPairingCode),
    syncNow: () => send(Channels.syncNow),
    disconnect: () => ipcRenderer.invoke(Channels.syncDisconnect),
    reset: () => ipcRenderer.invoke(Channels.syncReset),
  },
  siteInfo: {
    show: (anchor) => send(Channels.siteInfoShow, anchor),
    get: (tabId) => ipcRenderer.invoke(Channels.siteInfoGet, tabId),
    resetPermission: (tabId, origin, kind) => ipcRenderer.invoke(Channels.siteInfoResetPermission, tabId, origin, kind),
    clearData: (tabId) => ipcRenderer.invoke(Channels.siteInfoClearData, tabId),
    allowThirdPartyCookies: (tabId, allow) => ipcRenderer.invoke(Channels.siteInfoAllowThirdPartyCookies, tabId, allow),
  },
  siteData: {
    list: () => ipcRenderer.invoke(Channels.siteDataList),
    remove: (site) => ipcRenderer.invoke(Channels.siteDataRemove, site),
    clearAll: () => ipcRenderer.invoke(Channels.siteDataClearAll),
  },
};

contextBridge.exposeInMainWorld("browser", api);
contextBridge.exposeInMainWorld("platform", process.platform);
