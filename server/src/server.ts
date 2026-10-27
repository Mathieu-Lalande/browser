import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { RateLimiter } from "./rate-limit.js";
import { FileStore, type Account, type StoredRecord } from "./store.js";

/**
 * The sync relay (ADR-018). It stores opaque, end-to-end encrypted records for accounts and
 * never sees keys or plaintext. Protocol (also in `src/shared/sync/protocol.ts`):
 *
 *   POST   /v1/accounts                         → 201 { accountId, token }
 *   GET    /v1/collections/:name?since=&limit=  → { records, version, more }
 *   POST   /v1/collections/:name { records }    → { version, previous, records } | 409 { conflicts }
 *   DELETE /v1/account                          → 204
 *   GET    /healthz                             → 200
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
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
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

  const clientAddress = (req: IncomingMessage) => {
    const forwarded = options.trustProxy ? String(req.headers["x-forwarded-for"] ?? "").split(",")[0].trim() : "";
    return forwarded || req.socket.remoteAddress || "unknown";
  };

  function authenticate(req: IncomingMessage): Account {
    const match = AUTH.exec(String(req.headers.authorization ?? ""));
    const account = match ? store.get(match[1]) : null;
    const expected = Buffer.from(account?.tokenHash ?? "0".repeat(64), "hex");
    const actual = Buffer.from(sha256(match?.[2] ?? ""), "hex");
    if (!match || !account || !timingSafeEqual(expected, actual)) throw new HttpError(401, "Unauthorized");
    return account;
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
    const token = randomBytes(32).toString("base64url");
    store.save({ id: accountId, tokenHash: sha256(token), createdAt: now(), version: 0, bytes: 0, collections: {} });
    return { accountId, token };
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

    if (method === "POST" && url.pathname === "/v1/accounts") {
      await readBody(req, 1024);
      return send(res, 201, createAccount(req));
    }
    if (method === "DELETE" && url.pathname === "/v1/account") {
      const account = authenticate(req);
      store.delete(account.id);
      return send(res, 204);
    }
    const match = /^\/v1\/collections\/([^/]+)$/.exec(url.pathname);
    if (match) {
      if (!COLLECTION.test(match[1])) throw new HttpError(404, "Unknown collection");
      const account = authenticate(req);
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
