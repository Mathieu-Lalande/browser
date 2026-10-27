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
} from "@shared/sync/records";
import type { HistoryEntry } from "@shared/types";
import { profile } from "../profile";
import { settings, updateSettings } from "../settings";
import { spaces } from "../spaces";
import { BrowserController } from "../window";

/**
 * Desktop side of the synced collections (ADR-019): each adapter reads the profile and applies
 * changes from other devices through the same code paths as the UI. Private windows never feed
 * anything in: they write no history, are not in the session, and their tabs are not listed.
 */

function settingsAdapter(): CollectionAdapter<SyncedSettings> {
  return {
    name: "settings",
    snapshot: () => new Map([[SETTINGS_RECORD, pickSyncedSettings(settings())]]),
    sanitize: (value, id) => (id === SETTINGS_RECORD ? sanitizeSyncedSettings(value) : null),
    apply: ({ upserts }) => {
      for (const { data } of upserts) updateSettings(syncedSettingsPatch(data));
    },
  };
}

function spacesAdapter(): CollectionAdapter<SyncedSpace> {
  return {
    name: "spaces",
    snapshot: () => new Map(spaces.list().map((space, index) => [space.id, spaceRecord(space, index)])),
    sanitize: (value) => sanitizeSyncedSpace(value),
    apply: ({ upserts, deletes }) => {
      spaces.applySynced(mergeSpaces(spaces.list(), upserts.map((change) => [change.id, change.data]), deletes, MAX_SPACES));
    },
  };
}

function bookmarksAdapter(): CollectionAdapter<SyncedBookmark> {
  return {
    name: "bookmarks",
    snapshot: () => {
      const { bookmarks } = profile();
      const map = new Map<string, SyncedBookmark>();
      for (const folder of bookmarks.folderList()) map.set(folderLocalId(folder.id), { kind: "folder", name: folder.name, createdAt: folder.createdAt });
      for (const bookmark of bookmarks.list()) {
        if (/^https?:\/\//i.test(bookmark.url) && !map.has(bookmarkLocalId(bookmark.url))) map.set(bookmarkLocalId(bookmark.url), bookmarkRecord(bookmark));
      }
      return map;
    },
    sanitize: (value, id) => sanitizeSyncedBookmark(value, id),
    apply: ({ upserts, deletes }) => {
      const { bookmarks, saveBookmarks } = profile();
      // Folders first, so bookmarks can be filed in them.
      for (const { id, data } of upserts) if (data.kind === "folder") bookmarks.upsertFolder({ id: id.slice(2), name: data.name, createdAt: data.createdAt });
      for (const { data } of upserts) if (data.kind === "bookmark") bookmarks.upsertByUrl(data);
      for (const id of deletes) {
        if (id.startsWith("b:")) bookmarks.removeByUrl(id.slice(2));
        else if (id.startsWith("f:")) bookmarks.removeFolder(id.slice(2));
      }
      saveBookmarks();
      BrowserController.refreshAll();
    },
  };
}

function historyAdapter(now: () => number): CollectionAdapter<SyncedHistory> {
  return {
    name: "history",
    snapshot: () => new Map(historyInScope(profile().history.toJSON(), now()).map((entry) => [entry.url, historyRecord(entry)])),
    exists: (id) => profile().history.get(id) !== undefined,
    sanitize: (value, id) => sanitizeSyncedHistory(value, id),
    apply: ({ upserts, deletes }) => {
      const { history, saveHistory } = profile();
      const merged: HistoryEntry[] = upserts.map(({ data }) => mergeHistoryEntry(history.get(data.url), data));
      history.upsertMany(merged);
      for (const url of deletes) history.remove(url);
      saveHistory();
    },
  };
}

export function desktopAdapters(now: () => number = Date.now): CollectionAdapter[] {
  return [settingsAdapter(), spacesAdapter(), bookmarksAdapter(), historyAdapter(now)] as CollectionAdapter[];
}
