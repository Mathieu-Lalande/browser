import { ipcMain, type IpcMainEvent, type IpcMainInvokeEvent } from "electron";
import { Channels, type SyncActionResult } from "@shared/ipc";
import { SyncError } from "@shared/sync/client";
import { BrowserController } from "../window";
import { onSyncStatus, syncController } from "./index";

/**
 * IPC of the sync settings (ADR-019), same rules as `src/main/ipc.ts`: only the browser's own UI
 * may call, arguments are checked. Private windows can read the status and the other devices'
 * tabs, but not touch the account nor reveal the pairing code.
 */

const MAX_URL = 512;
const MAX_CODE = 2048;
const MAX_SECRET = 256;

const isText = (value: unknown, max: number): value is string => typeof value === "string" && value.length > 0 && value.length <= max;

function sender(event: IpcMainEvent | IpcMainInvokeEvent, channel: string, allowPrivate = false): BrowserController {
  const controller = BrowserController.fromUi(event.sender);
  if (!controller || (controller.isPrivate && !allowPrivate)) throw new Error(`Rejected ${channel}`);
  return controller;
}

async function attempt(action: () => Promise<void>): Promise<SyncActionResult> {
  try {
    await action();
    return { ok: true };
  } catch (error) {
    if (error instanceof SyncError) return { ok: false, message: error.message };
    return { ok: false, message: "La synchronisation a échoué." };
  }
}

export function registerSyncIpc(): void {
  const sync = syncController();
  onSyncStatus((status) => {
    for (const controller of BrowserController.all()) controller.send(Channels.syncChanged, status);
  });

  ipcMain.handle(Channels.syncStatus, (event) => {
    sender(event, Channels.syncStatus, true);
    return sync.getStatus();
  });
  ipcMain.handle(Channels.syncCreate, (event, serverUrl: unknown, secret: unknown) => {
    sender(event, Channels.syncCreate);
    if (!isText(serverUrl, MAX_URL) || !(secret === undefined || secret === "" || isText(secret, MAX_SECRET))) throw new Error(`Rejected ${Channels.syncCreate}`);
    return attempt(() => sync.createAccount(serverUrl, secret || undefined));
  });
  ipcMain.handle(Channels.syncPair, (event, code: unknown) => {
    sender(event, Channels.syncPair);
    if (!isText(code, MAX_CODE)) throw new Error(`Rejected ${Channels.syncPair}`);
    return attempt(() => sync.pair(code));
  });
  ipcMain.handle(Channels.syncPairingCode, (event) => {
    sender(event, Channels.syncPairingCode);
    return sync.pairingCode();
  });
  ipcMain.on(Channels.syncNow, (event) => {
    if (BrowserController.fromUi(event.sender)) void sync.syncNow();
  });
  ipcMain.handle(Channels.syncDisconnect, (event) => {
    sender(event, Channels.syncDisconnect);
    return attempt(() => sync.disconnect());
  });
  ipcMain.handle(Channels.syncReset, (event) => {
    sender(event, Channels.syncReset);
    return attempt(() => sync.reset());
  });
}
