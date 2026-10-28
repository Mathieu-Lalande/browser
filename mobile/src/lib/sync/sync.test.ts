/// <reference types="node" />
import type { Favorite } from "@shared/favorites";
import { History } from "@shared/history";
import { DEFAULT_SETTINGS, mergeSettings, type Settings } from "@shared/settings";
import { toBase64Url } from "@shared/sync/bytes";
import { SyncController, type SyncStatus } from "@shared/sync/controller";
import { deriveKeys, generateSyncKey, open, recordId, seal } from "@shared/sync/crypto";
import type { CollectionAdapter } from "@shared/sync/engine";
import { MemorySyncServer } from "@shared/sync/memory-server";
import type { SyncCredentials } from "@shared/sync/pairing";
import { bookmarkLocalId, type SyncedBookmark } from "@shared/sync/records";
import type { Bookmark } from "@shared/types";
// The desktop's own RNG adapter (Node crypto), to prove both platforms interoperate.
import { nodeRandomBytes } from "../../../../src/main/sync/random";
import { initialTabsModel, tabsReducer, type TabsModel } from "../tabs";
import type { BookmarkFolder, MobileSyncStore } from "./adapters";
import { createMobileSync, expoRandomBytes } from "./platform";

jest.mock("expo-crypto", () => ({
  // What expo-crypto does natively (SecRandomCopyBytes / SecureRandom), from Node in tests.
  getRandomBytes: (length: number) => new Uint8Array(jest.requireActual<typeof import("node:crypto")>("node:crypto").randomBytes(length)),
}));
jest.mock("expo-secure-store", () => ({ getItemAsync: jest.fn(), setItemAsync: jest.fn(), deleteItemAsync: jest.fn(), WHEN_UNLOCKED_THIS_DEVICE_ONLY: 0 }));
jest.mock("@react-native-async-storage/async-storage", () => ({ getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() }));

/** The phone's state, as plain objects (the BrowserProvider in the app). */
function phone(server: MemorySyncServer) {
  const data = {
    settings: DEFAULT_SETTINGS as Settings,
    model: initialTabsModel() as TabsModel,
    bookmarks: [] as Bookmark[],
    folders: [] as BookmarkFolder[],
    favorites: [] as Favorite[],
    history: new History([], 5000),
    deleted: new Set<string>(),
  };
  let id = 0;
  const store: MobileSyncStore = {
    settings: () => data.settings,
    setSettings: (next) => void (data.settings = next),
    model: () => data.model,
    dispatch: (action) => void (data.model = tabsReducer(data.model, action)),
    bookmarks: () => data.bookmarks,
    folders: () => data.folders,
    setBookmarks: (bookmarks, folders) => {
      data.bookmarks = bookmarks;
      data.folders = folders;
    },
    favorites: () => data.favorites,
    setFavorites: (next) => void (data.favorites = next),
    history: () => data.history,
    historyChanged: () => {},
    historyDeleted: (url) => data.deleted.has(url),
    newId: () => `m${++id}`,
    now: () => Date.now(),
  };
  let credentials: SyncCredentials | null = null;
  let state: unknown = null;
  const statuses: SyncStatus[] = [];
  const sync = createMobileSync({
    store,
    onStatus: (status) => void statuses.push(status),
    transport: server.transport,
    credentials: { load: async () => credentials, save: async (value) => void (credentials = value) },
    state: { load: async () => state, save: (value) => void (state = value) },
  });
  return { data, store, sync, statuses, open: (url: string, isPrivate = false) => store.dispatch({ type: "open", id: store.newId(), url, now: Date.now(), spaceId: isPrivate ? "private" : undefined }) };
}

/** A minimal desktop: the shared controller with Node's RNG and plain bookmark/tab adapters. */
function desktop(server: MemorySyncServer) {
  const bookmarks = new Map<string, SyncedBookmark>();
  let settings = DEFAULT_SETTINGS;
  let credentials: SyncCredentials | null = null;
  let state: unknown = null;
  const adapters: CollectionAdapter[] = [
    {
      name: "bookmarks",
      snapshot: () => new Map(bookmarks),
      sanitize: (value) => value,
      apply: ({ upserts, deletes }) => {
        for (const { id, data } of upserts) bookmarks.set(id, data as SyncedBookmark);
        for (const id of deletes) bookmarks.delete(id);
      },
    },
    {
      name: "settings",
      snapshot: () => new Map([["prefs", { mode: settings.appearance.mode, accent: settings.appearance.accent, accent2: settings.appearance.accent2, engine: settings.search.engine, startPage: settings.startPage }]]),
      sanitize: (value) => value,
      apply: () => {},
    },
  ];
  const sync = new SyncController({
    transport: server.transport,
    rng: nodeRandomBytes,
    kind: "desktop",
    deviceName: () => "PC de Mathieu",
    localTabs: () => [{ url: "https://desktop.example/", title: "Sur le PC" }],
    adapters: () => adapters,
    loadCredentials: async () => credentials,
    saveCredentials: async (value) => void (credentials = value),
    loadState: async () => state,
    saveState: (value) => void (state = value),
    onStatus: () => {},
  });
  return { sync, bookmarks, setSettings: (next: Settings) => void (settings = next) };
}

