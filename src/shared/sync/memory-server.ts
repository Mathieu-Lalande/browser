import type { HttpRequest, HttpResponse, Transport } from "./client";
import { isCollectionName, isRecordId } from "./crypto";
import { MAX_BATCH_RECORDS, PAGE_SIZE, type WireRecord } from "./protocol";

/**
 * In-memory implementation of the relay protocol, for tests of the engine (Vitest) and of the
 * mobile adapters (Jest). Same rules as `server/`: bearer auth, per-account versions, atomic
 * batches with optimistic concurrency. Not used by the apps.
 */
export class MemorySyncServer {
  private readonly accounts = new Map<string, { token: string; version: number; collections: Map<string, Map<string, WireRecord>> }>();
  private nextAccount = 1;
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

  private handle(request: HttpRequest): HttpResponse {
    const url = new URL(request.url);
    const path = url.pathname.replace(/^.*?\/v1/, "");
    this.log.push(`${request.method} ${path}`);
    if (request.method === "POST" && path === "/accounts") {
      const accountId = (this.nextAccount++).toString(16).padStart(32, "0");
      const token = `token${accountId}`.padEnd(40, "x");
      this.accounts.set(accountId, { token, version: 0, collections: new Map() });
      return json(201, { accountId, token });
    }
    const auth = /^Bearer ([0-9a-f]{32})\.(\S+)$/.exec(request.headers.authorization ?? "");
    const account = auth ? this.accounts.get(auth[1]) : undefined;
    if (!auth || !account || account.token !== auth[2]) return json(401, { error: "unauthorized" });
    if (request.method === "DELETE" && path === "/account") {
      this.accounts.delete(auth[1]);
      return { status: 204, headers: {}, body: "" };
    }
    const match = /^\/collections\/([^/]+)$/.exec(path);
    if (!match || !isCollectionName(match[1])) return json(404, { error: "not found" });
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
