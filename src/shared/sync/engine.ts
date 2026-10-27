import { randomBytesChecked, toHex, type RandomBytes } from "./bytes";
import { SyncClient, SyncError, type Transport } from "./client";
import { deriveKeys, open, recordId, seal, type SyncKeys } from "./crypto";
import { hashValue } from "./hash";
import { compareHlc, createClock, decodeHlc, encodeHlc, isDeviceId, isHlc, receive, tick, type Hlc } from "./hlc";
import { fromBase64Url } from "./bytes";
import type { SyncCredentials } from "./pairing";
import { MAX_BATCH_RECORDS, MAX_BODY_BYTES, type PushRecord } from "./protocol";
import type { CollectionName, RemoteDevice } from "./records";

/**
 * The sync engine (ADR-019): per-record last-writer-wins with hybrid logical clock timestamps,
 * tombstones for deletions, incremental pull since the last server version, then push of local
 * changes with optimistic concurrency. Pure: storage, HTTP and randomness are injected, and the
 * same code runs on the desktop (Electron main) and the phone (Hermes).
 *
 * Local changes are found by comparing each collection's current content with a *mirror* of what
 * was last synced (hash per record), so the apps do not have to report every mutation; they only
 * say "something changed" to get a sync scheduled sooner.
 */

/** What the engine remembers about one record. */
export interface MirrorItem {
  /** Server record id (HMAC of the local id). */
  rid: string;
  /** Timestamp of the version held (local pending change, or the last one synced). */
  hlc: string;
  /** Hash of the data ("" for a tombstone). */
  hash: string;
  deleted?: true;
  /** Local change not yet on the server. */
  pending?: true;
  /** Left the local sync window (old history): to be removed from the server, then forgotten. */
  expired?: true;
  /** Server version of the record when last seen (0: never seen). */
  base: number;
}

export interface CollectionState {
  /** Pull from here next time. */
  cursor: number;
  items: Record<string, MirrorItem>;
}

/** Persisted engine state (not secret: no keys, no plaintext beyond local ids). */
export interface SyncState {
  version: 1;
  /** This device's id in timestamps and in the devices list. */
  deviceId: string;
  /** Account and key the mirror belongs to: anything else starts over. */
  accountId: string;
  keyFingerprint: string;
  clock: string;
  lastSync: number | null;
  collections: Partial<Record<CollectionName, CollectionState>>;
  /** The account's other devices as last received (validated again when read). */
  devices?: Record<string, RemoteDevice>;
}

export interface RecordChange<T> {
  id: string;
  data: T;
  /** Wall time of the remote change (epoch ms). */
  modified: number;
}

/** Bridge between the engine and one kind of local data. */
export interface CollectionAdapter<T = unknown> {
  readonly name: CollectionName;
  /** Current local records in sync scope, by local id. Must be deterministic for unchanged data. */
  snapshot(): Map<string, T>;
  /** Whether a record missing from the snapshot still exists locally, out of scope (expired, not deleted). */
  exists?(localId: string): boolean;
  /** Validates data decrypted from another device; null rejects it. */
  sanitize(value: unknown, localId: string): T | null;
  /** Applies remote winners locally (they must not be reported back as local changes). */
  apply(changes: { upserts: RecordChange<T>[]; deletes: string[] }): void | Promise<void>;
}

export interface SyncReport {
  pulled: number;
  pushed: number;
  /** Records skipped: undecryptable, invalid or misplaced. */
  rejected: number;
}

export interface SyncEngineOptions {
  transport: Transport;
  rng: RandomBytes;
  credentials: SyncCredentials;
  state: SyncState;
  adapters: readonly CollectionAdapter[];
  now?: () => number;
  /** Called whenever the state should be persisted. */
  persist?: (state: SyncState) => void;
}

/** Retries of pull+push after a 409 before giving up for this round. */
const MAX_CONFLICT_RETRIES = 3;
/** Synced tombstones are forgotten locally after this long. */
const TOMBSTONE_TTL_MS = 180 * 24 * 60 * 60 * 1000;

export function keyFingerprint(credentials: SyncCredentials): string {
  return deriveKeys(fromBase64Url(credentials.syncKey)).fingerprint;
}

