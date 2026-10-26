import { ipcMain, type IpcMainEvent, type IpcMainInvokeEvent } from "electron";
import { Channels } from "@shared/ipc";
import type { BookmarkInput, Bounds } from "@shared/types";
import { profile } from "./profile";
import { BrowserController } from "./window";

type Handler = (controller: BrowserController, ...args: unknown[]) => void;

const isString = (value: unknown): value is string => typeof value === "string";
const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

function isBounds(value: unknown): value is Bounds {
  if (typeof value !== "object" || value === null) return false;
  const b = value as Record<string, unknown>;
  return isNumber(b.x) && isNumber(b.y) && isNumber(b.width) && isNumber(b.height);
}

const MAX_QUERY_LENGTH = 1024;
const MAX_URL_LENGTH = 8192;
const MAX_RESULTS = 100;

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
    if (!BrowserController.fromChrome(event.sender) || !guard(args)) throw new Error(`Rejected ${channel}`);
    return handler(...args);
  });
}

/** Wraps a handler so it only runs for messages from a known chrome UI, with validated arguments. */
function on(channel: string, guard: (args: unknown[]) => boolean, handler: Handler): void {
  ipcMain.on(channel, (event: IpcMainEvent, ...args: unknown[]) => {
    const controller = BrowserController.fromChrome(event.sender);
    if (!controller || !guard(args)) return;
    handler(controller, ...args);
  });
}

const id = (args: unknown[]) => isString(args[0]);

export function registerIpc(): void {
  ipcMain.handle(Channels.getState, (event) => BrowserController.fromChrome(event.sender)?.tabs.getState() ?? null);

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
  on(Channels.layoutBounds, (args) => isBounds(args[0]), (c, bounds) => c.tabs.setBounds(bounds as Bounds));

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
}
