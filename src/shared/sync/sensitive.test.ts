import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EMPTY_VAULT, saveCapture, setNever, type PasswordVault } from "../passwords";
import { accountLocalId, mergeSyncedPasswords, neverLocalId, passwordRecords, sanitizeSyncedPassword, type SyncedPassword } from "../passwords-sync";
import { toBase64Url } from "./bytes";
import { SyncController, type SyncPlatform } from "./controller";
import { generateSyncKey } from "./crypto";
import { hashValue } from "./hash";
import { loadSyncState, storedSyncState, type CollectionAdapter } from "./engine";
import { MemorySyncServer } from "./memory-server";
import type { SyncCredentials } from "./pairing";

const rng = (n: number) => new Uint8Array(randomBytes(n));
let ids = 0;
const newId = () => `id${++ids}`;

/** A device with a password vault whose sync state is written to a real file. */
function device(server: MemorySyncServer, name: string) {
  const file = join(mkdtempSync(join(tmpdir(), "sync-sensitive-")), "sync.json");
  let vault: PasswordVault = EMPTY_VAULT;
  let credentials: SyncCredentials | null = null;
  let state: unknown = null;
  const adapter: CollectionAdapter<SyncedPassword> = {
    name: "passwords",
    snapshot: () => passwordRecords(vault),
    sanitize: (value, id) => sanitizeSyncedPassword(value, id),
    apply: ({ upserts, deletes }) => void (vault = mergeSyncedPasswords(vault, upserts, deletes, newId)),
  };
  const platform: SyncPlatform = {
    transport: server.transport,
    rng,
    kind: "desktop",
    deviceName: () => name,
    localTabs: () => [],
    adapters: () => [adapter],
    loadCredentials: async () => credentials,
    saveCredentials: async (value) => void (credentials = value),
    loadState: async () => state,
    saveState: (value) => {
      writeFileSync(file, JSON.stringify(value));
      state = JSON.parse(readFileSync(file, "utf8"));
    },
    onStatus: () => {},
    debounceMs: 1000,
    intervalMs: 60_000,
  };
  return {
    controller: new SyncController(platform),
    file,
    get vault() {
      return vault;
    },
    set vault(next: PasswordVault) {
      vault = next;
    },
    save: (origin: string, username: string, password: string, now: number) => (vault = saveCapture(vault, { origin, username, password }, now, newId())),
    credentials: () => credentials!,
  };
}

async function pair() {
  const server = new MemorySyncServer();
  const a = device(server, "PC");
  const b = device(server, "iPhone");
  await a.controller.createAccount("http://127.0.0.1:1");
  await b.controller.pair(a.controller.pairingCode()!);
  return { a, b };
}

describe("password sync (sensitive collection, ADR-050)", () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] }));
  afterEach(() => vi.useRealTimers());

  it("syncs accounts and the never list, end to end, with nothing about them in clear on disk", async () => {
    const { a, b } = await pair();
    a.save("https://bank.example", "alice@example.com", "s3cr3t-Pa55word", 1);
    a.vault = setNever(a.vault, "https://never.example", true);
    await a.controller.syncNow();
    await b.controller.syncNow();
    expect(b.vault.entries).toMatchObject([{ origin: "https://bank.example", username: "alice@example.com", password: "s3cr3t-Pa55word" }]);
    expect(b.vault.never).toEqual(["https://never.example"]);

    for (const device of [a, b]) {
      const written = readFileSync(device.file, "utf8");
      const hashes = [...passwordRecords(device.vault).values()].map(hashValue);
      for (const secret of ["s3cr3t-Pa55word", "alice", "bank.example", "never.example", "a:https", ...hashes]) expect(written).not.toContain(secret);
      expect(JSON.parse(written).sealed.passwords).toEqual(expect.any(String));
      // The sealed mirror opens again with the account's key: nothing to resend.
      const loaded = loadSyncState(JSON.parse(written), device.credentials(), rng);
      expect(Object.keys(loaded.collections.passwords!.items).sort()).toEqual([accountLocalId("https://bank.example", "alice@example.com"), neverLocalId("https://never.example")]);
    }
  });

  it("last writer wins per account, and deletions travel as tombstones", async () => {
    const { a, b } = await pair();
    a.save("https://site.example", "bob", "first", 1);
    a.save("https://other.example", "bob", "keep", 1);
    await a.controller.syncNow();
    await b.controller.syncNow();
    // Both edit the same account; B's change is stamped last (offline until then), so it wins on both.
    a.save("https://site.example", "bob", "from-a", 2);
    b.save("https://site.example", "bob", "from-b", 3);
    await a.controller.syncNow();
    await vi.advanceTimersByTimeAsync(10);
    await b.controller.syncNow();
    await a.controller.syncNow();
    for (const device of [a, b]) expect(device.vault.entries.find((entry) => entry.origin === "https://site.example")?.password).toBe("from-b");
    // A deletion reaches the other device; untouched accounts stay.
    b.vault = { ...b.vault, entries: b.vault.entries.filter((entry) => entry.origin !== "https://site.example") };
    await b.controller.syncNow();
    await a.controller.syncNow();
    expect(a.vault.entries.map((entry) => entry.origin)).toEqual(["https://other.example"]);
  });

  it("drops a sealed mirror it cannot open, and never reads a sensitive mirror stored in clear", () => {
    const credentials: SyncCredentials = { serverUrl: "http://x", accountId: "0".repeat(32), token: "t".repeat(43), syncKey: toBase64Url(generateSyncKey(rng)) };
    const other = { ...credentials, syncKey: toBase64Url(generateSyncKey(rng)) };
    const fresh = loadSyncState(null, credentials, rng);
    fresh.collections.passwords = { cursor: 3, items: {} };
    fresh.collections.bookmarks = { cursor: 2, items: {} };
    const stored = storedSyncState(fresh, credentials, rng);
    expect(stored.collections.passwords).toBeUndefined();
    expect(loadSyncState(stored, credentials, rng).collections.passwords?.cursor).toBe(3);
    // Same account, another key: the fingerprint differs, everything starts over.
    expect(loadSyncState(stored, other, rng).collections).toEqual({});
    // Tampered envelope or clear copy: only the passwords mirror is dropped.
    const envelope = stored.sealed!.passwords!;
    const flipped = envelope.slice(0, 40) + (envelope[40] === "A" ? "B" : "A") + envelope.slice(41);
    const tampered = { ...stored, sealed: { passwords: flipped }, collections: { ...stored.collections, passwords: { cursor: 9, items: {} } } };
    const loaded = loadSyncState(tampered, credentials, rng);
    expect(loaded.collections.passwords).toBeUndefined();
    expect(loaded.collections.bookmarks?.cursor).toBe(2);
  });

  it("validates remote records against their local id", () => {
    const account = { kind: "account", origin: "https://a.example", username: "u", password: "p", createdAt: 1, updatedAt: 2 };
    expect(sanitizeSyncedPassword(account, accountLocalId("https://a.example", "u"))).toEqual(account);
    expect(sanitizeSyncedPassword(account, accountLocalId("https://evil.example", "u"))).toBeNull();
    expect(sanitizeSyncedPassword({ ...account, password: "" }, accountLocalId("https://a.example", "u"))).toBeNull();
    expect(sanitizeSyncedPassword({ kind: "never", origin: "javascript:alert(1)" }, "n:javascript:alert(1)")).toBeNull();
  });
});
