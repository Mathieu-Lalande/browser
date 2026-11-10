import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { RateLimiter } from "./rate-limit.js";
import { FileStore, type Account, type StoredRecord } from "./store.js";

/**
 * The sync relay (ADR-019). It stores opaque, end-to-end encrypted records for accounts and
 * never sees keys or plaintext. Protocol (also in `src/shared/sync/protocol.ts`):
 *
 *   POST   /v1/accounts                         → 201 { accountId, token, authId }
 *   GET    /v1/collections/:name?since=&limit=  → { records, version, more }
 *   POST   /v1/collections/:name { records }    → { version, previous, records } | 409 { conflicts }
 *   DELETE /v1/account                          → 204
 *   GET    /v1/devices                          → { epoch, self, legacy, devices: [{ authId, createdAt, pending }] }
 *   POST   /v1/devices                          → 201 { authId, token }   (a pairing token, ADR-056)
 *   DELETE /v1/devices/self                     → 204
 *   GET    /v1/keyring?since=<epoch>            → { epoch, wraps: [{ epoch, wrap }] }   (the caller's only)
 *   POST   /v1/keyring { epoch, revoke, wraps } → { epoch } | 409   (rotation: revokes, wipes the data)
 *
 * Every device has its own token (ADR-056); collection requests carry `X-Sync-Epoch` (the key
 * generation the device encrypts with) and get 412 when the key was rotated since.
 *   GET    /healthz                             → 200
 *   POST   /crash (multipart minidump, opt-in)  → 200 <report id>      (ADR-043, `crashReports`)
 *
 * Native clients only: no CORS, and any request carrying an `Origin` header (a web page) is refused.
 * TLS is expected from a reverse proxy (Caddy, Fly.io, Render…).
 */

export interface ServerOptions {
  dataDir: string;
  /** When set, creating an account needs `X-Registration-Secret: <value>`. */
  registrationSecret?: string;
  /** Use `X-Forwarded-For` for rate limiting (behind a trusted reverse proxy only). */
  trustProxy?: boolean;
  /** Requests per minute per client address (default 300). */
  requestsPerMinute?: number;
  /** Accounts created per hour per client address (default 10). */
  accountsPerHour?: number;
  /** Max stored payload per account, in characters (default 64 MB). */
  maxAccountBytes?: number;
  /** Max request body, bytes (default 2 MB). */
  maxBodyBytes?: number;
  /**
   * ADR-043: accept crash reports (Crashpad's multipart minidump uploads) on `POST /crash`, stored
   * under `<dataDir>/crashes`. No authentication: limited by size, rate and count instead.
   */
  crashReports?: boolean;
  /** Max crash report, bytes (default 8 MB). */
  maxCrashBytes?: number;
  /** Crash reports per hour per client address (default 20). */
  crashesPerHour?: number;
  /** Crash reports kept; the oldest go first (default 500). */
  maxStoredCrashes?: number;
  now?: () => number;
  log?: (line: string) => void;
}

const MAX_BATCH = 200;
const MAX_PAYLOAD = 256 * 1024;
const PAGE_SIZE = 500;
const MAX_COLLECTIONS = 16;
const COLLECTION = /^[a-z]{1,32}$/;
const RECORD_ID = /^[0-9a-f]{32}$/;
const AUTH = /^Bearer ([0-9a-f]{32})\.([A-Za-z0-9_-]{32,128})$/;
const AUTH_ID = /^[0-9a-f]{32}$/;
const WRAP = /^[A-Za-z0-9_-]{40,200}$/;
/** Devices (tokens) per account, pending pairing tokens included. */
const MAX_DEVICES = 32;
/** A pairing token nobody used within this delay stops working. */
export const PAIRING_TTL_MS = 60 * 60 * 1000;
/** Rotations kept for devices that were offline through several. */
const KEYRING_KEPT = 16;

interface Caller {
  account: Account;
  /** The device's auth id; null for the legacy account-wide token. */
  authId: string | null;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly headers: Record<string, string> = {},
    readonly body?: unknown,
  ) {
    super(message);
  }
}

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

