import { ipcMain, type IpcMainEvent } from "electron";
import { Channels } from "@shared/ipc";
import type { Bounds } from "@shared/types";
import { BrowserController } from "./window";

type Handler = (controller: BrowserController, ...args: unknown[]) => void;

const isString = (value: unknown): value is string => typeof value === "string";
const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

function isBounds(value: unknown): value is Bounds {
  if (typeof value !== "object" || value === null) return false;
  const b = value as Record<string, unknown>;
  return isNumber(b.x) && isNumber(b.y) && isNumber(b.width) && isNumber(b.height);
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
}
