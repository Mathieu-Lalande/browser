import { Channels, type SyncActionResult } from "@shared/ipc";
import { SyncError } from "@shared/sync/client";
import { appServices } from "../app-services-ref";
import { exportTheme, importTheme } from "../theme-share";
import { checkForUpdates, downloadUpdate, installUpdate, updateService } from "../updates";
import { BrowserController } from "../window";
import { custom, defineHandlers, handle, handleUi, maxStr, onUi, opt, text } from "./registry";

/** The shared sync controller (ADR-019). */
const sync = () => appServices().sync.controller;

const MAX_SYNC_URL = 512;
const MAX_SYNC_CODE = 2048;
const MAX_SYNC_SECRET = 256;

/** Sync errors are messages for the user: they do not cross IPC as exceptions. */
async function attempt(action: () => Promise<void>): Promise<SyncActionResult> {
  try {
    await action();
    return { ok: true };
  } catch (error) {
    if (error instanceof SyncError) return { ok: false, message: error.message };
    return { ok: false, message: "La synchronisation a échoué." };
  }
}

/** Starts the sync controller and forwards its status to every window. */
export function startSyncBroadcast(): void {
  const service = appServices().sync;
  // Built now (as before the service existed): its status is what the windows show.
  void service.controller;
  service.onStatus((status) => {
    for (const controller of BrowserController.all()) controller.send(Channels.syncChanged, status);
  });
}

const noPrivate = { privateRefused: true } as const;

/**
 * Sync settings (ADR-019). Private windows can read the status and the other devices' tabs,
 * but not touch the account nor reveal the pairing code.
 */
export const syncHandlers = defineHandlers({
  [Channels.syncStatus]: handleUi([], () => sync().getStatus()),
  [Channels.syncCreate]: handle(
    [text(MAX_SYNC_URL), opt(maxStr(MAX_SYNC_SECRET))],
    (_c, serverUrl, secret) => attempt(() => sync().createAccount(serverUrl, secret || undefined)),
    noPrivate,
  ),
  [Channels.syncPair]: handle([text(MAX_SYNC_CODE)], (_c, code) => attempt(() => sync().pair(code)), noPrivate),
  [Channels.syncPairingCode]: handle([], () => sync().pairingCode(), noPrivate),
  [Channels.syncNow]: onUi([], () => void sync().syncNow()),
  [Channels.syncDisconnect]: handle([], () => attempt(() => sync().disconnect()), noPrivate),
  [Channels.syncReset]: handle([], () => attempt(() => sync().reset()), noPrivate),
});

/** Auto-updates (ADR-030): the UI may ask before the updater is ready (no status yet). */
export const updateHandlers = defineHandlers({
  [Channels.updatesStatus]: handleUi([], () => updateService()?.status ?? null),
  [Channels.updatesCheck]: onUi([], () => checkForUpdates()),
  [Channels.updatesDownload]: onUi([], () => downloadUpdate()),
  [Channels.updatesInstall]: onUi([], () => installUpdate()),
});

/** `.browsertheme` files (ADR-030): the theme is validated by `exportTheme` (it comes from the renderer). */
export const themeHandlers = defineHandlers({
  [Channels.themeExportFile]: handle([custom<unknown>(() => true)], (c, theme) => exportTheme(c, theme)),
  [Channels.themeImportFile]: handle([], (c) => importTheme(c)),
});