function send(res: ServerResponse, status: number, body?: unknown, headers: Record<string, string> = {}): void {
  const text = body === undefined ? "" : JSON.stringify(body);
  res.writeHead(status, {
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    ...(body === undefined ? {} : { "content-type": "application/json; charset=utf-8" }),
    ...headers,
  });
  res.end(text);
}

function readBody(req: IncomingMessage, limit: number): Promise<string> {
  return readRaw(req, limit).then((body) => body.toString("utf8"));
}

function readRaw(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers["content-length"]);
    if (Number.isFinite(declared) && declared > limit) return reject(new HttpError(413, "Payload too large"));
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        reject(new HttpError(413, "Payload too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new HttpError(400, "Invalid JSON");
  }
}

const collectionVersion = (records: Record<string, StoredRecord>) => {
  let max = 0;
  for (const record of Object.values(records)) max = Math.max(max, record.version);
  return max;
};

export function createSyncServer(options: ServerOptions): { server: Server; store: FileStore } {
  const store = new FileStore(options.dataDir);
  const now = options.now ?? Date.now;
  const log = options.log ?? (() => {});
  const requests = new RateLimiter(options.requestsPerMinute ?? 300, 60_000, now);
  const signups = new RateLimiter(options.accountsPerHour ?? 10, 3_600_000, now);
  const maxAccountBytes = options.maxAccountBytes ?? 64 * 1024 * 1024;
  const maxBody = options.maxBodyBytes ?? 2 * 1024 * 1024;
  const crashes = new RateLimiter(options.crashesPerHour ?? 20, 3_600_000, now);
  const crashDir = join(options.dataDir, "crashes");

  const clientAddress = (req: IncomingMessage) => {
    const forwarded = options.trustProxy ? String(req.headers["x-forwarded-for"] ?? "").split(",")[0].trim() : "";
    return forwarded || req.socket.remoteAddress || "unknown";
  };

  /** Drops pairing tokens never used in time (they are bearer secrets lying in a QR code). */
  function prune(account: Account): boolean {
    let changed = false;
    for (const [authId, device] of Object.entries(account.devices ?? {})) {
      if (!device.claimedAt && now() - device.createdAt > PAIRING_TTL_MS) {
        delete account.devices![authId];
        changed = true;
      }
    }
    return changed;
  }

  function authenticate(req: IncomingMessage): Caller {
    const match = AUTH.exec(String(req.headers.authorization ?? ""));
    const account = match ? store.get(match[1]) : null;
    const actual = Buffer.from(sha256(match?.[2] ?? ""), "hex");
    const same = (hash: string | null | undefined) => timingSafeEqual(Buffer.from(hash ?? "0".repeat(64), "hex"), actual);
    if (!match || !account) {
      same(null);
      throw new HttpError(401, "Unauthorized");
    }
    if (prune(account)) store.save(account);
    // Every candidate is compared, in constant time.
    let authId: string | null | undefined;
    if (same(account.tokenHash)) authId = null;
    for (const [id, device] of Object.entries(account.devices ?? {})) if (same(device.tokenHash)) authId = id;
    if (authId === undefined) throw new HttpError(401, "Unauthorized");
    if (authId && !account.devices![authId].claimedAt) {
      account.devices![authId].claimedAt = now();
      store.save(account);
    }
    return { account, authId };
  }

  /** A new token for a device of `account` (first device, pairing code). */
  function addDevice(account: Account): { authId: string; token: string } {
    const devices = (account.devices ??= {});
    prune(account);
    if (Object.keys(devices).length >= MAX_DEVICES) throw new HttpError(409, "Too many devices");
    let authId: string;
    do authId = randomBytes(16).toString("hex");
    while (devices[authId]);
    const token = randomBytes(32).toString("base64url");
    devices[authId] = { tokenHash: sha256(token), createdAt: now() };
    return { authId, token };
  }

  /** Collection requests must use the current key generation (412 after a rotation). */
  function checkEpoch(req: IncomingMessage, account: Account): void {
    const given = Number(req.headers["x-sync-epoch"] ?? "0");
    const epoch = account.epoch ?? 0;
    if (given !== epoch) throw new HttpError(412, "Sync key rotated", {}, { error: "Sync key rotated", epoch });
  }

  function listDevices({ account, authId }: Caller) {
    const devices = Object.entries(account.devices ?? {}).map(([id, device]) => ({ authId: id, createdAt: device.createdAt, pending: !device.claimedAt }));
    return { epoch: account.epoch ?? 0, self: authId, legacy: account.tokenHash !== null, devices };
  }

  function keyring({ account, authId }: Caller, url: URL) {
    const since = Number(url.searchParams.get("since") ?? "0");
    if (!Number.isSafeInteger(since) || since < 0) throw new HttpError(400, "Invalid since");
    const wraps = authId === null
      ? []
      : (account.keyring ?? []).filter((entry) => entry.epoch > since && entry.wraps[authId]).map((entry) => ({ epoch: entry.epoch, wrap: entry.wraps[authId] }));
    return { epoch: account.epoch ?? 0, wraps };
  }

  /**
   * Key rotation (ADR-056), atomic: the revoked tokens and the legacy shared token stop working,
   * the next key wrapped for every remaining device is stored (each gets only its own), and the
   * data encrypted with the old key is erased: the devices upload theirs again with the new key.
   */
  function rotate({ account, authId }: Caller, body: unknown) {
    if (authId === null) throw new HttpError(403, "Device token needed");
    const { epoch, revoke, wraps } = (body ?? {}) as Record<string, unknown>;
    const current = account.epoch ?? 0;
    if (epoch !== current + 1) throw new HttpError(409, "Stale epoch", {}, { error: "Stale epoch", epoch: current });
    if (!Array.isArray(revoke) || revoke.length > MAX_DEVICES || !revoke.every((id) => typeof id === "string" && AUTH_ID.test(id))) {
      throw new HttpError(400, "Invalid revoke");
    }
    if (revoke.includes(authId)) throw new HttpError(400, "A device cannot revoke itself");
    if (typeof wraps !== "object" || wraps === null || Array.isArray(wraps)) throw new HttpError(400, "Invalid wraps");
    const entries = Object.entries(wraps as Record<string, unknown>);
    if (!entries.every(([id, wrap]) => AUTH_ID.test(id) && typeof wrap === "string" && WRAP.test(wrap))) throw new HttpError(400, "Invalid wraps");
    prune(account);
    const devices = account.devices ?? {};
    const remaining = Object.keys(devices).filter((id) => !revoke.includes(id));
    // Every remaining device needs its wrap and nobody else gets one: a device paired in the
    // meantime makes the caller list the devices again.
    if (remaining.length !== entries.length || !remaining.every((id) => typeof (wraps as Record<string, unknown>)[id] === "string")) {
      throw new HttpError(409, "Devices changed", {}, { error: "Devices changed", epoch: current });
    }
    for (const id of revoke) delete devices[id];
    account.devices = devices;
    account.tokenHash = null;
    account.epoch = current + 1;
    account.keyring = [...(account.keyring ?? []), { epoch: current + 1, wraps: Object.fromEntries(entries) as Record<string, string> }].slice(-KEYRING_KEPT);
    account.collections = {};
    account.bytes = 0;
    store.save(account);
    return { epoch: account.epoch };
  }

  function createAccount(req: IncomingMessage): { accountId: string; token: string } {
    if (options.registrationSecret) {
      const given = Buffer.from(sha256(String(req.headers["x-registration-secret"] ?? "")), "hex");
      if (!timingSafeEqual(given, Buffer.from(sha256(options.registrationSecret), "hex"))) throw new HttpError(403, "Registration closed");
    }
    const wait = signups.take(clientAddress(req));
    if (wait) throw new HttpError(429, "Too many accounts", { "retry-after": String(wait) });
    let accountId: string;
    do accountId = randomBytes(16).toString("hex");
    while (store.has(accountId));
    const account: Account = { id: accountId, tokenHash: null, devices: {}, epoch: 0, createdAt: now(), version: 0, bytes: 0, collections: {} };
    const device = addDevice(account);
    store.save(account);
    return { accountId, ...device };
  }

  /** Stores one Crashpad upload as received (multipart, gzip when Crashpad compressed it). */
  async function receiveCrash(req: IncomingMessage): Promise<string> {
    if (!String(req.headers["content-type"] ?? "").startsWith("multipart/form-data")) throw new HttpError(415, "Multipart expected");
    const wait = crashes.take(clientAddress(req));
    if (wait) throw new HttpError(429, "Too many crash reports", { "retry-after": String(wait) });
    const body = await readRaw(req, options.maxCrashBytes ?? 8 * 1024 * 1024);
    if (body.length === 0) throw new HttpError(400, "Empty report");
    const id = `${new Date(now()).toISOString().replace(/[:.]/g, "-")}-${randomBytes(6).toString("hex")}`;
    const gzip = String(req.headers["content-encoding"] ?? "") === "gzip";
    mkdirSync(crashDir, { recursive: true });
    writeFileSync(join(crashDir, `${id}.multipart${gzip ? ".gz" : ""}`), body);
    // Oldest out first (names start with their date).
    const stored = readdirSync(crashDir).sort();
    for (const name of stored.slice(0, Math.max(0, stored.length - (options.maxStoredCrashes ?? 500)))) rmSync(join(crashDir, name), { force: true });
    return id;
  }

  function pull(account: Account, name: string, url: URL) {
    const since = Number(url.searchParams.get("since") ?? "0");
    const limit = Math.min(PAGE_SIZE, Math.max(1, Number(url.searchParams.get("limit") ?? PAGE_SIZE) || PAGE_SIZE));
    if (!Number.isSafeInteger(since) || since < 0) throw new HttpError(400, "Invalid since");
    const records = account.collections[name] ?? {};
    const newer = Object.entries(records)
      .filter(([, record]) => record.version > since)
      .sort(([, a], [, b]) => a.version - b.version);
    const page = newer.slice(0, limit).map(([id, record]) => ({ id, ...record }));
    const more = newer.length > limit;
    return { records: page, version: more ? page[page.length - 1].version : collectionVersion(records), more };
  }

  function push(account: Account, name: string, body: unknown) {
    const batch = (body as { records?: unknown } | null)?.records;
    if (!Array.isArray(batch) || batch.length === 0 || batch.length > MAX_BATCH) throw new HttpError(400, "Invalid batch");
    const seen = new Set<string>();
    const items = batch.map((item: unknown) => {
      const { id, base, payload } = (item ?? {}) as Record<string, unknown>;
      if (typeof id !== "string" || !RECORD_ID.test(id) || seen.has(id)) throw new HttpError(400, "Invalid record id");
      if (typeof base !== "number" || !Number.isSafeInteger(base) || base < 0) throw new HttpError(400, "Invalid base");
      if (payload !== null && (typeof payload !== "string" || payload.length > MAX_PAYLOAD || !/^[A-Za-z0-9_-]+$/.test(payload))) {
        throw new HttpError(400, "Invalid payload");
      }
      seen.add(id);
      return { id, base, payload: payload as string | null };
    });
    if (!account.collections[name] && Object.keys(account.collections).length >= MAX_COLLECTIONS) throw new HttpError(400, "Too many collections");
    const records = account.collections[name] ?? {};
    // Optimistic concurrency: every record must still be at the version the client last saw.
    const conflicts = items.filter((item) => (records[item.id]?.version ?? 0) !== item.base).map((item) => ({ id: item.id, version: records[item.id]?.version ?? 0 }));
    if (conflicts.length) throw new HttpError(409, "Conflict", {}, { conflicts });
    const delta = items.reduce((sum, item) => sum + (item.payload?.length ?? 0) - (records[item.id]?.payload?.length ?? 0), 0);
    if (account.bytes + delta > maxAccountBytes) throw new HttpError(507, "Account quota exceeded");

    const previous = collectionVersion(records);
    const modified = now();
    const written = items.map((item) => {
      account.version += 1;
      records[item.id] = { version: account.version, modified, payload: item.payload };
      return { id: item.id, version: account.version };
    });
    account.collections[name] = records;
    account.bytes += delta;
    store.save(account);
    return { version: account.version, previous, records: written };
  }

  async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://relay");
    const method = req.method ?? "GET";
    if (method === "GET" && url.pathname === "/healthz") return send(res, 200, { ok: true });
    // Web pages always send Origin on these requests; native clients do not. No CORS, ever.
    if (req.headers.origin !== undefined) throw new HttpError(403, "Browser requests are not allowed");
    const wait = requests.take(clientAddress(req));
    if (wait) throw new HttpError(429, "Too many requests", { "retry-after": String(wait) });

    if (url.pathname === "/crash") {
      if (!options.crashReports) throw new HttpError(404, "Not found");
      if (method !== "POST") throw new HttpError(405, "Method not allowed");
      // Crashpad reads the response body as the report id: plain text.
      const id = await receiveCrash(req);
      res.writeHead(200, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
      return void res.end(id);
    }
    if (method === "POST" && url.pathname === "/v1/accounts") {
      await readBody(req, 1024);
      return send(res, 201, createAccount(req));
    }
    if (method === "DELETE" && url.pathname === "/v1/account") {
      const { account } = authenticate(req);
      store.delete(account.id);
      return send(res, 204);
    }
    if (url.pathname === "/v1/devices") {
      const caller = authenticate(req);
      if (method === "GET") return send(res, 200, listDevices(caller));
      if (method === "POST") {
        await readBody(req, 1024);
        const device = addDevice(caller.account);
        store.save(caller.account);
        return send(res, 201, device);
      }
      throw new HttpError(405, "Method not allowed");
    }
    if (method === "DELETE" && url.pathname === "/v1/devices/self") {
      const { account, authId } = authenticate(req);
      if (authId === null) throw new HttpError(403, "Device token needed");
      delete account.devices![authId];
      store.save(account);
      return send(res, 204);
    }
    if (url.pathname === "/v1/keyring") {
      const caller = authenticate(req);
      if (method === "GET") return send(res, 200, keyring(caller, url));
      if (method === "POST") {
        if (!String(req.headers["content-type"] ?? "").startsWith("application/json")) throw new HttpError(415, "JSON expected");
        return send(res, 200, rotate(caller, parseJson(await readBody(req, 64 * 1024))));
      }
      throw new HttpError(405, "Method not allowed");
    }
    const match = /^\/v1\/collections\/([^/]+)$/.exec(url.pathname);
    if (match) {
      if (!COLLECTION.test(match[1])) throw new HttpError(404, "Unknown collection");
      const { account } = authenticate(req);
      checkEpoch(req, account);
      if (method === "GET") return send(res, 200, pull(account, match[1], url));
      if (method === "POST") {
        if (!String(req.headers["content-type"] ?? "").startsWith("application/json")) throw new HttpError(415, "JSON expected");
        return send(res, 200, push(account, match[1], parseJson(await readBody(req, maxBody))));
      }
      throw new HttpError(405, "Method not allowed");
    }
    throw new HttpError(404, "Not found");
  }

  const server = createServer((req, res) => {
    const started = now();
    route(req, res)
      .catch((error: unknown) => {
        if (error instanceof HttpError) send(res, error.status, error.body ?? { error: error.message }, error.headers);
        else {
          log(`error: ${error instanceof Error ? error.message : String(error)}`);
          send(res, 500, { error: "Internal error" });
        }
      })
      .finally(() => {
        // No ids, tokens or addresses in the log.
        log(`${req.method} ${(req.url ?? "").replace(/\?.*$/, "")} ${res.statusCode} ${now() - started}ms`);
      });
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 15_000;
  return { server, store };
}
