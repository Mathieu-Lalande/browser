import { ANNOTATIONS_VERSION, emptyAnnotations, sanitizeAnnotations, type AnnotationsData } from "@shared/annotations/model";
import { BOOSTS_VERSION, sanitizeBoosts, type Boost } from "@shared/boosts";
import { createContext, use } from "react";
import { ARCHIVE_VERSION, FAVORITES_VERSION } from "../../lib/organize";
import { KEYS, loadDocuments, persistDocument } from "../../lib/storage";
import { serializeSession, SESSION_VERSION, type TabsModel } from "../../lib/tabs";
import { Store, useStore } from "../store";
import { BookmarksStore, type BookmarksState } from "./bookmarks";
import { HistoryStore, type HistoryState } from "./history";
import { SettingsStore, type SettingsState } from "./settings";
import { ArchiveStore, TabsStore } from "./tabs";

export { BookmarksStore, HistoryStore, SettingsStore, TabsStore, ArchiveStore };

export const HISTORY_VERSION = 1;
export const BOOKMARKS_VERSION = 1;
export const SETTINGS_VERSION = 1;

/** The app's data, one store per concern, each saved as its own document (`lib/storage`). */
export interface Stores {
  tabs: TabsStore;
  archive: ArchiveStore;
  history: HistoryStore;
  bookmarks: BookmarksStore;
  settings: SettingsStore;
  /** Per-site boosts (ADR-029). */
  boosts: Store<Boost[]>;
  /** Highlights and page notes (ADR-037). */
  annotations: Store<AnnotationsData>;
}

export function createStores(): Stores {
  return {
    tabs: new TabsStore(),
    archive: new ArchiveStore(),
    history: new HistoryStore(),
    bookmarks: new BookmarksStore(),
    settings: new SettingsStore(),
    boosts: new Store<Boost[]>([]),
    annotations: new Store<AnnotationsData>(emptyAnnotations()),
  };
}

/** Reads every document and fills the stores (the session last: its restore depends on a setting). */
export async function loadStores(stores: Stores, isCancelled: () => boolean = () => false): Promise<boolean> {
  const stored = await loadDocuments({
    session: [KEYS.session, SESSION_VERSION],
    history: [KEYS.history, HISTORY_VERSION],
    bookmarks: [KEYS.bookmarks, BOOKMARKS_VERSION],
    settings: [KEYS.settings, SETTINGS_VERSION],
    mobile: [KEYS.mobile, SETTINGS_VERSION],
    folders: [KEYS.folders, BOOKMARKS_VERSION],
    favorites: [KEYS.favorites, FAVORITES_VERSION],
    archive: [KEYS.archive, ARCHIVE_VERSION],
    boosts: [KEYS.boosts, BOOSTS_VERSION],
    annotations: [KEYS.annotations, ANNOTATIONS_VERSION],
  });
  if (isCancelled()) return false;
  stores.settings.hydrate(stored);
  stores.bookmarks.hydrate(stored);
  stores.archive.hydrate(stored.archive);
  stores.boosts.set(sanitizeBoosts(stored.boosts));
  stores.annotations.set(sanitizeAnnotations(stored.annotations));
  stores.history.hydrate(stored.history);
  stores.tabs.hydrate(stored.session, stores.settings.settings.behavior.restoreSession);
  return true;
}

/** Saves each document when its part of the stores changes (call once loaded). Returns the stop. */
export function persistStores(stores: Stores): () => void {
  const { tabs, archive, history, bookmarks, settings, boosts, annotations } = stores;
  const stops = [
    persistDocument(tabs, (model: TabsModel) => model, KEYS.session, SESSION_VERSION, () => serializeSession(tabs.get())),
    persistDocument(bookmarks, (state: BookmarksState) => state.bookmarks, KEYS.bookmarks, BOOKMARKS_VERSION, () => bookmarks.bookmarks),
    persistDocument(settings, (state: SettingsState) => state.settings, KEYS.settings, SETTINGS_VERSION, () => settings.settings, 200),
    persistDocument(bookmarks, (state: BookmarksState) => state.folders, KEYS.folders, BOOKMARKS_VERSION, () => bookmarks.folders),
    persistDocument(bookmarks, (state: BookmarksState) => state.favorites, KEYS.favorites, FAVORITES_VERSION, () => bookmarks.favorites),
    persistDocument(archive, (list) => list, KEYS.archive, ARCHIVE_VERSION, archive.get),
    persistDocument(boosts, (list) => list, KEYS.boosts, BOOSTS_VERSION, boosts.get),
    persistDocument(annotations, (data) => data, KEYS.annotations, ANNOTATIONS_VERSION, annotations.get),
    persistDocument(settings, (state: SettingsState) => state.mobile, KEYS.mobile, SETTINGS_VERSION, () => settings.mobile, 200),
    persistDocument(history, (state: HistoryState) => state.version, KEYS.history, HISTORY_VERSION, () => history.history.toJSON(), 2000),
  ];
  return () => stops.forEach((stop) => stop());
}

export const StoresContext = createContext<Stores | null>(null);

export function useStores(): Stores {
  const stores = use(StoresContext);
  if (!stores) throw new Error("useStores outside BrowserProvider");
  return stores;
}

/** Open tabs, spaces and folders. */
export const useTabsStore = (): TabsModel => useStore(useStores().tabs);
/** The history and its version (bumped on each change). */
export const useHistoryStore = (): HistoryState => useStore(useStores().history);
/** Bookmarks, synced bookmark folders and the favorites grid. */
export const useBookmarksStore = (): BookmarksState => useStore(useStores().bookmarks);
/** Shared and phone-only preferences. */
export const useSettingsStore = (): SettingsState => useStore(useStores().settings);