describe("mobile sync adapters", () => {
  it("pairs with a desktop and exchanges bookmarks, settings, spaces and tabs (never private tabs)", async () => {
    const server = new MemorySyncServer();
    const pc = desktop(server);
    pc.bookmarks.set(bookmarkLocalId("https://from-pc.example/"), { kind: "bookmark", url: "https://from-pc.example/", title: "Du PC", createdAt: 1 });
    pc.setSettings(mergeSettings(DEFAULT_SETTINGS, { appearance: { mode: "dark", accent: "#10b981" }, search: { engine: "brave" } }));
    await pc.sync.createAccount("https://sync.example.org");

    const iphone = phone(server);
    iphone.open("https://public.example/");
    iphone.open("https://secret.example/", true);
    await iphone.sync.pair(pc.sync.pairingCode()!);

    // The account's data won on the phone's first sync.
    expect(iphone.data.bookmarks.map((bookmark) => bookmark.url)).toEqual(["https://from-pc.example/"]);
    expect(iphone.data.settings.appearance).toMatchObject({ mode: "dark", accent: "#10b981" });
    expect(iphone.data.settings.search.engine).toBe("brave");
    expect(iphone.sync.getStatus().devices).toMatchObject([{ name: "PC de Mathieu", kind: "desktop", tabs: [{ url: "https://desktop.example/" }] }]);

    // Back to the PC: the phone's tabs, without the private one.
    await pc.sync.syncNow();
    const phoneTabs = pc.sync.getStatus().devices[0].tabs.map((tab) => tab.url);
    expect(phoneTabs).toEqual(["https://public.example/"]);
    expect(server.dump()).not.toContain("secret.example");

    // A bookmark saved on the phone reaches the PC; removing it there removes it here.
    iphone.data.bookmarks = [...iphone.data.bookmarks, { id: "x", url: "https://from-phone.example/", title: "Du téléphone", favicon: null, createdAt: 2 }];
    await iphone.sync.syncNow();
    await pc.sync.syncNow();
    expect(pc.bookmarks.has(bookmarkLocalId("https://from-phone.example/"))).toBe(true);
    pc.bookmarks.delete(bookmarkLocalId("https://from-phone.example/"));
    await pc.sync.syncNow();
    await iphone.sync.syncNow();
    expect(iphone.data.bookmarks.map((bookmark) => bookmark.url)).toEqual(["https://from-pc.example/"]);

    // A space created on the phone is synced (its tabs are not).
    iphone.store.dispatch({ type: "add-space", id: "space-travel", input: { name: "Voyages", icon: "plane" } });
    await iphone.sync.syncNow();
    expect(server.dump()).not.toContain("Voyages");
  });

  it("syncs the favorites grid (ADR-022): additions, order and removals, never favicons", async () => {
    const server = new MemorySyncServer();
    const a = phone(server);
    a.data.favorites = [
      { url: "https://mail.example/", title: "Mail", favicon: "data:image/png;base64,AA", createdAt: 1 },
      { url: "https://agenda.example/", title: "Agenda", favicon: null, createdAt: 2 },
    ];
    await a.sync.createAccount("https://sync.example.org");
    const b = phone(server);
    await b.sync.pair(a.sync.pairingCode()!);
    expect(b.data.favorites.map((favorite) => favorite.url)).toEqual(["https://mail.example/", "https://agenda.example/"]);
    expect(b.data.favorites[0].favicon).toBeNull();
    expect(server.dump()).not.toContain("mail.example");

    // Reordered and one removed on B: A follows.
    b.data.favorites = [b.data.favorites[1]];
    await b.sync.syncNow();
    await a.sync.syncNow();
    expect(a.data.favorites.map((favorite) => favorite.url)).toEqual(["https://agenda.example/"]);
  });

  it("history pruned on a full phone is not deleted elsewhere, a cleared history is", async () => {
    const server = new MemorySyncServer();
    const a = phone(server);
    const now = Date.now();
    a.data.history.recordVisit("https://kept.example/", now - 1000);
    await a.sync.createAccount("https://sync.example.org");
    const b = phone(server);
    await b.sync.pair(a.sync.pairingCode()!);
    expect(b.data.history.get("https://kept.example/")).toBeDefined();

    // Gone from A without being deleted by the user (capacity): B keeps it.
    a.data.history.remove("https://kept.example/");
    await a.sync.syncNow();
    await b.sync.syncNow();
    expect(b.data.history.get("https://kept.example/")).toBeDefined();

    // Cleared on B by the user: deleted on A too.
    a.data.history.recordVisit("https://kept.example/", now);
    await a.sync.syncNow();
    await b.sync.syncNow();
    for (const entry of b.data.history.toJSON()) b.data.deleted.add(entry.url);
    b.data.history.clear();
    await b.sync.syncNow();
    await a.sync.syncNow();
    expect(a.data.history.get("https://kept.example/")).toBeUndefined();
  });
});

describe("desktop/mobile crypto interop", () => {
  it("a record sealed with the desktop RNG opens on the phone, and the other way round", () => {
    const syncKey = generateSyncKey(nodeRandomBytes);
    // Both sides derive their keys from the same pairing code payload.
    const desktopKeys = deriveKeys(syncKey);
    const phoneKeys = deriveKeys(Uint8Array.from(syncKey));
    expect(phoneKeys.fingerprint).toBe(desktopKeys.fingerprint);
    const rid = recordId(desktopKeys, "bookmarks", "b:https://exemple.fr/été");
    expect(recordId(phoneKeys, "bookmarks", "b:https://exemple.fr/été")).toBe(rid);

    const fromDesktop = seal(desktopKeys, nodeRandomBytes, "bookmarks", rid, JSON.stringify({ title: "Été à Noël 😀" }));
    expect(JSON.parse(open(phoneKeys, "bookmarks", rid, fromDesktop))).toEqual({ title: "Été à Noël 😀" });
    const fromPhone = seal(phoneKeys, expoRandomBytes, "bookmarks", rid, "réponse");
    expect(open(desktopKeys, "bookmarks", rid, fromPhone)).toBe("réponse");
    expect(toBase64Url(syncKey)).toHaveLength(43);
  });
});
