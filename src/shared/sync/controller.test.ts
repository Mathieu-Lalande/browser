import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SyncController, backoffDelay, type SyncPlatform, type SyncStatus } from "./controller";
import type { CollectionAdapter } from "./engine";
import { MemorySyncServer } from "./memory-server";
import { toBase64Url } from "./bytes";
import { encodePairingCode, type SyncCredentials } from "./pairing";
import { followRotation, planRotation } from "./rotation";
import { bookmarkLocalId, type SyncedBookmark, type SyncedTab } from "./records";

const rng = (n: number) => new Uint8Array(randomBytes(n));

/** A fake app: bookmarks by URL, open tabs, storage in memory. */
function app(server: MemorySyncServer, name: string) {
  const bookmarks = new Map<string, SyncedBookmark>();
  const tabs: SyncedTab[] = [];
  let credentials: SyncCredentials | null = null;
  let state: unknown = null;
  const statuses: SyncStatus[] = [];
  const adapter: CollectionAdapter<SyncedBookmark> = {
    name: "bookmarks",
    snapshot: () => new Map(bookmarks),
    sanitize: (value) => value as SyncedBookmark,
    apply: ({ upserts, deletes }) => {
      for (const { id, data } of upserts) bookmarks.set(id, data);
      for (const id of deletes) bookmarks.delete(id);
    },
  };
  const platform: SyncPlatform = {
    transport: server.transport,
    rng,
    kind: "desktop",
    deviceName: () => name,
    localTabs: () => tabs,
    adapters: () => [adapter],
    loadCredentials: async () => credentials,
    saveCredentials: async (value) => void (credentials = value),
    loadState: async () => state,
    saveState: (value) => void (state = value && JSON.parse(JSON.stringify(value))),
    onStatus: (status) => void statuses.push(status),
    debounceMs: 1000,
    intervalMs: 60_000,
  };
  const controller = new SyncController(platform);
  const bookmark = (url: string) => bookmarks.set(bookmarkLocalId(url), { kind: "bookmark", url, title: url, createdAt: 1 });
  return { controller, bookmarks, tabs, statuses, bookmark, status: () => controller.getStatus(), credentials: () => credentials };
}

