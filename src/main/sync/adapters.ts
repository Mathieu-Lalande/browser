import { addressRecord, mergeSyncedAddresses, sanitizeSyncedAddress, type SyncedAddress } from "@shared/autofill/model";
import { annotationRecords, mergeAnnotations, sanitizeSyncedAnnotation, type SyncedAnnotation } from "@shared/annotations/sync";
import { boostRecord, mergeBoosts, sanitizeSyncedBoost, type SyncedBoost } from "@shared/boosts";
import { nativeImage } from "electron";
import { FAVORITE_FIELDS, favoriteLocalId, favoriteRecord, mergeFavorites, sanitizeSyncedFavorite, type SyncedFavorite } from "@shared/favorites";
import {
  applySiteIcons,
  collectSiteIcons,
  fillFavicons,
  isSyncableFavicon,
  sanitizeSyncedFavicon,
  siteIconRecords,
  type SiteIcons,
  type SyncedFavicon,
} from "@shared/sync/favicons";
import { MAX_SPACES } from "@shared/spaces";
import { mergeSyncedPasswords, passwordRecords, sanitizeSyncedPassword, type SyncedPassword } from "@shared/passwords-sync";
import { mergePanels, panelRecord, sanitizeSyncedPanel, type SyncedPanel } from "@shared/panels";
import { mergeReadingList, readingRecord, sanitizeSyncedReading, type SyncedReading } from "@shared/reading-list";
import type { CollectionAdapter } from "@shared/sync/engine";
import {
  BOOKMARK_FIELDS,
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
import { setProfileAnnotations } from "../annotations";
import { profile } from "../profile";
import { settings, updateSettings } from "../settings";
import { spaces } from "../spaces";
import type { AutofillService } from "../autofill/service";
import type { BoostService } from "../boosts/service";
import type { WindowDirectory } from "../ports";
import type { PanelService } from "../panels/service";
import type { PasswordVaultStore } from "../passwords/vault";
import type { ReadingListService } from "../reading/service";

/**
 * Desktop side of the synced collections (ADR-019): each adapter reads the profile and applies
 * changes from other devices through the same code paths as the UI. Private windows never feed
 * anything in: they write no history, are not in the session, and their tabs are not listed.
 */

/** What the adapters need besides the profile: the windows to refresh, the boosts to apply. */
export interface AdapterDeps {
  windows: Pick<WindowDirectory, "refreshAll">;
  boosts: Pick<BoostService, "setBoosts">;
  /** Saved addresses (ADR-041, opt-in); cards are never handed to sync. */
  autofill?: Pick<AutofillService, "addresses" | "store" | "replace">;
  /** Web panels (ADR-047, opt-in) and the reading list (ADR-047). */
  panels?: Pick<PanelService, "list" | "replace">;
  reading?: Pick<ReadingListService, "replace">;
  /** Saved passwords (ADR-050, opt-in): synced only while the keychain vault is usable. */
  passwords?: { vault: Pick<PasswordVaultStore, "current" | "write" | "status">; newId: () => string };
  /** Synced site icons (ADR-057, `site-icons.json`). */
  siteIcons?: { load(): SiteIcons; save(next: SiteIcons): void };
  now?: () => number;
}

function settingsAdapter(): CollectionAdapter<SyncedSettings> {
  return {
    name: "settings",
    snapshot: () => new Map([[SETTINGS_RECORD, pickSyncedSettings(settings())]]),
    sanitize: (value, id) => (id === SETTINGS_RECORD ? sanitizeSyncedSettings(value) : null),
    apply: ({ upserts }) => {
      for (const { data } of upserts) updateSettings(syncedSettingsPatch(data, settings()));
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

function bookmarksAdapter(deps: AdapterDeps): CollectionAdapter<SyncedBookmark> {
  return {
    name: "bookmarks",
    fields: BOOKMARK_FIELDS,
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
      deps.windows.refreshAll();
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

/** The favorites grid (ADR-022): keyed by URL, with its position; favicons stay on each device. */
function favoritesAdapter(deps: AdapterDeps): CollectionAdapter<SyncedFavorite> {
  return {
    name: "favorites",
    fields: FAVORITE_FIELDS,
    snapshot: () => new Map(profile().favorites.list().map((favorite, index) => [favoriteLocalId(favorite.url), favoriteRecord(favorite, index)])),
    sanitize: (value, id) => sanitizeSyncedFavorite(value, id),
    apply: ({ upserts, deletes }) => {
      const { favorites, saveFavorites } = profile();
      if (favorites.replace(mergeFavorites(favorites.list(), upserts.map((change) => change.data), deletes))) {
        saveFavorites();
        deps.windows.refreshAll();
      }
    },
  };
}

/** A bookmark's or favorite's icon as a small PNG (32, else 16 px), or null when it cannot fit 4 KB. */
function smallPng(icon: string): string | null {
  if (isSyncableFavicon(icon)) return icon;
  if (!/^data:image\//.test(icon)) return null;
  try {
    const image = nativeImage.createFromDataURL(icon);
    if (image.isEmpty()) return null;
    for (const size of [32, 16]) {
      const png = image.resize({ width: size, height: size, quality: "best" }).toDataURL();
      if (isSyncableFavicon(png)) return png;
    }
  } catch {
    // Not an image Chromium can read.
  }
  return null;
}

/**
 * Site icons (ADR-057): one small PNG per origin of the bookmarks and favorites, kept in
 * `site-icons.json`; other devices' icons fill the bookmarks and favorites that have none.
 */
function faviconsAdapter(store: NonNullable<AdapterDeps["siteIcons"]>, deps: AdapterDeps, now: () => number): CollectionAdapter<SyncedFavicon> {
  return {
    name: "favicons",
    snapshot: () => {
      const { bookmarks, favorites } = profile();
      const current = store.load();
      const next = collectSiteIcons(current, [...favorites.list(), ...bookmarks.list()], now(), smallPng);
      if (next !== current) store.save(next);
      return siteIconRecords(next);
    },
    sanitize: (value, id) => sanitizeSyncedFavicon(value, id),
    apply: ({ upserts, deletes }) => {
      const before = store.load();
      const replaced = new Map(upserts.flatMap(({ id }) => (before[id] ? [[id, before[id].icon] as const] : [])));
      const next = applySiteIcons(before, upserts, deletes, now());
      store.save(next);
      const { bookmarks, favorites, saveBookmarks, saveFavorites } = profile();
      const marks = bookmarks.fillFavicons((list) => fillFavicons(list, next, replaced));
      if (marks) saveBookmarks();
      const tiles = favorites.replace(fillFavicons(favorites.list(), next, replaced));
      if (tiles) saveFavorites();
      if (marks || tiles) deps.windows.refreshAll();
    },
  };
}

/** Boosts (ADR-029): keyed by boost id; a script travels only while it is enabled. */
function boostsAdapter(deps: AdapterDeps): CollectionAdapter<SyncedBoost> {
  return {
    name: "boosts",
    snapshot: () => new Map(profile().boosts.map((boost) => [boost.id, boostRecord(boost)])),
    sanitize: (value, id) => sanitizeSyncedBoost(value, id),
    apply: ({ upserts, deletes }) => {
      deps.boosts.setBoosts(mergeBoosts(profile().boosts, upserts.map((change) => [change.id, change.data]), deletes));
    },
  };
}

/** Highlights and page notes (ADR-037), opt-in (`settings.annotations.sync`). */
function annotationsAdapter(): CollectionAdapter<SyncedAnnotation> {
  return {
    name: "annotations",
    enabled: () => settings().annotations.sync,
    snapshot: () => annotationRecords(profile().annotations),
    sanitize: (value, id) => sanitizeSyncedAnnotation(value, id),
    apply: ({ upserts, deletes }) => setProfileAnnotations(mergeAnnotations(profile().annotations, upserts, deletes)),
  };
}

/** Saved addresses (ADR-041), opt-in (`settings.autofill.syncAddresses`); cards stay on the device. */
function addressesAdapter(autofill: NonNullable<AdapterDeps["autofill"]>): CollectionAdapter<SyncedAddress> {
  return {
    name: "addresses",
    enabled: () => settings().autofill.syncAddresses && autofill.store.status().available,
    snapshot: () => new Map(autofill.addresses().map((entry) => [entry.id, addressRecord(entry)])),
    sanitize: (value) => sanitizeSyncedAddress(value),
    apply: ({ upserts, deletes }) => autofill.replace(mergeSyncedAddresses(autofill.store.current(), upserts, deletes)),
  };
}

/** Web panels (ADR-047), opt-in (`settings.panels.sync`): definitions and order, never their pages. */
function panelsAdapter(panels: NonNullable<AdapterDeps["panels"]>): CollectionAdapter<SyncedPanel> {
  return {
    name: "panels",
    enabled: () => settings().panels.sync,
    snapshot: () => new Map(panels.list().map((panel, index) => [panel.id, panelRecord(panel, index)])),
    sanitize: (value, id) => sanitizeSyncedPanel(value, id),
    apply: ({ upserts, deletes }) => panels.replace(mergePanels(panels.list(), upserts, deletes)),
  };
}

/** The reading list (ADR-047), with its offline texts: on with sync. */
function readingAdapter(reading: NonNullable<AdapterDeps["reading"]>): CollectionAdapter<SyncedReading> {
  return {
    name: "reading",
    snapshot: () => new Map(profile().readingList.map((item) => [item.id, readingRecord(item)])),
    sanitize: (value, id) => sanitizeSyncedReading(value, id),
    apply: ({ upserts, deletes }) => reading.replace(mergeReadingList(profile().readingList, upserts, deletes)),
  };
}

/** Saved passwords and "never" sites (ADR-050), opt-in (`settings.passwords.sync`); the mirror is sealed at rest. */
function passwordsAdapter({ vault, newId }: NonNullable<AdapterDeps["passwords"]>): CollectionAdapter<SyncedPassword> {
  return {
    name: "passwords",
    enabled: () => settings().passwords.sync && vault.status().available,
    snapshot: () => passwordRecords(vault.current()),
    sanitize: (value, id) => sanitizeSyncedPassword(value, id),
    apply: ({ upserts, deletes }) => {
      vault.write(mergeSyncedPasswords(vault.current(), upserts, deletes, newId));
    },
  };
}

export function desktopAdapters(deps: AdapterDeps): CollectionAdapter[] {
  const now = deps.now ?? Date.now;
  const adapters: CollectionAdapter<never>[] = [settingsAdapter(), spacesAdapter(), bookmarksAdapter(deps), historyAdapter(now), favoritesAdapter(deps), boostsAdapter(deps), annotationsAdapter()] as CollectionAdapter<never>[];
  if (deps.autofill) adapters.push(addressesAdapter(deps.autofill) as CollectionAdapter<never>);
  if (deps.panels) adapters.push(panelsAdapter(deps.panels) as CollectionAdapter<never>);
  if (deps.reading) adapters.push(readingAdapter(deps.reading) as CollectionAdapter<never>);
  if (deps.passwords) adapters.push(passwordsAdapter(deps.passwords) as CollectionAdapter<never>);
  // Last: the bookmarks and favorites of this round are there to take their icons.
  if (deps.siteIcons) adapters.push(faviconsAdapter(deps.siteIcons, deps, now) as CollectionAdapter<never>);
  return adapters as CollectionAdapter[];
}
