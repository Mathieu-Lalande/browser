import { hostname } from "node:os";
import { join } from "node:path";
import { app, net } from "electron";
import { SyncController, type SyncStatus } from "@shared/sync/controller";
import { fetchTransport } from "@shared/sync/client";
import type { SyncState } from "@shared/sync/engine";
import type { SyncedTab } from "@shared/sync/records";
import { persistentWindows } from "../private-guards";
import { profile } from "../profile";
import { JsonFile } from "../storage/json-file";
import { BrowserController } from "../window";
import { desktopAdapters } from "./adapters";
import { credentialsStore } from "./credentials";
import { nodeRandomBytes } from "./random";

/**
 * Desktop sync service (ADR-018): the shared `SyncController` wired to the profile, Electron's
 * network stack (system proxy and certificates) and the OS keychain. Off until the user sets up
 * an account or pairs this device: no server is ever contacted before that.
 */

const SYNC_STATE_VERSION = 1;
/** Test hooks: faster debounce and periodic sync (e2e). */
const TEST_DEBOUNCE_MS = Number(process.env.BROWSER_TEST_SYNC_DEBOUNCE_MS) || undefined;
const TEST_INTERVAL_MS = Number(process.env.BROWSER_TEST_SYNC_INTERVAL_MS) || undefined;

type Listener = (status: SyncStatus) => void;
const listeners = new Set<Listener>();
let controller: SyncController | null = null;
/** Set while remote changes are applied: they must not schedule another sync. */
let applying = false;

/** Open tabs of the normal windows (every space), never those of private windows. */
function localTabs(): SyncedTab[] {
  const tabs: SyncedTab[] = [];
  for (const window of persistentWindows(BrowserController.all())) {
    for (const space of window.spaces.snapshot().spaces) {
      for (const tab of space.tabs) tabs.push({ url: tab.url, title: tab.title });
    }
  }
  return tabs;
}

export function syncController(): SyncController {
  if (controller) return controller;
  const dir = app.getPath("userData");
  const stateFile = new JsonFile<unknown>({
    path: join(dir, "sync.json"),
    version: SYNC_STATE_VERSION,
    parse: (data) => (typeof data === "object" && data !== null ? data : null),
    debounceMs: 1000,
  });
  const secrets = credentialsStore(dir);
  const adapters = desktopAdapters();
  controller = new SyncController({
    transport: fetchTransport((url, init) => net.fetch(url, { ...init, redirect: "error" })),
    rng: nodeRandomBytes,
    kind: "desktop",
    deviceName: () => hostname() || "Ordinateur",
    localTabs,
    adapters: () =>
      adapters.map((adapter) => ({
        ...adapter,
        apply: async (changes) => {
          applying = true;
          try {
            await adapter.apply(changes);
          } finally {
            applying = false;
          }
        },
      })),
    loadCredentials: async () => secrets.load(),
    saveCredentials: async (credentials) => secrets.save(credentials),
    loadState: async () => stateFile.load(),
    saveState: (state: SyncState | null) => {
      stateFile.scheduleSave(() => state ?? {});
      if (!state) stateFile.flush();
    },
    onStatus: (status) => {
      for (const listener of listeners) listener(status);
    },
    debounceMs: TEST_DEBOUNCE_MS,
    intervalMs: TEST_INTERVAL_MS,
  });
  app.on("will-quit", () => stateFile.flush());
  return controller;
}

/** Starts sync (if configured) and listens to local changes. Call once the profile is open. */
export function startSync(): void {
  const sync = syncController();
  profile().onChange(() => {
    if (!applying) sync.notifyChange();
  });
  void sync.init();
}

export function onSyncStatus(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
