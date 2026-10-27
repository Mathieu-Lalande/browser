import { toBase64Url, type RandomBytes } from "./bytes";
import { SyncClient, SyncError, type SyncErrorKind, type Transport } from "./client";
import { generateSyncKey } from "./crypto";
import { SyncEngine, createSyncState, keyFingerprint, loadSyncState, type CollectionAdapter, type SyncState } from "./engine";
import { decodeHlc } from "./hlc";
import { decodePairingCode, encodePairingCode, normalizeServerUrl, type SyncCredentials } from "./pairing";
import { clientRecord, sanitizeSyncedClient, type RemoteDevice, type SyncedClient, type SyncedTab } from "./records";

/**
 * Sync lifecycle shared by both apps: account creation, pairing, scheduling (startup, local
 * changes debounced, periodic, foreground), retries with backoff, disconnect and reset. The
 * platform supplies storage, HTTP, randomness and the local data adapters.
 */

export type SyncPhase = "off" | "idle" | "syncing" | "error" | "offline";

export interface SyncStatus {
  phase: SyncPhase;
  /** A sync account is configured on this device. */
  configured: boolean;
  serverUrl: string | null;
  deviceId: string | null;
  deviceName: string;
  /** Last successful sync (epoch ms). */
  lastSync: number | null;
  error: { kind: SyncErrorKind; message: string } | null;
  /** Next automatic attempt after a failure (epoch ms). */
  retryAt: number | null;
  /** 8 hex characters identifying the sync key (same on every paired device). */
  keyFingerprint: string | null;
  /** The account's other devices, with their open tabs. */
  devices: RemoteDevice[];
}

export interface SyncPlatform {
  transport: Transport;
  rng: RandomBytes;
  kind: SyncedClient["kind"];
  deviceName(): string;
  /** Open tabs of this device, private ones excluded. */
  localTabs(): SyncedTab[];
  /** Adapters for the other collections (settings, spaces, bookmarks, history). */
  adapters(): CollectionAdapter[];
  /** Secret storage (OS keychain where available). */
  loadCredentials(): Promise<SyncCredentials | null>;
  saveCredentials(credentials: SyncCredentials | null): Promise<void>;
  loadState(): Promise<unknown>;
  saveState(state: SyncState | null): void;
  onStatus(status: SyncStatus): void;
  now?: () => number;
  /** Delay before syncing after a local change (default 5 s). */
  debounceMs?: number;
  /** Periodic sync (default 5 min). */
  intervalMs?: number;
}

const DEFAULT_DEBOUNCE_MS = 5_000;
const DEFAULT_INTERVAL_MS = 5 * 60_000;
const BACKOFF_BASE_MS = 15_000;
const BACKOFF_MAX_MS = 15 * 60_000;

/** Errors that need the user (pair again): no automatic retry. */
const FATAL: ReadonlySet<SyncErrorKind> = new Set(["auth", "crypto"]);

export function backoffDelay(failures: number): number {
  return Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, failures - 1));
}

export class SyncController {
  private credentials: SyncCredentials | null = null;
  private state: SyncState | null = null;
  private engine: SyncEngine | null = null;
  private running: Promise<void> | null = null;
  private again = false;
  private failures = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private timerAt = 0;
  /** First local change not synced yet (debounce cap). */
  private changedSince: number | null = null;
  private disposed = false;
  private status: SyncStatus;

  constructor(private readonly platform: SyncPlatform) {
    this.status = this.idleStatus();
  }

  private now(): number {
    return this.platform.now?.() ?? Date.now();
  }

  getStatus(): SyncStatus {
    return this.status;
  }

  /** Loads the saved account, then syncs (startup). */
  async init(): Promise<void> {
    const credentials = await this.platform.loadCredentials().catch(() => null);
    if (!credentials) return this.publish({ phase: "off" });
    this.attach(credentials, await this.platform.loadState().catch(() => null));
    this.publish({});
    this.schedule(0);
  }

  /** First device: creates an account on `serverUrl` with a new random sync key. */
  async createAccount(serverUrl: string, registrationSecret?: string): Promise<void> {
    const base = normalizeServerUrl(serverUrl);
    if (!base) throw new SyncError("protocol", "Adresse de serveur invalide : https:// obligatoire (http:// seulement en réseau local)");
    const account = await SyncClient.createAccount(this.platform.transport, base, registrationSecret);
    const credentials: SyncCredentials = { serverUrl: base, ...account, syncKey: toBase64Url(generateSyncKey(this.platform.rng)) };
    await this.connect(credentials);
  }

