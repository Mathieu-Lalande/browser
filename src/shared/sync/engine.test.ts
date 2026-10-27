import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { toBase64Url } from "./bytes";
import { SyncError, type Transport } from "./client";
import { generateSyncKey } from "./crypto";
import { SyncEngine, createSyncState, loadSyncState, type CollectionAdapter, type SyncState } from "./engine";
import { MemorySyncServer } from "./memory-server";
import type { SyncCredentials } from "./pairing";
import type { CollectionName } from "./records";

const rng = (n: number) => new Uint8Array(randomBytes(n));

/** A device holding one collection as a plain map, with a controllable clock. */
class Device {
  readonly data = new Map<string, unknown>();
  /** Out-of-scope records: present locally, not synced (like old history). */
  readonly hidden = new Map<string, unknown>();
  state: SyncState;
  time = 1_000_000;
  transport: Transport;
  applied: { upserts: string[]; deletes: string[] }[] = [];

  constructor(
    readonly server: MemorySyncServer,
    readonly credentials: SyncCredentials,
    readonly name: CollectionName = "bookmarks",
    deviceId?: string,
  ) {
    this.state = createSyncState(credentials, rng, deviceId);
    this.transport = server.transport;
  }

  adapter(): CollectionAdapter {
    return {
      name: this.name,
      snapshot: () => new Map(this.data),
      exists: (id) => this.hidden.has(id),
      sanitize: (value) => (typeof value === "string" ? value : null),
      apply: ({ upserts, deletes }) => {
        for (const { id, data } of upserts) this.data.set(id, data);
        for (const id of deletes) this.data.delete(id);
        this.applied.push({ upserts: upserts.map((change) => change.id), deletes });
      },
    };
  }

  engine(): SyncEngine {
    return new SyncEngine({
      transport: this.transport,
      rng,
      credentials: this.credentials,
      state: this.state,
      adapters: [this.adapter()],
      now: () => this.time,
    });
  }

  sync() {
    return this.engine().sync();
  }
}

async function account(server = new MemorySyncServer()) {
  const created = JSON.parse((await server.transport({ method: "POST", url: "http://127.0.0.1/v1/accounts", headers: {}, body: "{}" })).body);
  const credentials: SyncCredentials = { serverUrl: "http://127.0.0.1", ...created, syncKey: toBase64Url(generateSyncKey(rng)) };
  return { server, credentials };
}

async function pair(time = 1_000_000) {
  const { server, credentials } = await account();
  const a = new Device(server, credentials, "bookmarks", "aaaa");
  const b = new Device(server, credentials, "bookmarks", "bbbb");
  a.time = b.time = time;
  await a.sync();
  await b.sync();
  return { server, credentials, a, b };
}

