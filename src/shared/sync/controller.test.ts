import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SyncController, backoffDelay, type SyncPlatform, type SyncStatus } from "./controller";
import type { CollectionAdapter } from "./engine";
import { MemorySyncServer } from "./memory-server";
import type { SyncCredentials } from "./pairing";
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

    const code = a.controller.pairingCode()!;
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
    await b.controller.pair(a.controller.pairingCode()!);
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
    await b.controller.pair(a.controller.pairingCode()!);
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