export function newDeviceId(rng: RandomBytes): string {
  return toHex(randomBytesChecked(rng, 8));
}

/** A fresh state for `credentials` (keeping the device id when there is one). */
export function createSyncState(credentials: SyncCredentials, rng: RandomBytes, deviceId?: string): SyncState {
  return {
    version: 1,
    deviceId: deviceId && isDeviceId(deviceId) ? deviceId : newDeviceId(rng),
    accountId: credentials.accountId,
    keyFingerprint: keyFingerprint(credentials),
    clock: "",
    lastSync: null,
    collections: {},
  };
}

function isMirrorItem(value: unknown): value is MirrorItem {
  if (typeof value !== "object" || value === null) return false;
  const m = value as Record<string, unknown>;
  return typeof m.rid === "string" && isHlc(m.hlc) && typeof m.hash === "string" && typeof m.base === "number";
}

/** Validates a stored state; a state for other credentials (or garbage) gives a fresh one. */
export function loadSyncState(value: unknown, credentials: SyncCredentials, rng: RandomBytes): SyncState {
  const v = (typeof value === "object" && value !== null ? value : {}) as Partial<SyncState>;
  const deviceId = typeof v.deviceId === "string" ? v.deviceId : undefined;
  if (v.version !== 1 || v.accountId !== credentials.accountId || v.keyFingerprint !== keyFingerprint(credentials) || !deviceId || !isDeviceId(deviceId)) {
    return createSyncState(credentials, rng, deviceId);
  }
  const collections: SyncState["collections"] = {};
  for (const [name, collection] of Object.entries(v.collections ?? {}) as [CollectionName, CollectionState][]) {
    if (typeof collection?.cursor !== "number" || typeof collection.items !== "object" || collection.items === null) continue;
    const items: Record<string, MirrorItem> = {};
    for (const [id, item] of Object.entries(collection.items)) if (isMirrorItem(item)) items[id] = item;
    collections[name] = { cursor: collection.cursor, items };
  }
  return {
    version: 1,
    deviceId,
    accountId: credentials.accountId,
    keyFingerprint: v.keyFingerprint,
    clock: isHlc(v.clock) ? v.clock : "",
    lastSync: typeof v.lastSync === "number" ? v.lastSync : null,
    collections,
    devices: typeof v.devices === "object" && v.devices !== null ? v.devices : {},
  };
}

interface Plain {
  v: 1;
  id: string;
  hlc: string;
  deleted?: true;
  data?: unknown;
}

function parsePlain(text: string): Plain | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const p = value as Record<string, unknown>;
  if (p.v !== 1 || typeof p.id !== "string" || p.id.length > 4096 || !isHlc(p.hlc)) return null;
  return p.deleted === true ? { v: 1, id: p.id, hlc: p.hlc, deleted: true } : { v: 1, id: p.id, hlc: p.hlc, data: p.data };
}

export class SyncEngine {
  readonly state: SyncState;
  private readonly keys: SyncKeys;
  private readonly client: SyncClient;
  private readonly rng: RandomBytes;
  private readonly now: () => number;
  private readonly persist: (state: SyncState) => void;
  private readonly adapters: readonly CollectionAdapter[];
  private clock: Hlc;

  constructor(options: SyncEngineOptions) {
    this.state = options.state;
    this.keys = deriveKeys(fromBase64Url(options.credentials.syncKey));
    this.client = new SyncClient(options.transport, options.credentials);
    this.rng = options.rng;
    this.now = options.now ?? (() => Date.now());
    this.persist = options.persist ?? (() => {});
    this.adapters = options.adapters;
    this.clock = createClock(this.state.deviceId, this.state.clock || undefined);
  }

  /** One full round: every collection is pulled, merged, then pushed. */
  async sync(): Promise<SyncReport> {
    const report: SyncReport = { pulled: 0, pushed: 0, rejected: 0 };
    for (const adapter of this.adapters) await this.syncCollection(adapter, report);
    this.state.lastSync = this.now();
    this.save();
    return report;
  }