describe("sync controller", () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] }));
  afterEach(() => vi.useRealTimers());

  it("creates an account, pairs a second device and exchanges bookmarks and tabs", async () => {
    const server = new MemorySyncServer();
    const a = app(server, "PC");
    const b = app(server, "iPhone");
    a.bookmark("https://a.example/");
    a.tabs.push({ url: "https://open.example/", title: "Ouvert" });
    await a.controller.createAccount("http://127.0.0.1:1");
    expect(a.status()).toMatchObject({ phase: "idle", configured: true, serverUrl: "http://127.0.0.1:1" });

    const code = (await a.controller.pairingCode())!;
    await b.controller.pair(code);
    expect(b.bookmarks.has(bookmarkLocalId("https://a.example/"))).toBe(true);
    expect(b.status().devices).toMatchObject([{ name: "PC", tabs: [{ url: "https://open.example/" }] }]);
    expect(b.status().keyFingerprint).toBe(a.status().keyFingerprint);

    // A local change is synced after the debounce, then B picks it up on its periodic sync.
    b.bookmark("https://b.example/");
    b.controller.notifyChange();
    await vi.advanceTimersByTimeAsync(1100);
    await vi.advanceTimersByTimeAsync(60_000);
    await a.controller.syncNow();
    expect(a.bookmarks.has(bookmarkLocalId("https://b.example/"))).toBe(true);
    expect(a.status().devices.map((device) => device.name)).toEqual(["iPhone"]);
  });

  it("sends a tab to another device, which receives it once (end-to-end), then forgets it", async () => {
    const server = new MemorySyncServer();
    const a = app(server, "PC");
    const b = app(server, "iPhone");
    await a.controller.createAccount("http://127.0.0.1:1");
    await b.controller.pair((await a.controller.pairingCode())!);
    await a.controller.syncNow();
    const phone = a.status().devices[0];
    expect(await a.controller.sendTab(phone.id, "https://sent.example/", "Envoyé")).toBe(true);
    // Never a non-web page, never to itself.
    expect(await a.controller.sendTab(phone.id, "file:///etc/passwd", "x")).toBe(false);
    expect(await a.controller.sendTab(a.status().deviceId!, "https://self.example/", "x")).toBe(false);
    expect(server.dump()).not.toContain("sent.example");

    await b.controller.syncNow();
    expect(b.status().received).toMatchObject([{ url: "https://sent.example/", title: "Envoyé", fromName: "PC" }]);
    expect(a.status().received).toEqual([]);

    b.controller.dismissReceivedTab(b.status().received[0].id);
    expect(b.status().received).toEqual([]);
    await b.controller.syncNow();
    await a.controller.syncNow();
    await b.controller.syncNow();
    expect(b.status().received).toEqual([]);
  });

  it("rejects a bad pairing code or an unreachable server without changing anything", async () => {
    const server = new MemorySyncServer();
    const a = app(server, "PC");
    await expect(a.controller.pair("browser-sync:1:nope")).rejects.toMatchObject({ kind: "protocol" });
    await expect(a.controller.createAccount("http://example.org")).rejects.toMatchObject({ kind: "protocol" });
    server.offline = true;
    await expect(a.controller.createAccount("https://sync.example.org")).rejects.toMatchObject({ kind: "offline" });
    expect(a.status().configured).toBe(false);
  });

  it("backs off while offline, then recovers", async () => {
    const server = new MemorySyncServer();
    const a = app(server, "PC");
    await a.controller.createAccount("https://sync.example.org");
    server.offline = true;
    await a.controller.syncNow();
    expect(a.status()).toMatchObject({ phase: "offline", error: { kind: "offline" } });
    expect(a.status().retryAt! - Date.now()).toBe(backoffDelay(1));
    await vi.advanceTimersByTimeAsync(backoffDelay(1));
    expect(a.status().retryAt! - Date.now()).toBe(backoffDelay(2));
    server.offline = false;
    await vi.advanceTimersByTimeAsync(backoffDelay(2));
    expect(a.status()).toMatchObject({ phase: "idle", error: null });
    expect(backoffDelay(30)).toBe(15 * 60_000);
  });

  it("reset rotates the key: other devices are cut off, old data is gone", async () => {
    const server = new MemorySyncServer();
    const a = app(server, "PC");
    const b = app(server, "iPhone");
    a.bookmark("https://a.example/");
    await a.controller.createAccount("https://sync.example.org");
    await b.controller.pair((await a.controller.pairingCode())!);
    const before = a.credentials()!;
    await a.controller.reset();
    const after = a.credentials()!;
    expect(after.accountId).not.toBe(before.accountId);
    expect(after.syncKey).not.toBe(before.syncKey);
    await b.controller.syncNow();
    expect(b.status()).toMatchObject({ phase: "error", error: { kind: "auth" }, retryAt: null });
    // Local data stays on each device.
    expect(b.bookmarks.size).toBe(1);
  });

  it("disconnect removes this device from the others' list and forgets the account", async () => {
    const server = new MemorySyncServer();
    const a = app(server, "PC");
    const b = app(server, "iPhone");
    await a.controller.createAccount("https://sync.example.org");
    await b.controller.pair((await a.controller.pairingCode())!);
    await a.controller.syncNow();
    expect(a.status().devices).toHaveLength(1);
    await b.controller.disconnect();
    expect(b.status()).toMatchObject({ configured: false, phase: "off" });
    expect(b.credentials()).toBeNull();
    await a.controller.syncNow();
    expect(a.status().devices).toHaveLength(0);
  });

  it("restores its account and state at startup", async () => {
    const server = new MemorySyncServer();
    const a = app(server, "PC");
    await a.controller.createAccount("https://sync.example.org");
    const deviceId = a.status().deviceId;
    a.controller.dispose();
    const again = new SyncController({
      ...(a.controller as unknown as { platform: SyncPlatform }).platform,
    });
    await again.init();
    expect(again.getStatus()).toMatchObject({ configured: true, deviceId });
  });
});

