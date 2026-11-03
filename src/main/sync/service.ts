import { hostname } from "node:os";
import { join } from "node:path";
import { Notification, app, net } from "electron";
import { SyncController, type SyncPlatform, type SyncStatus } from "@shared/sync/controller";
import { fetchTransport } from "@shared/sync/client";
import type { CollectionAdapter, SyncState } from "@shared/sync/engine";
import type { SyncedTab } from "@shared/sync/records";
import { Emitter } from "@shared/emitter";
import type { WindowDirectory } from "../ports";
import { persistentWindows } from "../private-guards";
import { JsonFile } from "../storage/json-file";
import { credentialsStore } from "./credentials";
import { nodeRandomBytes } from "./random";

const SYNC_STATE_VERSION = 1;
/** Test hooks: faster debounce and periodic sync (e2e); ignored once packaged (ADR-018). */
const TEST_DEBOUNCE_MS = (!app.isPackaged && Number(process.env.BROWSER_TEST_SYNC_DEBOUNCE_MS)) || undefined;
const TEST_INTERVAL_MS = (!app.isPackaged && Number(process.env.BROWSER_TEST_SYNC_INTERVAL_MS)) || undefined;

/** What the sync service uses of the shared controller (a fake in tests). */
export type SyncControllerLike = Pick<
  SyncController,
  "init" | "getStatus" | "notifyChange" | "dismissReceivedTab" | "dispose" | "createAccount" | "pair" | "pairingCode" | "syncNow" | "sendTab" | "disconnect" | "reset"
>;

export interface SyncServiceDeps {
  /** The profile folder (`sync.json`, `sync-credentials.json`). */
  userData: string;
  windows: WindowDirectory;
  /** Local changes to the synced collections (the profile's change events). */
  onLocalChange(listener: () => void): () => void;
  /** The synced collections, built once with the controller. */
  adapters(): CollectionAdapter[];
  /** Builds the controller from the desktop platform (default: the shared `SyncController`). */
  createController?: (platform: SyncPlatform) => SyncControllerLike;
}

/**
 * Desktop sync service (ADR-019): the shared `SyncController` wired to the profile, Electron's
 * network stack (system proxy and certificates) and the OS keychain. Off until the user sets up
 * an account or pairs this device: no server is ever contacted before that.
 */
export class SyncService {
  private readonly statuses = new Emitter<SyncStatus>();
  private sync: SyncControllerLike | null = null;
  private stateFile: JsonFile<unknown> | null = null;
  /** Set while remote changes are applied: they must not schedule another sync. */
  private applying = false;
  /** Received tabs already opened (ADR-033). */
  private readonly handled = new Set<string>();
  private stops: (() => void)[] = [];

  constructor(private readonly deps: SyncServiceDeps) {}

  /** The shared controller, built on first use (nothing is contacted until `init` finds an account). */
  get controller(): SyncControllerLike {
    return (this.sync ??= this.build());
  }

  onStatus(listener: (status: SyncStatus) => void): () => void {
    return this.statuses.on(listener);
  }

  /** Starts sync (if configured) and listens to local changes. Call once the profile is open. */
  start(): void {
    if (this.stops.length) return;
    const sync = this.controller;
    this.stops.push(
      this.deps.onLocalChange(() => {
        if (!this.applying) sync.notifyChange();
      }),
      this.statuses.on((status) => this.openReceivedTabs(status)),
    );
    void sync.init();
  }

  /** The app is quitting: no more listening, timers cleared, the sync state written. */
  stop(): void {
    for (const stop of this.stops.splice(0)) stop();
    this.sync?.dispose();
    this.stateFile?.flush();
  }

  private build(): SyncControllerLike {
    const dir = this.deps.userData;
    const stateFile = (this.stateFile = new JsonFile<unknown>({
      path: join(dir, "sync.json"),
      version: SYNC_STATE_VERSION,
      parse: (data) => (typeof data === "object" && data !== null ? data : null),
      debounceMs: 1000,
    }));
    const secrets = credentialsStore(dir);
    const adapters = this.deps.adapters();
    const create = this.deps.createController ?? ((platform) => new SyncController(platform));
    return create({
      transport: fetchTransport((url, init) => net.fetch(url, { ...init, redirect: "error" })),
      rng: nodeRandomBytes,
      kind: "desktop",
      deviceName: () => hostname() || "Ordinateur",
      localTabs: () => this.localTabs(),
      adapters: () => adapters.map((adapter) => ({ ...adapter, apply: (changes) => this.applyingRemote(() => adapter.apply(changes)) })),
      loadCredentials: async () => secrets.load(),
      saveCredentials: async (credentials) => secrets.save(credentials),
      loadState: async () => stateFile.load(),
      saveState: (state: SyncState | null) => {
        stateFile.scheduleSave(() => state ?? {});
        if (!state) stateFile.flush();
      },
      onStatus: (status) => this.statuses.emit(status),
      debounceMs: TEST_DEBOUNCE_MS,
      intervalMs: TEST_INTERVAL_MS,
    });
  }

  private async applyingRemote(apply: () => void | Promise<void>): Promise<void> {
    this.applying = true;
    try {
      await apply();
    } finally {
      this.applying = false;
    }
  }

  /** Open tabs of the normal windows (every space), never those of private windows. */
  private localTabs(): SyncedTab[] {
    const tabs: SyncedTab[] = [];
    for (const window of persistentWindows(this.deps.windows.all())) {
      for (const space of window.spaces.snapshot().spaces) {
        for (const tab of space.tabs) tabs.push({ url: tab.url, title: tab.title });
      }
    }
    return tabs;
  }

  /**
   * Tabs other devices sent here (ADR-033) open in the background in a normal window (the focused
   * one, else the first), never a private one; each is then deleted from the account.
   */
  private openReceivedTabs(status: SyncStatus): void {
    for (const tab of status.received) {
      if (this.handled.has(tab.id)) continue;
      const windows = persistentWindows(this.deps.windows.all());
      const focused = this.deps.windows.focused();
      const target = focused && !focused.isPrivate ? focused : windows[0];
      if (!target) return;
      this.handled.add(tab.id);
      target.tabs.create(tab.url, { activate: false });
      if (Notification.isSupported()) new Notification({ title: `Onglet reçu de ${tab.fromName}`, body: tab.title || tab.url, silent: true }).show();
      // Outside the status listener: dismissing publishes a new status.
      queueMicrotask(() => this.controller.dismissReceivedTab(tab.id));
    }
  }
}