  /** Other devices: joins the account of a pairing code (QR code or pasted text). */
  async pair(code: string): Promise<void> {
    const credentials = decodePairingCode(code);
    if (!credentials) throw new SyncError("protocol", "Code de jumelage invalide");
    await this.connect(credentials);
  }

  /** The pairing code of this account (full access: shown only on explicit request). */
  pairingCode(): string | null {
    return this.credentials ? encodePairingCode(this.credentials) : null;
  }

  /** Sync now (button, startup, foreground). */
  syncNow(): Promise<void> {
    if (!this.credentials) return Promise.resolve();
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.clearTimer();
    this.changedSince = null;
    this.running = this.run().finally(() => {
      this.running = null;
      if (this.again && !this.disposed) {
        this.again = false;
        void this.syncNow();
      }
    });
    return this.running;
  }

  /** Something changed locally: sync a little later (debounced). */
  notifyChange(): void {
    if (!this.credentials || this.status.error && FATAL.has(this.status.error.kind)) return;
    if (this.failures > 0 && this.timer) return; // keep the backoff
    const debounce = this.platform.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    // Constant activity must not postpone the sync forever: at most 6 debounce periods.
    const now = this.now();
    if (this.changedSince === null || !this.timer) this.changedSince = now;
    if (now - this.changedSince > debounce * 6 && this.timer && this.timerAt <= now + debounce) return;
    this.schedule(debounce, now - this.changedSince <= debounce * 6);
  }

  /** The app came back to the foreground (mobile). */
  notifyForeground(): void {
    if (!this.credentials) return;
    const last = this.status.lastSync ?? 0;
    if (this.now() - last > 30_000) this.schedule(0);
  }

  /** "Déconnecter cet appareil": removes this device from the list, forgets the account here. */
  async disconnect(): Promise<void> {
    const engine = this.engine;
    if (engine && this.state) await engine.retire("clients", this.state.deviceId).catch(() => {});
    await this.forget();
  }

  /**
   * "Réinitialiser la synchronisation": erases the account on the server and starts a new one
   * with a new key on the same server. Every other device is disconnected (its token no longer
   * works) and must be paired again; local data stays on each device.
   */
  async reset(): Promise<void> {
    const credentials = this.credentials;
    if (!credentials) return;
    await new SyncClient(this.platform.transport, credentials).deleteAccount();
    await this.forget();
    await this.createAccount(credentials.serverUrl);
  }

  dispose(): void {
    this.disposed = true;
    this.clearTimer();
  }

  // --- Internals --------------------------------------------------------------------------------

  private async connect(credentials: SyncCredentials): Promise<void> {
    // Probe first: a wrong code or server must not replace a working setup.
    await new SyncClient(this.platform.transport, credentials).pull("clients", 0, 1);
    const previous = this.state?.deviceId;
    await this.platform.saveCredentials(credentials);
    this.attach(credentials, null, previous);
    this.platform.saveState(this.state);
    this.failures = 0;
    this.publish({ error: null });
    await this.syncNow();
  }

  private async forget(): Promise<void> {
    this.clearTimer();
    this.credentials = null;
    this.engine = null;
    this.state = null;
    this.failures = 0;
    await this.platform.saveCredentials(null);
    this.platform.saveState(null);
    this.status = this.idleStatus();
    this.publish({ phase: "off" });
  }

  private attach(credentials: SyncCredentials, savedState: unknown, deviceId?: string): void {
    this.credentials = credentials;
    this.state = savedState ? loadSyncState(savedState, credentials, this.platform.rng) : createSyncState(credentials, this.platform.rng, deviceId);
    this.engine = null;
  }

  private buildEngine(): SyncEngine {
    const state = this.state!;
    return new SyncEngine({
      transport: this.platform.transport,
      rng: this.platform.rng,
      credentials: this.credentials!,
      state,
      adapters: [...this.platform.adapters(), this.clientsAdapter(state)],
      now: () => this.now(),
      persist: (current) => this.platform.saveState(current),
    });
  }