describe("revoking a device (ADR-056)", () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] }));
  afterEach(() => vi.useRealTimers());

  async function three() {
    const server = new MemorySyncServer();
    const a = app(server, "PC");
    const b = app(server, "iPhone");
    const c = app(server, "Lost laptop");
    a.bookmark("https://a.example/");
    await a.controller.createAccount("https://sync.example.org");
    await b.controller.pair((await a.controller.pairingCode())!);
    await c.controller.pair((await a.controller.pairingCode())!);
    b.bookmark("https://b.example/");
    await b.controller.syncNow();
    await c.controller.syncNow();
    await a.controller.syncNow();
    return { server, a, b, c };
  }

  it("gives every paired device its own relay token", async () => {
    const { a, b, c } = await three();
    const ids = [a, b, c].map((device) => device.credentials()!.authId);
    expect(new Set(ids).size).toBe(3);
    expect(new Set([a, b, c].map((device) => device.credentials()!.token)).size).toBe(3);
    expect(a.status().devices.map((device) => device.authId).sort()).toEqual([ids[1], ids[2]].sort());
  });

  it("rotates the key: the revoked device is locked out, the others follow and re-upload", async () => {
    const { server, a, b, c } = await three();
    const oldKey = a.credentials()!.syncKey;
    const lost = a.status().devices.find((device) => device.name === "Lost laptop")!;
    await a.controller.revokeDevice(lost.id);

    expect(a.credentials()).toMatchObject({ epoch: 1 });
    expect(a.credentials()!.syncKey).not.toBe(oldKey);
    expect(a.status().devices).toHaveLength(0);
    expect(a.status().keyFingerprint).not.toBe(b.status().keyFingerprint);

    // B finds out on its next request (412), unwraps its copy of the new key and uploads again.
    await b.controller.syncNow();
    expect(b.credentials()).toMatchObject({ epoch: 1, syncKey: a.credentials()!.syncKey });
    expect(b.status()).toMatchObject({ phase: "idle", error: null });
    await a.controller.syncNow();
    expect([...a.bookmarks.keys()].sort()).toEqual([...b.bookmarks.keys()].sort());
    expect(a.bookmarks.size).toBe(2);
    expect(a.status().devices.map((device) => device.name)).toEqual(["iPhone"]);

    // C is out: its token is refused, it never sees the new key, and keeps its local copy.
    await c.controller.syncNow();
    expect(c.status()).toMatchObject({ phase: "error", error: { kind: "auth" } });
    expect(c.credentials()!.syncKey).toBe(oldKey);
    expect(c.bookmarks.size).toBe(2);
    expect(server.dump()).not.toContain("example");
  });

  it("refuses an unknown device", async () => {
    const { a } = await three();
    await expect(a.controller.revokeDevice("0123456789abcdef")).rejects.toMatchObject({ kind: "protocol" });
  });

  it("moves a device off the legacy shared token, which the rotation then revokes", async () => {
    const server = new MemorySyncServer();
    const a = app(server, "PC");
    const old = app(server, "Old phone");
    await a.controller.createAccount("https://sync.example.org");
    // An account from before ADR-056: the old phone pairs with the shared token and no auth id.
    const shared = { ...a.credentials()!, token: "legacy-token-shared-by-every-device-0000" };
    delete shared.authId;
    server.makeLegacy(shared.accountId, shared.token);
    await old.controller.pair(encodePairingCode(shared));
    expect(old.credentials()!.authId).toMatch(/^[0-9a-f]{32}$/);
    expect(old.credentials()!.token).not.toBe(shared.token);
    await a.controller.syncNow();
    const phone = a.status().devices.find((device) => device.name === "Old phone")!;
    expect(phone.authId).toBe(old.credentials()!.authId);
    await a.controller.revokeDevice(phone.id);
    const attempt = await server.transport({ method: "GET", url: "https://sync.example.org/v1/devices", headers: { authorization: `Bearer ${shared.accountId}.${shared.token}` } });
    expect(attempt.status).toBe(401);
  });
});

describe("rotation (pure)", () => {
  const base: SyncCredentials = { serverUrl: "https://s.example", accountId: "a".repeat(32), token: "t".repeat(43), syncKey: toBase64Url(rng(32)), authId: "1".repeat(32), epoch: 0 };
  const relay = { epoch: 0, self: "1".repeat(32), legacy: false, devices: ["1", "2", "3", "4"].map((n) => ({ authId: n.repeat(32), createdAt: 0, pending: false })) };

  it("wraps the new key only for the devices kept, and revokes every other token", () => {
    const plan = planRotation(base, relay, ["2".repeat(32)], rng);
    expect(plan.epoch).toBe(1);
    expect(Object.keys(plan.wraps).sort()).toEqual(["1".repeat(32), "2".repeat(32)]);
    expect(plan.revoke.sort()).toEqual(["3".repeat(32), "4".repeat(32)]);
    // The kept device recovers the same key with its own wrap, bound to its auth id.
    const kept = followRotation({ ...base, authId: "2".repeat(32) }, { epoch: 1, wraps: [{ epoch: 1, wrap: plan.wraps["2".repeat(32)] }] });
    expect(kept?.syncKey).toBe(plan.next.syncKey);
    expect(followRotation({ ...base, authId: "3".repeat(32) }, { epoch: 1, wraps: [{ epoch: 1, wrap: plan.wraps["2".repeat(32)] }] })).toBeNull();
  });

  it("chains several rotations and refuses gaps or tampering", () => {
    const first = planRotation(base, relay, ["2".repeat(32)], rng);
    const second = planRotation(first.next, { ...relay, epoch: 1 }, ["2".repeat(32)], rng);
    const two = { ...base, authId: "2".repeat(32) };
    const wraps = [first, second].map((plan) => ({ epoch: plan.epoch, wrap: plan.wraps["2".repeat(32)] }));
    expect(followRotation(two, { epoch: 2, wraps })?.syncKey).toBe(second.next.syncKey);
    expect(followRotation(two, { epoch: 2, wraps: [wraps[1]] })).toBeNull();
    const tampered = wraps[0].wrap.slice(0, -2) + (wraps[0].wrap.endsWith("A") ? "BB" : "AA");
    expect(followRotation(two, { epoch: 1, wraps: [{ epoch: 1, wrap: tampered }] })).toBeNull();
    // A wrap replayed under another epoch does not open.
    expect(followRotation({ ...two, epoch: 1, syncKey: base.syncKey }, { epoch: 2, wraps: [{ epoch: 2, wrap: wraps[0].wrap }] })).toBeNull();
  });

  it("only plans from this device's own token at the relay's epoch", () => {
    expect(() => planRotation({ ...base, authId: undefined }, relay, [], rng)).toThrow();
    expect(() => planRotation(base, { ...relay, epoch: 3 }, [], rng)).toThrow();
  });
});