  /** Deletes one local record everywhere (e.g. this device's entry when it is disconnected). */
  async retire(name: CollectionName, localId: string): Promise<void> {
    const adapter = this.adapters.find((candidate) => candidate.name === name);
    const item = this.state.collections[name]?.items[localId];
    if (!adapter || !item || item.deleted) return;
    Object.assign(item, { deleted: true, hash: "", hlc: this.nextHlc(), pending: true });
    await this.push(adapter, this.state.collections[name]!, { pulled: 0, pushed: 0, rejected: 0 }, true);
  }

  private nextHlc(): string {
    this.clock = tick(this.clock, this.now());
    this.state.clock = encodeHlc(this.clock);
    return this.state.clock;
  }

  private save(): void {
    this.persist(this.state);
  }

  private async syncCollection(adapter: CollectionAdapter, report: SyncReport): Promise<void> {
    const initial = !this.state.collections[adapter.name];
    const collection = (this.state.collections[adapter.name] ??= { cursor: 0, items: {} });
    // First sync of a collection: the account's data wins, local-only records are added to it.
    if (!initial) this.scan(adapter, collection);
    for (let attempt = 0; ; attempt++) {
      await this.pull(adapter, collection, report);
      if (initial && attempt === 0) this.scan(adapter, collection);
      try {
        await this.push(adapter, collection, report);
        return;
      } catch (error) {
        if (!(error instanceof SyncError && error.kind === "conflict") || attempt >= MAX_CONFLICT_RETRIES) throw error;
      }
    }
  }

  /** Marks what changed locally since the last sync (new timestamps for changed records). */
  private scan(adapter: CollectionAdapter, collection: CollectionState): void {
    const snapshot = adapter.snapshot();
    const { items } = collection;
    for (const [id, data] of snapshot) {
      const hash = hashValue(data);
      const item = items[id];
      if (item && !item.deleted && !item.expired && item.hash === hash) continue;
      items[id] = { rid: item?.rid ?? recordId(this.keys, adapter.name, id), hlc: this.nextHlc(), hash, pending: true, base: item?.base ?? 0 };
    }
    const now = this.now();
    for (const [id, item] of Object.entries(items)) {
      if (snapshot.has(id)) continue;
      if (item.deleted) {
        // Old synced tombstones can be forgotten: every device had months to see them.
        if (!item.pending && now - (decodeHlc(item.hlc)?.wall ?? now) > TOMBSTONE_TTL_MS) delete items[id];
        continue;
      }
      if (item.expired) continue;
      if (adapter.exists?.(id)) {
        if (item.base === 0) delete items[id];
        else Object.assign(item, { expired: true, pending: true });
      } else {
        Object.assign(item, { deleted: true, hash: "", hlc: this.nextHlc(), pending: true });
        delete item.expired;
      }
    }
  }

  private async pull(adapter: CollectionAdapter, collection: CollectionState, report: SyncReport): Promise<void> {
    const { items } = collection;
    const byRid = new Map(Object.entries(items).map(([id, item]) => [item.rid, id]));
    const upserts = new Map<string, RecordChange<unknown>>();
    const deletes = new Set<string>();
    let cursor = collection.cursor;
    for (;;) {
      const page = await this.client.pull(adapter.name, cursor);
      let failures = 0;
      for (const record of page.records) {
        cursor = Math.max(cursor, record.version);
        if (record.payload === null) {
          // Removed from the server by a device whose window it left: not a deletion here.
          const id = byRid.get(record.id);
          if (id && items[id]) items[id].base = record.version;
          continue;
        }
        let plain: Plain | null = null;
        try {
          plain = parsePlain(open(this.keys, adapter.name, record.id, record.payload));
        } catch {
          plain = null;
        }
        // The id inside must hash to the id outside: a record cannot be moved to another key.
        if (!plain || recordId(this.keys, adapter.name, plain.id) !== record.id) {
          failures++;
          report.rejected++;
          continue;
        }
        const remote = decodeHlc(plain.hlc)!;
        this.clock = receive(this.clock, remote, this.now());
        this.state.clock = encodeHlc(this.clock);
        const item = items[plain.id];
        if (item && item.hlc === plain.hlc) {
          item.base = record.version;
          continue;
        }
        if (item && compareHlc(item.hlc, plain.hlc) > 0) {
          // Ours is newer (pending, or the server holds an older copy): ours goes up.
          item.base = record.version;
          item.pending = true;
          continue;
        }
        if (plain.deleted) {
          items[plain.id] = { rid: record.id, hlc: plain.hlc, hash: "", deleted: true, base: record.version };
          upserts.delete(plain.id);
          deletes.add(plain.id);
        } else {
          const data = adapter.sanitize(plain.data, plain.id);
          if (data === null) {
            report.rejected++;
            continue;
          }
          items[plain.id] = { rid: record.id, hlc: plain.hlc, hash: hashValue(data), base: record.version };
          deletes.delete(plain.id);
          upserts.set(plain.id, { id: plain.id, data, modified: remote.wall });
        }
        byRid.set(record.id, plain.id);
        report.pulled++;
      }
      // Nothing on a page could be read: another key (reset elsewhere) or tampering. Stop here,
      // cursor untouched, rather than skipping the account's data.
      if (page.records.length > 0 && failures === page.records.filter((record) => record.payload !== null).length && failures > 0) {
        throw new SyncError("crypto", "Les données du serveur ne peuvent pas être déchiffrées avec la clé de cet appareil");
      }
      if (!page.more) {
        cursor = Math.max(cursor, page.version);
        break;
      }
    }
    if (upserts.size || deletes.size) {
      await adapter.apply({ upserts: [...upserts.values()], deletes: [...deletes] });
      // The app may normalize what it stored: remember its form so it is not seen as a local change.
      const after = adapter.snapshot();
      for (const id of upserts.keys()) {
        const value = after.get(id);
        if (value !== undefined && items[id]) items[id].hash = hashValue(value);
      }
    }
    collection.cursor = cursor;
    this.save();
  }

