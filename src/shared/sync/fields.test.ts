import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { toBase64Url } from "./bytes";
import { generateSyncKey } from "./crypto";
import { SyncEngine, createSyncState, type CollectionAdapter, type SyncState } from "./engine";
import { fieldHashes, mergeFields, parseFieldClocks, touchedFieldClocks } from "./fields";
import { encodeHlc } from "./hlc";
import { MemorySyncServer } from "./memory-server";
import type { SyncCredentials } from "./pairing";
import { BOOKMARK_FIELDS, sanitizeSyncedBookmark, type SyncedBookmark } from "./records";

const rng = (n: number) => new Uint8Array(randomBytes(n));
const hlc = (wall: number, node = "aaaa") => encodeHlc({ wall, counter: 0, node });
const FIELDS = ["title", "folderId"] as const;

describe("field clocks (ADR-057)", () => {
  it("stamps only the fields that changed", () => {
    const before = { title: "A", folderId: "x" };
    const after = { title: "B", folderId: "x" };
    const clocks = touchedFieldClocks(FIELDS, { hashes: fieldHashes(before, FIELDS), clocks: { title: hlc(1), folderId: hlc(2) } }, fieldHashes(after, FIELDS), hlc(9));
    expect(clocks).toEqual({ title: hlc(9), folderId: hlc(2) });
    // A new record: every field takes the new clock.
    expect(touchedFieldClocks(FIELDS, null, fieldHashes(after, FIELDS), hlc(9))).toEqual({ title: hlc(9), folderId: hlc(9) });
  });

  it("validates clocks from another device (missing or later than the record: the record's)", () => {
    expect(parseFieldClocks({ title: hlc(3), folderId: hlc(99), extra: hlc(1) }, FIELDS, hlc(5))).toEqual({ title: hlc(3), folderId: hlc(5) });
    expect(parseFieldClocks("nope", FIELDS, hlc(5))).toEqual({ title: hlc(5), folderId: hlc(5) });
  });

  it("merges field by field; unlisted fields follow the newer record", () => {
    const local = { kind: "bookmark", title: "Renamed", folderId: "old", createdAt: 1 };
    const remote = { kind: "bookmark", title: "Original", folderId: "new", createdAt: 2 };
    const merged = mergeFields(FIELDS, local, { title: hlc(10), folderId: hlc(1) }, hlc(10), remote, { title: hlc(1), folderId: hlc(8) }, hlc(8));
    expect(merged.data).toEqual({ kind: "bookmark", title: "Renamed", folderId: "new", createdAt: 1 });
    expect(merged).toMatchObject({ keptLocal: true, tookRemote: true, clocks: { title: hlc(10), folderId: hlc(8) } });
    // A field removed on the newer side (moved back to the root) goes away.
    const root = mergeFields(FIELDS, { title: "T", folderId: "f" }, { title: hlc(1), folderId: hlc(1) }, hlc(1), { title: "T" }, { title: hlc(1), folderId: hlc(5) }, hlc(5));
    expect(root.data).toEqual({ title: "T" });
  });
});

/** A device holding bookmarks as plain records, with the bookmarks' field merge. */
class Device {
  readonly data = new Map<string, SyncedBookmark>();
  state: SyncState;
  time = 1_000_000;

  constructor(
    readonly server: MemorySyncServer,
    readonly credentials: SyncCredentials,
    deviceId: string,
  ) {
    this.state = createSyncState(credentials, rng, deviceId);
  }

  adapter(): CollectionAdapter<SyncedBookmark> {
    return {
      name: "bookmarks",
      fields: BOOKMARK_FIELDS,
      snapshot: () => new Map(this.data),
      sanitize: (value, id) => sanitizeSyncedBookmark(value, id),
      apply: ({ upserts, deletes }) => {
        for (const { id, data } of upserts) this.data.set(id, data);
        for (const id of deletes) this.data.delete(id);
      },
    };
  }

  sync() {
    return new SyncEngine({ transport: this.server.transport, rng, credentials: this.credentials, state: this.state, adapters: [this.adapter() as CollectionAdapter], now: () => this.time }).sync();
  }
}

async function pair() {
  const server = new MemorySyncServer();
  const created = JSON.parse((await server.transport({ method: "POST", url: "http://127.0.0.1/v1/accounts", headers: {}, body: "{}" })).body);
  const credentials: SyncCredentials = { serverUrl: "http://127.0.0.1", ...created, syncKey: toBase64Url(generateSyncKey(rng)) };
  const a = new Device(server, credentials, "aaaa");
  const b = new Device(server, credentials, "bbbb");
  await a.sync();
  await b.sync();
  return { a, b };
}

const ID = "b:https://example.com/";
const bookmark = (title: string, folderId?: string): SyncedBookmark => ({ kind: "bookmark", url: "https://example.com/", title, createdAt: 1, ...(folderId ? { folderId } : {}) });

describe("bookmarks edited on two devices (ADR-057)", () => {
  it("keeps a rename and a concurrent move to another folder", async () => {
    const { a, b } = await pair();
    a.data.set(ID, bookmark("Example"));
    await a.sync();
    await b.sync();
    expect(b.data.get(ID)).toEqual(bookmark("Example"));
    // Offline at the same time: A renames it, B files it (B's change is the later one).
    a.time += 1000;
    a.data.set(ID, bookmark("Example — renamed"));
    b.time += 2000;
    b.data.set(ID, bookmark("Example", "work"));
    await a.sync();
    await b.sync();
    await a.sync();
    expect(b.data.get(ID)).toEqual(bookmark("Example — renamed", "work"));
    expect(a.data.get(ID)).toEqual(bookmark("Example — renamed", "work"));
    // Settled: nothing more goes up or down.
    expect(await a.sync()).toMatchObject({ pushed: 0, pulled: 0 });
    expect(await b.sync()).toMatchObject({ pushed: 0, pulled: 0 });
  });

  it("still lets the newer edit of the same field win", async () => {
    const { a, b } = await pair();
    a.data.set(ID, bookmark("One"));
    await a.sync();
    await b.sync();
    a.time += 1000;
    a.data.set(ID, bookmark("Two"));
    b.time += 2000;
    b.data.set(ID, bookmark("Three"));
    await a.sync();
    await b.sync();
    await a.sync();
    expect(a.data.get(ID)).toEqual(bookmark("Three"));
    expect(b.data.get(ID)).toEqual(bookmark("Three"));
  });
});
