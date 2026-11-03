import { DEFAULT_SETTINGS } from "@shared/settings";
import { Store } from "../store";
import { BookmarksStore } from "./bookmarks";
import { HistoryStore } from "./history";
import { SettingsStore } from "./settings";
import { ArchiveStore, TabsStore } from "./tabs";
import { createStores, loadStores, persistStores } from "./index";

const mockStorage = new Map<string, string>();
jest.mock("@react-native-async-storage/async-storage", () => ({
  getItem: jest.fn(async (key: string) => mockStorage.get(key) ?? null),
  setItem: jest.fn(async (key: string, value: string) => void mockStorage.set(key, value)),
  multiRemove: jest.fn(async (keys: string[]) => keys.forEach((key) => mockStorage.delete(key))),
}));

describe("Store", () => {
  it("notifies on change only, and reads its writes back at once", () => {
    const store = new Store(1);
    const listener = jest.fn();
    const stop = store.subscribe(listener);
    store.set(1);
    expect(listener).not.toHaveBeenCalled();
    store.set((value) => value + 1);
    expect(store.get()).toBe(2);
    expect(listener).toHaveBeenCalledTimes(1);
    stop();
    store.set(3);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe("TabsStore", () => {
  it("runs the tabs reducer, and restores a session only when asked", () => {
    const tabs = new TabsStore();
    tabs.dispatch({ type: "open", id: "t1", url: "https://example.com/", spaceId: tabs.get().activeSpaceId, now: 1 });
    expect(tabs.get().tabs.map((tab) => tab.id)).toEqual(["t1"]);
    const restored = new TabsStore();
    const session = { tabs: [{ id: "x", url: "https://a.example/", title: "A" }], activeTabId: "x" };
    restored.hydrate(session, false);
    expect(restored.get().tabs).toHaveLength(0);
  });

  it("archives and restores entries", () => {
    const archive = new ArchiveStore();
    archive.add([{ id: "a", url: "https://a.example/", title: "A", favicon: null, spaceId: null, archivedAt: 1 }]);
    expect(archive.get()).toHaveLength(1);
    archive.remove("a");
    expect(archive.get()).toHaveLength(0);
  });
});

describe("HistoryStore", () => {
  it("bumps its version on visits, and remembers what the user deleted", () => {
    const history = new HistoryStore();
    history.recordVisit("https://a.example/", "A", 1_000);
    expect(history.get().version).toBe(1);
    const before = history.get();
    history.clear();
    expect(history.get()).not.toBe(before);
    expect(history.history.toJSON()).toHaveLength(0);
    expect(history.isDeleted("https://a.example/")).toBe(true);
    expect(history.isDeleted("https://b.example/")).toBe(false);
  });
});

describe("BookmarksStore", () => {
  it("toggles bookmarks and favorites", () => {
    const store = new BookmarksStore();
    const page = { url: "https://a.example/", title: "A" };
    store.toggle(page, "b1", 1);
    expect(store.bookmarks.map((bookmark) => bookmark.url)).toEqual([page.url]);
    store.toggle(page, "b2", 2);
    expect(store.bookmarks).toHaveLength(0);
    store.toggleFavorite(page, 3);
    expect(store.favorites.map((favorite) => favorite.url)).toEqual([page.url]);
    store.toggleFavorite(page, 4);
    expect(store.favorites).toHaveLength(0);
  });

  it("keeps the other parts when one changes", () => {
    const store = new BookmarksStore();
    store.toggleFavorite({ url: "https://f.example/", title: "F" }, 1);
    const favorites = store.favorites;
    store.toggle({ url: "https://a.example/", title: "A" }, "b1", 1);
    expect(store.favorites).toBe(favorites);
  });
});

describe("SettingsStore", () => {
  it("merges patches and sanitizes the phone's own settings", () => {
    const store = new SettingsStore();
    store.update({ behavior: { restoreSession: false } });
    expect(store.settings.behavior.restoreSession).toBe(false);
    expect(store.settings.appearance).toEqual(DEFAULT_SETTINGS.appearance);
    store.updateMobile({ haptics: false });
    expect(store.mobile.haptics).toBe(false);
    store.updateMobile({ haptics: "yes" } as never);
    expect(store.mobile.haptics).toBe(false);
  });
});

describe("loading and saving the stores", () => {
  beforeEach(() => {
    mockStorage.clear();
    jest.useFakeTimers();
  });
  afterEach(() => jest.useRealTimers());

  it("saves each document after a change, and loads it back", async () => {
    const stores = createStores();
    expect(await loadStores(stores)).toBe(true);
    const stop = persistStores(stores);
    stores.bookmarks.toggle({ url: "https://a.example/", title: "A" }, "b1", 1);
    stores.settings.update({ search: { engine: "duckduckgo" } });
    stores.history.recordVisit("https://a.example/", "A", 1_000);
    await jest.runAllTimersAsync();
    stop();
    expect(JSON.parse(mockStorage.get("browser.bookmarks")!).data).toHaveLength(1);

    const again = createStores();
    await loadStores(again);
    expect(again.bookmarks.bookmarks.map((bookmark) => bookmark.url)).toEqual(["https://a.example/"]);
    expect(again.settings.settings.search.engine).toBe("duckduckgo");
    expect(again.history.history.toJSON().map((entry) => entry.url)).toEqual(["https://a.example/"]);
  });

  it("stops loading when cancelled", async () => {
    const stores = createStores();
    expect(await loadStores(stores, () => true)).toBe(false);
  });
});
