import type { History } from "@shared/history";
import { mergeSettings, type Settings } from "@shared/settings";
import { MAX_SPACES } from "@shared/spaces";
import type { CollectionAdapter } from "@shared/sync/engine";
import {
  SETTINGS_RECORD,
  bookmarkLocalId,
  bookmarkRecord,
  folderLocalId,
  historyInScope,
  historyRecord,
  mergeHistoryEntry,
  mergeSpaces,
  pickSyncedSettings,
  sanitizeSyncedBookmark,
  sanitizeSyncedHistory,
  sanitizeSyncedSettings,
  sanitizeSyncedSpace,
  spaceRecord,
  syncedSettingsPatch,
  type SyncedBookmark,
  type SyncedHistory,
  type SyncedSettings,
  type SyncedSpace,
  type SyncedTab,
} from "@shared/sync/records";
import type { Bookmark } from "@shared/types";
import { MAX_BOOKMARKS } from "../bookmarks";
import { isPrivateTab, type TabsAction, type TabsModel } from "../tabs";

/**
 * Phone side of the synced collections (ADR-019). Pure: they read and write through a store
 * interface (the BrowserProvider in the app, plain objects in tests). Writes must be visible to the
 * next read at once (the engine re-reads right after applying remote changes).
 */

/** Bookmark folders exist on the desktop; the phone keeps them (unseen) so they survive sync. */
export interface BookmarkFolder {
  id: string;
  name: string;
  createdAt: number;
}

export interface MobileSyncStore {
  settings(): Settings;
  setSettings(next: Settings): void;
  model(): TabsModel;
  dispatch(action: TabsAction): void;
  bookmarks(): Bookmark[];
  folders(): BookmarkFolder[];
  setBookmarks(bookmarks: Bookmark[], folders: BookmarkFolder[]): void;
  history(): History;
  historyChanged(): void;
  /**
   * Whether the user deleted this page from the history ("Effacer l'historique"). Pages that only
   * left the local history because it is full are not deletions: they must not be deleted elsewhere.
   */
  historyDeleted(url: string): boolean;
  newId(): string;
  now(): number;
}

/** Open tabs to publish: never private ones, never the start page. */
export function mobileTabs(model: TabsModel): SyncedTab[] {
  return model.tabs
    .filter((tab) => !isPrivateTab(tab) && /^https?:\/\//i.test(tab.url))
    .sort((a, b) => b.lastActiveAt - a.lastActiveAt)
    .map((tab) => ({ url: tab.url, title: tab.title }));
}

function settingsAdapter(store: MobileSyncStore): CollectionAdapter<SyncedSettings> {
  return {
    name: "settings",
    snapshot: () => new Map([[SETTINGS_RECORD, pickSyncedSettings(store.settings())]]),
    sanitize: (value, id) => (id === SETTINGS_RECORD ? sanitizeSyncedSettings(value) : null),
    apply: ({ upserts }) => {
      for (const { data } of upserts) store.setSettings(mergeSettings(store.settings(), syncedSettingsPatch(data)));
    },
  };
}

function spacesAdapter(store: MobileSyncStore): CollectionAdapter<SyncedSpace> {
  return {
    name: "spaces",
    snapshot: () => new Map(store.model().spaces.map((space, index) => [space.id, spaceRecord(space, index)])),
    sanitize: (value) => sanitizeSyncedSpace(value),
    apply: ({ upserts, deletes }) => {
      const spaces = mergeSpaces(store.model().spaces, upserts.map((change) => [change.id, change.data]), deletes, MAX_SPACES);
      store.dispatch({ type: "sync-spaces", spaces });
    },
  };
}

function bookmarksAdapter(store: MobileSyncStore): CollectionAdapter<SyncedBookmark> {
  return {
    name: "bookmarks",
    snapshot: () => {
      const map = new Map<string, SyncedBookmark>();
      for (const folder of store.folders()) map.set(folderLocalId(folder.id), { kind: "folder", name: folder.name, createdAt: folder.createdAt });
      for (const bookmark of store.bookmarks()) {
        if (/^https?:\/\//i.test(bookmark.url) && !map.has(bookmarkLocalId(bookmark.url))) map.set(bookmarkLocalId(bookmark.url), bookmarkRecord(bookmark));
      }
      return map;
    },
    sanitize: (value, id) => sanitizeSyncedBookmark(value, id),
    apply: ({ upserts, deletes }) => {
      const folders = new Map(store.folders().map((folder) => [folder.id, folder]));
      const bookmarks = new Map(store.bookmarks().map((bookmark) => [bookmark.url, bookmark]));
      for (const id of deletes) {
        if (id.startsWith("f:")) folders.delete(id.slice(2));
        else if (id.startsWith("b:")) bookmarks.delete(id.slice(2));
      }
      for (const { id, data } of upserts) {
        if (data.kind === "folder") folders.set(id.slice(2), { id: id.slice(2), name: data.name, createdAt: data.createdAt });
      }
      for (const { data } of upserts) {
        if (data.kind !== "bookmark") continue;
        const existing = bookmarks.get(data.url);
        const folderId = data.folderId && folders.has(data.folderId) ? data.folderId : undefined;
        bookmarks.set(data.url, {
          id: existing?.id ?? store.newId(),
          url: data.url,
          title: data.title,
          favicon: null,
          createdAt: data.createdAt,
          ...(folderId ? { folderId } : {}),
        });
      }
      // Newest last, like toggleBookmark.
      const list = [...bookmarks.values()].sort((a, b) => a.createdAt - b.createdAt).slice(-MAX_BOOKMARKS);
      store.setBookmarks(list, [...folders.values()]);
    },
  };
}

function historyAdapter(store: MobileSyncStore): CollectionAdapter<SyncedHistory> {
  return {
    name: "history",
    snapshot: () => new Map(historyInScope(store.history().toJSON(), store.now()).map((entry) => [entry.url, historyRecord(entry)])),
    exists: (id) => store.history().get(id) !== undefined || !store.historyDeleted(id),
    sanitize: (value, id) => sanitizeSyncedHistory(value, id),
    apply: ({ upserts, deletes }) => {
      const history = store.history();
      history.upsertMany(upserts.map(({ data }) => mergeHistoryEntry(history.get(data.url), data)));
      for (const url of deletes) history.remove(url);
      store.historyChanged();
    },
  };
}

export function mobileAdapters(store: MobileSyncStore): CollectionAdapter[] {
  return [settingsAdapter(store), spacesAdapter(store), bookmarksAdapter(store), historyAdapter(store)] as CollectionAdapter[];
}