describe("sync engine", () => {
  it("propagates additions, edits and deletions between two devices", async () => {
    const { a, b } = await pair();
    a.data.set("x", "one");
    a.time += 10;
    await a.sync();
    await b.sync();
    expect(b.data.get("x")).toBe("one");

    b.data.set("x", "two");
    b.time += 20;
    await b.sync();
    await a.sync();
    expect(a.data.get("x")).toBe("two");

    a.data.delete("x");
    a.time += 30;
    await a.sync();
    await b.sync();
    expect(b.data.has("x")).toBe(false);
  });

  it("is quiet when nothing changed (no push, no re-apply of its own records)", async () => {
    const { a, b, server } = await pair();
    a.data.set("x", "one");
    await a.sync();
    await b.sync();
    const before = server.log.length;
    const report = await a.sync();
    expect(report).toEqual({ pulled: 0, pushed: 0, rejected: 0 });
    expect(server.log.slice(before).every((line) => line.startsWith("GET"))).toBe(true);
    expect((await b.sync()).pushed).toBe(0);
  });

  it("never sends plaintext: ids are keyed hashes, payloads are ciphertext", async () => {
    const { a, server } = await pair();
    a.data.set("b:https://secret.example/path", "Mon titre secret");
    await a.sync();
    const dump = server.dump();
    expect(dump).not.toContain("secret.example");
    expect(dump).not.toContain("Mon titre");
    expect(dump).toMatch(/"id":"[0-9a-f]{32}"/);
  });

  // Conflict matrix: concurrent changes on both devices before either syncs; later timestamp wins.
  type Op = { kind: "set"; value: string } | { kind: "delete" } | { kind: "none" };
  const set = (value: string): Op => ({ kind: "set", value });
  const del: Op = { kind: "delete" };
  const none: Op = { kind: "none" };
  const cases: { name: string; a: Op; b: Op; aFirst: boolean; expected: string | undefined }[] = [
    { name: "edit vs edit, B later", a: set("A"), b: set("B"), aFirst: true, expected: "B" },
    { name: "edit vs edit, A later", a: set("A"), b: set("B"), aFirst: false, expected: "A" },
    { name: "edit vs delete, delete later", a: set("A"), b: del, aFirst: true, expected: undefined },
    { name: "edit vs delete, edit later", a: set("A"), b: del, aFirst: false, expected: "A" },
    { name: "delete vs edit, edit later", a: del, b: set("B"), aFirst: true, expected: "B" },
    { name: "delete vs edit, delete later", a: del, b: set("B"), aFirst: false, expected: undefined },
    { name: "delete vs delete", a: del, b: del, aFirst: true, expected: undefined },
    { name: "edit vs nothing", a: set("A"), b: none, aFirst: true, expected: "A" },
    { name: "nothing vs delete", a: none, b: del, aFirst: true, expected: undefined },
    { name: "same edit on both", a: set("S"), b: set("S"), aFirst: true, expected: "S" },
  ];

  for (const testCase of cases) {
    for (const syncOrder of ["A syncs first", "B syncs first"] as const) {
      it(`resolves ${testCase.name} (${syncOrder})`, async () => {
        const { a, b } = await pair();
        a.data.set("x", "base");
        await a.sync();
        await b.sync();
        expect(b.data.get("x")).toBe("base");

        const apply = (device: Device, op: Op) => {
          if (op.kind === "set") device.data.set("x", op.value);
          if (op.kind === "delete") device.data.delete("x");
        };
        apply(a, testCase.a);
        apply(b, testCase.b);
        // Changes are timestamped by each device's own clock when it next syncs.
        a.time += testCase.aFirst ? 100 : 200;
        b.time += testCase.aFirst ? 200 : 100;
        const order = syncOrder === "A syncs first" ? [a, b, a, b] : [b, a, b, a];
        for (const device of order) await device.sync();
        expect(a.data.get("x")).toBe(testCase.expected);
        expect(b.data.get("x")).toBe(testCase.expected);
      });
    }
  }

  it("first sync of a new device: the account's data wins, local-only records are added", async () => {
    const { server, credentials } = await account();
    const a = new Device(server, credentials, "bookmarks", "aaaa");
    a.data.set("shared", "from A");
    a.data.set("onlyA", "A");
    await a.sync();
    const b = new Device(server, credentials, "bookmarks", "bbbb");
    b.time = a.time + 1_000_000; // newer clock, still loses on the first merge
    b.data.set("shared", "from B");
    b.data.set("onlyB", "B");
    await b.sync();
    await a.sync();
    expect(Object.fromEntries(b.data)).toEqual({ shared: "from A", onlyA: "A", onlyB: "B" });
    expect(Object.fromEntries(a.data)).toEqual(Object.fromEntries(b.data));
  });

  for (const newer of ["A", "B"] as const) {
    it(`retries after a 409 when another device wrote between its pull and its push (${newer} newer)`, async () => {
      const { a, b, server } = await pair();
      a.data.set("x", "A");
      b.data.set("x", "B");
      a.time += newer === "A" ? 50 : 10;
      b.time += newer === "A" ? 10 : 50;
      let interleaved = false;
      const forward = a.transport;
      a.transport = async (request) => {
        if (request.method === "POST" && !interleaved) {
          interleaved = true;
          await b.sync(); // B's write lands after A's pull: A's base is stale
        }
        return forward(request);
      };
      const before = server.log.length;
      await a.sync();
      expect(interleaved).toBe(true);
      expect(server.log.slice(before).filter((line) => line.startsWith("POST")).length).toBeGreaterThanOrEqual(1);
      await b.sync();
      expect(a.data.get("x")).toBe(newer);
      expect(b.data.get("x")).toBe(newer);
    });
  }

  it("removes out-of-window records from the server without deleting them elsewhere", async () => {
    const { a, b, server } = await pair();
    a.data.set("old", "visit");
    await a.sync();
    await b.sync();
    expect(b.data.get("old")).toBe("visit");
    // On A the entry leaves the sync window but still exists locally.
    a.data.delete("old");
    a.hidden.set("old", "visit");
    a.time += 10;
    await a.sync();
    expect(server.dump()).toContain('"payload":null');
    await b.sync();
    expect(b.data.get("old")).toBe("visit");
    expect(a.state.collections.bookmarks?.items.old).toBeUndefined();
  });

  it("refuses records it cannot decrypt and keeps its cursor (another key)", async () => {
    const { server, credentials } = await account();
    const a = new Device(server, credentials, "bookmarks", "aaaa");
    a.data.set("x", "1");
    await a.sync();
    const wrongKey = { ...credentials, syncKey: toBase64Url(generateSyncKey(rng)) };
    const c = new Device(server, wrongKey, "bookmarks", "cccc");
    await expect(c.sync()).rejects.toMatchObject({ kind: "crypto" });
    expect(c.data.size).toBe(0);
    expect(c.state.collections.bookmarks?.cursor).toBe(0);
  });

  it("reports offline and keeps local changes for the next round", async () => {
    const { a, b, server } = await pair();
    a.data.set("x", "offline edit");
    server.offline = true;
    const error = await a.sync().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(SyncError);
    expect((error as SyncError).kind).toBe("offline");
    server.offline = false;
    await a.sync();
    await b.sync();
    expect(b.data.get("x")).toBe("offline edit");
  });

  it("pages through large pulls and splits large pushes", async () => {
    const { a, b } = await pair();
    for (let i = 0; i < 1234; i++) a.data.set(`k${i}`, `value ${i}`);
    const report = await a.sync();
    expect(report.pushed).toBe(1234);
    await b.sync();
    expect(b.data.size).toBe(1234);
  });

  it("a stored state for another account or key starts over", async () => {
    const { a, credentials } = await pair();
    a.data.set("x", "1");
    await a.sync();
    const saved = JSON.parse(JSON.stringify(a.state));
    expect(loadSyncState(saved, credentials, rng).collections.bookmarks).toBeDefined();
    const other = loadSyncState(saved, { ...credentials, syncKey: toBase64Url(generateSyncKey(rng)) }, rng);
    expect(other.collections).toEqual({});
    expect(other.deviceId).toBe(a.state.deviceId);
  });
});