  /** Sends pending changes, in batches; a 409 throws (the caller pulls and retries). */
  private async push(adapter: CollectionAdapter, collection: CollectionState, report: SyncReport, onlyDeletions = false): Promise<void> {
    const { items } = collection;
    const pending = Object.entries(items).filter(([, item]) => item.pending && (!onlyDeletions || item.deleted));
    if (pending.length === 0) return;
    const snapshot = onlyDeletions ? new Map<string, unknown>() : adapter.snapshot();
    const batches: { records: PushRecord[]; ids: string[] }[] = [];
    let batch: { records: PushRecord[]; ids: string[] } = { records: [], ids: [] };
    let size = 0;
    for (const [id, item] of pending) {
      let payload: string | null;
      if (item.expired) payload = null;
      else if (item.deleted) payload = this.seal(adapter.name, item.rid, { v: 1, id, hlc: item.hlc, deleted: true });
      else {
        const data = snapshot.get(id);
        if (data === undefined) {
          // Deleted locally since the scan.
          Object.assign(item, { deleted: true, hash: "", hlc: this.nextHlc() });
          payload = this.seal(adapter.name, item.rid, { v: 1, id, hlc: item.hlc, deleted: true });
        } else {
          const hash = hashValue(data);
          if (hash !== item.hash) Object.assign(item, { hash, hlc: this.nextHlc() });
          payload = this.seal(adapter.name, item.rid, { v: 1, id, hlc: item.hlc, data });
        }
      }
      const length = (payload?.length ?? 4) + 80;
      if (batch.records.length >= MAX_BATCH_RECORDS || size + length > MAX_BODY_BYTES * 0.8) {
        batches.push(batch);
        batch = { records: [], ids: [] };
        size = 0;
      }
      batch.records.push({ id: item.rid, base: item.base, payload });
      batch.ids.push(id);
      size += length;
    }
    if (batch.records.length) batches.push(batch);

    for (const { records, ids } of batches) {
      const response = await this.client.push(adapter.name, records);
      const versions = new Map(response.records.map((record) => [record.id, record.version]));
      for (const id of ids) {
        const item = items[id];
        if (!item) continue;
        item.base = versions.get(item.rid) ?? item.base;
        delete item.pending;
        if (item.expired) delete items[id];
      }
      // Nobody wrote in between: skip our own echo on the next pull.
      if (response.previous <= collection.cursor) collection.cursor = Math.max(collection.cursor, response.version);
      report.pushed += records.length;
      this.save();
    }
  }

  private seal(collection: string, rid: string, plain: Plain): string {
    return seal(this.keys, this.rng, collection, rid, JSON.stringify(plain));
  }
}
