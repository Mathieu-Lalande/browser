import { app, ipcMain } from "electron";
import { Channels } from "@shared/ipc";
import type { UpdateStatus } from "@shared/updates";
import { onSettingsChanged, settings } from "../settings";
import { BrowserController } from "../window";
import { canSelfUpdate, createElectronUpdater } from "./electron-updater";
import { FakeUpdater, isFakeScenario } from "./fake";
import { UpdateService, type Updater } from "./service";

/**
 * Desktop auto-updates (ADR-030). Real updates only in a packaged app, unless started with
 * `--disable-updates` (the packaging smoke test). In development the updater is off, except for
 * the scripted fake of `BROWSER_TEST_UPDATER` (e2e), a test hook a packaged app ignores (ADR-018).
 */

const TEST_SCENARIO = !app.isPackaged ? process.env.BROWSER_TEST_UPDATER : undefined;

let service: UpdateService | null = null;
const listeners = new Set<(status: UpdateStatus) => void>();

export function updateService(): UpdateService | null {
  return service;
}

export function onUpdateStatus(listener: (status: UpdateStatus) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

async function pickUpdater(): Promise<{ updater: Updater | null; canInstall: boolean }> {
  if (isFakeScenario(TEST_SCENARIO)) return { updater: new FakeUpdater(TEST_SCENARIO), canInstall: TEST_SCENARIO !== "manual" };
  if (!app.isPackaged || app.commandLine.hasSwitch("disable-updates")) return { updater: null, canInstall: false };
  try {
    return { updater: await createElectronUpdater(), canInstall: await canSelfUpdate() };
  } catch (error) {
    console.warn("[updates] updater unavailable:", error);
    return { updater: null, canInstall: false };
  }
}

function broadcast(status: UpdateStatus): void {
  for (const controller of BrowserController.all()) controller.send(Channels.updatesChanged, status);
  for (const listener of listeners) listener(status);
}

/** Starts the updater (after the first window) and its IPC. */
export async function startUpdates(): Promise<void> {
  const known = (event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent) => Boolean(BrowserController.fromUi(event.sender));
  // Registered first: the UI may ask before the updater is ready.
  ipcMain.handle(Channels.updatesStatus, (event) => {
    if (!known(event)) throw new Error(`Rejected ${Channels.updatesStatus}`);
    return service?.status ?? null;
  });
  ipcMain.on(Channels.updatesCheck, (event) => {
    if (known(event)) void service?.check();
  });
  ipcMain.on(Channels.updatesDownload, (event) => {
    if (known(event)) void service?.download();
  });
  ipcMain.on(Channels.updatesInstall, (event) => {
    if (known(event)) installUpdate();
  });

  const { updater, canInstall } = await pickUpdater();
  service = new UpdateService({
    updater,
    currentVersion: app.getVersion(),
    canInstall,
    preferences: settings().updates,
    onStatus: broadcast,
    // The fake waits for "Rechercher des mises à jour": e2e tests drive every state themselves.
    ...(TEST_SCENARIO ? { startupDelayMs: 60 * 60 * 1000 } : {}),
  });
  onSettingsChanged((current) => service?.setPreferences(current.updates));
  broadcast(service.status);
  service.start();
}

/** "Redémarrer pour mettre à jour" (settings, sidebar, menu). */
export function installUpdate(): void {
  service?.install();
}

export function checkForUpdates(): void {
  void service?.check();
}
