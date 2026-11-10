import type { HttpRequest, HttpResponse, Transport } from "./client";
import { isCollectionName, isRecordId } from "./crypto";
import { MAX_BATCH_RECORDS, PAGE_SIZE, type WireRecord } from "./protocol";

interface MemoryAccount {
  /** Account-wide token of devices paired before ADR-056 (null once rotated, or for new accounts). */
  legacyToken: string | null;
  /** Per-device tokens by auth id (ADR-056). */
  devices: Map<string, string>;
  epoch: number;
  keyring: { epoch: number; wraps: Record<string, string> }[];
  version: number;
  collections: Map<string, Map<string, WireRecord>>;
}

/**
 * In-memory implementation of the relay protocol, for tests of the engine (Vitest) and of the
 * mobile adapters (Jest). Same rules as `server/`: bearer auth per device, per-account versions,
 * atomic batches with optimistic concurrency, key epochs and rotation (ADR-056). Not used by the apps.
 */
export class MemorySyncServer {
  private readonly accounts = new Map<string, MemoryAccount>();
  private nextId = 1;
  /** Every request seen (method + path), for assertions. */
  readonly log: string[] = [];
  /** When set, requests fail as if the network were down. */
  offline = false;
  /** Called before each POST batch is applied (lets a test interleave another write). */
  beforePush?: () => void;

  readonly transport: Transport = async (request) => {
    if (this.offline) throw new Error("Network down");
    return this.handle(request);
  };

  /** Everything stored, as text (to check that no plaintext reaches the server). */
  dump(): string {
    return JSON.stringify([...this.accounts.values()].map((account) => [...account.collections.entries()].map(([name, records]) => [name, [...records.values()]])));
  }

  /** Test helper: turns an account into one from before ADR-056 (one token shared by all devices). */
  makeLegacy(accountId: string, token: string): void {
    const account = this.accounts.get(accountId);
    if (account) account.legacyToken = token;
  }

  private id(): string {
    return (this.nextId++).toString(16).padStart(32, "0");
  }

  private newDevice(account: MemoryAccount): { authId: string; token: string } {
    const authId = this.id();
    const token = `token${authId}`.padEnd(40, "x");
    account.devices.set(authId, token);
    return { authId, token };
  }

  private handle(request: HttpRequest): HttpResponse {
    const url = new URL(request.url);
    const path = url.pathname.replace(/^.*?\/v1/, "");
    this.log.push(`${request.method} ${path}`);
    if (request.method === "POST" && path === "/accounts") {
      const accountId = this.id();
      const account: MemoryAccount = { legacyToken: null, devices: new Map(), epoch: 0, keyring: [], version: 0, collections: new Map() };
      this.accounts.set(accountId, account);
      return json(201, { accountId, ...this.newDevice(account) });
    }
    const auth = /^Bearer ([0-9a-f]{32})\.(\S+)$/.exec(request.headers.authorization ?? "");
    const account = auth ? this.accounts.get(auth[1]) : undefined;
    if (!auth || !account) return json(401, { error: "unauthorized" });
    const authId = [...account.devices.entries()].find(([, token]) => token === auth[2])?.[0] ?? (account.legacyToken === auth[2] ? null : undefined);
    if (authId === undefined) return json(401, { error: "unauthorized" });

    if (request.method === "DELETE" && path === "/account") {
      this.accounts.delete(auth[1]);
      return { status: 204, headers: {}, body: "" };
    }
    if (path === "/devices" && request.method === "POST") return json(201, this.newDevice(account));
    if (path === "/devices" && request.method === "GET") {
      const devices = [...account.devices.keys()].map((id) => ({ authId: id, createdAt: 0, pending: false }));
      return json(200, { epoch: account.epoch, self: authId, legacy: account.legacyToken !== null, devices });
    }
    if (path === "/devices/self" && request.method === "DELETE") {
      if (authId === null) return json(403, { error: "device token needed" });
      account.devices.delete(authId);
      return { status: 204, headers: {}, body: "" };
    }
    if (path === "/keyring" && request.method === "GET") {
      const since = Number(url.searchParams.get("since") ?? 0);
      const wraps = authId === null ? [] : account.keyring.filter((entry) => entry.epoch > since && entry.wraps[authId]).map((entry) => ({ epoch: entry.epoch, wrap: entry.wraps[authId] }));
      return json(200, { epoch: account.epoch, wraps });
    }
    if (path === "/keyring" && request.method === "POST") {
      if (authId === null) return json(403, { error: "device token needed" });
      const body = JSON.parse(request.body ?? "{}") as { epoch?: number; revoke?: string[]; wraps?: Record<string, string> };
      const revoke = body.revoke ?? [];
      const wraps = body.wraps ?? {};
      if (revoke.includes(authId)) return json(400, { error: "bad request" });
      const remaining = [...account.devices.keys()].filter((id) => !revoke.includes(id));
      if (body.epoch !== account.epoch + 1 || remaining.length !== Object.keys(wraps).length || !remaining.every((id) => typeof wraps[id] === "string")) {
        return json(409, { error: "conflict", epoch: account.epoch });
      }
      for (const id of revoke) account.devices.delete(id);
      account.legacyToken = null;
      account.epoch += 1;
      account.keyring.push({ epoch: account.epoch, wraps });
      account.collections = new Map();
      return json(200, { epoch: account.epoch });
    }

    const match = /^\/collections\/([^/]+)$/.exec(path);
    if (!match || !isCollectionName(match[1])) return json(404, { error: "not found" });
    if (Number(request.headers["x-sync-epoch"] ?? 0) !== account.epoch) return json(412, { error: "key rotated", epoch: account.epoch });
    const records = account.collections.get(match[1]) ?? new Map<string, WireRecord>();
    account.collections.set(match[1], records);
    const collectionVersion = () => Math.max(0, ...[...records.values()].map((record) => record.version));

    if (request.method === "GET") {
      const since = Number(url.searchParams.get("since") ?? 0);
      const limit = Math.min(Number(url.searchParams.get("limit") ?? PAGE_SIZE) || PAGE_SIZE, PAGE_SIZE);
      const newer = [...records.values()].filter((record) => record.version > since).sort((a, b) => a.version - b.version);
      const page = newer.slice(0, limit);
      const more = newer.length > limit;
      return json(200, { records: page, version: more ? page[page.length - 1].version : collectionVersion(), more });
    }
    if (request.method === "POST") {
      const body = JSON.parse(request.body ?? "{}") as { records?: { id: string; base: number; payload: string | null }[] };
      const batch = body.records ?? [];
      if (!Array.isArray(batch) || batch.length > MAX_BATCH_RECORDS || !batch.every((item) => isRecordId(item.id))) return json(400, { error: "bad request" });
      this.beforePush?.();
      const conflicts = batch
        .filter((item) => (records.get(item.id)?.version ?? 0) !== item.base)
        .map((item) => ({ id: item.id, version: records.get(item.id)?.version ?? 0 }));
      if (conflicts.length) return json(409, { conflicts });
      const previous = collectionVersion();
      const written = batch.map((item) => {
        const record: WireRecord = { id: item.id, version: ++account.version, modified: Date.now(), payload: item.payload };
        records.set(item.id, record);
        return { id: item.id, version: record.version };
      });
      return json(200, { version: collectionVersion(), previous, records: written });
    }
    return json(405, { error: "method not allowed" });
  }
}

function json(status: number, value: unknown): HttpResponse {
  return { status, headers: { "content-type": "application/json" }, body: JSON.stringify(value) };
}