  /** Devices: this one's record comes from its tabs, the others' are kept as received. */
  private clientsAdapter(state: SyncState): CollectionAdapter<SyncedClient> {
    return {
      name: "clients",
      snapshot: () => {
        const map = new Map<string, SyncedClient>();
        for (const device of this.remoteDevices(state)) map.set(device.id, { name: device.name, kind: device.kind, tabs: device.tabs });
        map.set(state.deviceId, clientRecord(this.platform.deviceName(), this.platform.kind, this.platform.localTabs()));
        return map;
      },
      sanitize: (value) => sanitizeSyncedClient(value),
      apply: ({ upserts, deletes }) => {
        const devices = state.devices ?? {};
        for (const { id, data, modified } of upserts) {
          if (id !== state.deviceId) devices[id] = { id, name: data.name, kind: data.kind, tabs: data.tabs, updatedAt: modified };
        }
        for (const id of deletes) delete devices[id];
        state.devices = devices;
      },
    };
  }

  private remoteDevices(state: SyncState | null): RemoteDevice[] {
    const devices = state?.devices ?? {};
    const list: RemoteDevice[] = [];
    for (const [id, value] of Object.entries(devices)) {
      const record = sanitizeSyncedClient(value);
      const updatedAt = (value as { updatedAt?: unknown }).updatedAt;
      if (record && id !== state?.deviceId) {
        list.push({ id, ...record, updatedAt: typeof updatedAt === "number" ? updatedAt : (decodeHlc(state?.collections.clients?.items[id]?.hlc)?.wall ?? 0) });
      }
    }
    return list.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  private async run(): Promise<void> {
    if (!this.credentials || !this.state) return;
    this.publish({ phase: "syncing" });
    try {
      this.engine ??= this.buildEngine();
      await this.engine.sync();
      this.failures = 0;
      this.publish({ phase: "idle", error: null, retryAt: null });
      this.schedule(this.platform.intervalMs ?? DEFAULT_INTERVAL_MS);
    } catch (error) {
      const syncError = error instanceof SyncError ? error : new SyncError("protocol", error instanceof Error ? error.message : String(error));
      // A partly built engine state is still valid; a fresh engine is built next time anyway.
      this.engine = null;
      this.failures++;
      if (FATAL.has(syncError.kind)) {
        this.publish({ phase: "error", error: { kind: syncError.kind, message: syncError.message }, retryAt: null });
        return;
      }
      const delay = Math.max(syncError.retryAfterMs ?? 0, backoffDelay(this.failures));
      this.publish({
        phase: syncError.kind === "offline" ? "offline" : "error",
        error: { kind: syncError.kind, message: syncError.message },
        retryAt: this.now() + delay,
      });
      this.schedule(delay);
    }
  }

  /** Arms the single timer; `replace` lets a later debounce push an earlier one back. */
  private schedule(delayMs: number, replace = false): void {
    if (this.disposed || !this.credentials) return;
    const at = this.now() + delayMs;
    if (this.timer && !replace && this.timerAt <= at) return;
    this.clearTimer();
    this.timerAt = at;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.syncNow();
    }, delayMs);
    (this.timer as { unref?: () => void }).unref?.();
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private idleStatus(): SyncStatus {
    return {
      phase: "off",
      configured: false,
      serverUrl: null,
      deviceId: null,
      deviceName: this.platform.deviceName(),
      lastSync: null,
      error: null,
      retryAt: null,
      keyFingerprint: null,
      devices: [],
    };
  }

  private publish(patch: Partial<SyncStatus>): void {
    const configured = this.credentials !== null;
    this.status = {
      ...this.status,
      phase: configured ? (this.status.phase === "off" ? "idle" : this.status.phase) : "off",
      ...patch,
      configured,
      serverUrl: this.credentials?.serverUrl ?? null,
      deviceId: this.state?.deviceId ?? null,
      deviceName: this.platform.deviceName(),
      lastSync: this.state?.lastSync ?? null,
      keyFingerprint: this.credentials ? keyFingerprint(this.credentials) : null,
      devices: this.remoteDevices(this.state),
    };
    if (!configured) this.status.phase = "off";
    this.platform.onStatus(this.status);
  }
}
