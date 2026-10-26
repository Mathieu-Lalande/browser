import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import { Channels, type BrowserApi } from "@shared/ipc";
import type { BrowserState, UiCommand } from "@shared/types";

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
  },
  layout: {
    setContentBounds: (bounds) => send(Channels.layoutBounds, bounds),
  },
  window: {
    minimize: () => send(Channels.windowMinimize),
    toggleMaximize: () => send(Channels.windowToggleMaximize),
    close: () => send(Channels.windowClose),
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
};

contextBridge.exposeInMainWorld("browser", api);
contextBridge.exposeInMainWorld("platform", process.platform);
