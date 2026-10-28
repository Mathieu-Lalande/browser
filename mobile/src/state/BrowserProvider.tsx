import { addArchived, removeArchived, sanitizeArchive, type ArchivedTab } from "@shared/archive";
import { addFavorite, favoriteTab, isFavoriteTab, removeFavorite, sanitizeFavorites, type Favorite } from "@shared/favorites";
import { History } from "@shared/history";
import { webHostname } from "@shared/hosts";
import { internalPageOf } from "@shared/internal";
import { DEFAULT_SETTINGS, mergeSettings, sanitizeSettings, searchEngineOf, tabArchiveDelayMs, type Settings, type SettingsPatch } from "@shared/settings";
import { passwordOrigin, type PasswordEntry } from "@shared/passwords";
import { nextSpaceDefaults } from "@shared/spaces";
import { SyncError } from "@shared/sync/client";
import type { SyncController, SyncStatus } from "@shared/sync/controller";
import type { Bookmark, HistoryEntry, SpaceInput } from "@shared/types";
import { normalizeInput } from "@shared/url";
import { createContext, use, useCallback, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from "react";
import { AppState } from "react-native";
import type { WebViewHandle } from "../components/webViewHandle";
import { parseBookmarks, parseFolders, toggleBookmark } from "../lib/bookmarks";
import { DEFAULT_MOBILE_SETTINGS, sanitizeMobileSettings, type MobileSettings } from "../lib/mobileSettings";
import { initialLoad } from "../lib/navigation";
import { passwordFillScript } from "../lib/passwords";
import { ARCHIVE_VERSION, archiveEntries, FAVORITES_VERSION, mobileTabsToArchive } from "../lib/organize";
import { CLEAR_SITE_DATA_SCRIPT, mobileSiteInfo } from "../lib/siteInfo";
import type { BookmarkFolder, MobileSyncStore } from "../lib/sync/adapters";
import { createMobileSync } from "../lib/sync/platform";
import { flushDocuments, KEYS, loadDocument, removeDocuments, saveDocument } from "../lib/storage";
import {
  activeTab,
  initialTabsModel,
  nextMobileFolderName,
  isPrivateTab,
  parseSession,
  PRIVATE_SPACE_ID,
  serializeSession,
  SESSION_VERSION,
  tabsReducer,
  type MobileTab,
  type TabId,
  type TabsModel,
} from "../lib/tabs";

export const HISTORY_VERSION = 1;
export const BOOKMARKS_VERSION = 1;
export const SETTINGS_VERSION = 1;
/** AsyncStorage values must stay small (Android limits a row to ~2 MB); 5 000 is also the synced maximum. */
const MAX_HISTORY = 5000;

export const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export interface NavigationReport {
  url: string;
  title: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
}

/** Result of what the user typed: a page to load, or an internal page the UI shows itself. */
export type OpenResult = { kind: "page"; tabId: TabId } | { kind: "settings" } | { kind: "none" };

export interface BrowserActions {
  /** Address bar / search sheet: loads in the active tab (or a new one), returns what happened. */
  submit(input: string, options?: { newTab?: boolean }): OpenResult;
  openUrl(url: string, options?: { background?: boolean; private?: boolean; afterId?: TabId }): TabId;
  newTab(options?: { private?: boolean }): TabId;
  closeTab(id: TabId): void;
  closeTabs(ids: TabId[]): void;
  activate(id: TabId): void;
  setPinned(id: TabId, pinned: boolean): void;
  duplicate(id: TabId): TabId;
  moveToSpace(id: TabId, spaceId: string): void;
  showSpace(spaceId: string): void;
  addSpace(input?: SpaceInput): string;
  updateSpace(id: string, input: SpaceInput): void;
  removeSpace(id: string): void;
  goBack(): void;
  goForward(): void;
  reload(): void;
  /** Clears what the active page can reach of its own data, then reloads it (ADR-021). */
  clearSiteData(): void;
  /** Fills the active page's login form with a saved account of its own origin (ADR-025). */
  fillPassword(entry: PasswordEntry): void;
  stop(): void;
  /** From the WebView (`onNavigationStateChange`). */
  reportNavigation(id: TabId, report: NavigationReport): void;
  reportProgress(id: TabId, progress: number): void;
  /** Cancel a top-level http load and load its https version instead. */
  upgrade(id: TabId, url: string, from: string): void;
  /** The upgraded https load failed: show the HTTPS-Only page. */
  httpsFailed(id: TabId, httpUrl: string): void;
  /** "Continuer en HTTP": accepts http for the host until the app restarts. */
  allowHttp(id: TabId, httpUrl: string): void;
  toggleBookmark(tab: Pick<MobileTab, "url" | "title">): void;
  removeBookmark(id: string): void;
  clearHistory(): void;
  clearAllData(): Promise<void>;
  updateSettings(patch: SettingsPatch): void;
  updateMobileSettings(patch: Partial<MobileSettings>): void;
  registerWebView(id: TabId, ref: WebViewHandle | null): void;
  /** Favorites grid (ADR-022): never edited from private tabs (the caller checks). */
  toggleFavorite(tab: Pick<MobileTab, "url" | "title">): void;
  removeFavorite(url: string): void;
  /** The favorite's tab in the space shown, else a new tab. Returns the tab shown. */
  openFavorite(url: string): TabId;
  /** Overview folders (ADR-022). Returns the new folder's id. */
  addFolder(spaceId: string, tabId?: TabId, name?: string): string;
  renameFolder(id: string, name: string): void;
  toggleFolder(id: string): void;
  removeFolder(id: string, closeTabs: boolean): void;
  setTabFolder(tabId: TabId, folderId: string | null): void;
  /** Archived tabs (ADR-022). Restoring reopens the page (in its space when it still exists). */
  restoreArchived(id: string): TabId | null;
  removeArchived(id: string): void;
  clearArchive(): void;
  httpExceptions(): ReadonlySet<string>;
  /** End-to-end encrypted sync (ADR-019). */
  sync: {
    createAccount(serverUrl: string, registrationSecret?: string): Promise<SyncResult>;
    pair(code: string): Promise<SyncResult>;
    /** Full access to the synced data: only after an explicit user action. */
    pairingCode(): string | null;
    syncNow(): void;
    disconnect(): Promise<SyncResult>;
    reset(): Promise<SyncResult>;
  };
}

export type SyncResult = { ok: true } | { ok: false; message: string };

async function syncAttempt(action: () => Promise<void>): Promise<SyncResult> {
  try {
    await action();
    return { ok: true };
  } catch (error) {
    return { ok: false, message: error instanceof SyncError ? error.message : "La synchronisation a échoué." };
  }
}

interface BrowserState {
  ready: boolean;
  model: TabsModel;
  settings: Settings;
  mobile: MobileSettings;
  bookmarks: Bookmark[];
  favorites: Favorite[];
  archive: ArchivedTab[];
  /** Bumped when history changes (the History instance is mutable). */
  historyVersion: number;
  history: History;
  /** Null until loaded. */
  sync: SyncStatus | null;
}

const StateContext = createContext<BrowserState | null>(null);
const ActionsContext = createContext<BrowserActions | null>(null);

export function useBrowserState(): BrowserState {
  const value = use(StateContext);
  if (!value) throw new Error("useBrowserState outside BrowserProvider");
  return value;
}

export function useBrowserActions(): BrowserActions {
  const value = use(ActionsContext);
  if (!value) throw new Error("useBrowserActions outside BrowserProvider");
  return value;
}

/** History entries as a plain list (recomputed only when history changes). */
export function useHistoryEntries(): HistoryEntry[] {
  const { history, historyVersion } = useBrowserState();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => history.toJSON(), [history, historyVersion]);
}

export function BrowserProvider({ children }: { children: ReactNode }) {
  const [model, dispatch] = useReducer(tabsReducer, undefined, initialTabsModel);
  const [ready, setReady] = useState(false);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [mobile, setMobile] = useState<MobileSettings>(DEFAULT_MOBILE_SETTINGS);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [favorites, setFavorites] = useState<Favorite[]>([]);
  const [archive, setArchive] = useState<ArchivedTab[]>([]);
  const [historyVersion, setHistoryVersion] = useState(0);
  const historyRef = useRef(new History([], MAX_HISTORY));
  const [folders, setFolders] = useState<BookmarkFolder[]>([]);
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const syncRef = useRef<SyncController | null>(null);
  /** Pages the user deleted from the history (cleared), as opposed to pruned because it is full. */
  const deletedHistory = useRef(new Set<string>());

  // Latest values for the stable action callbacks.
  const latest = useRef({ model, settings, mobile, bookmarks, folders, favorites, archive });
  latest.current = { model, settings, mobile, bookmarks, folders, favorites, archive };
  const webViews = useRef(new Map<TabId, WebViewHandle>());
  const httpExceptions = useRef(new Set<string>());

  // --- Loading & saving ---------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [session, history, storedBookmarks, storedSettings, storedMobile, storedFolders, storedFavorites, storedArchive] = await Promise.all([
        loadDocument(KEYS.session, SESSION_VERSION),
        loadDocument(KEYS.history, HISTORY_VERSION),
        loadDocument(KEYS.bookmarks, BOOKMARKS_VERSION),
        loadDocument(KEYS.settings, SETTINGS_VERSION),
        loadDocument(KEYS.mobile, SETTINGS_VERSION),
        loadDocument(KEYS.folders, BOOKMARKS_VERSION),
        loadDocument(KEYS.favorites, FAVORITES_VERSION),
        loadDocument(KEYS.archive, ARCHIVE_VERSION),
      ]);
      if (cancelled) return;
      const nextSettings = sanitizeSettings(storedSettings);
      setSettings(nextSettings);
      setMobile(sanitizeMobileSettings(storedMobile));
      setBookmarks(parseBookmarks(storedBookmarks));
      setFolders(parseFolders(storedFolders));
      setFavorites(sanitizeFavorites(storedFavorites));
      setArchive(sanitizeArchive(storedArchive));
      historyRef.current = new History(History.parse(history) ?? [], MAX_HISTORY);
      setHistoryVersion((v) => v + 1);
      const restored = nextSettings.behavior.restoreSession ? parseSession(session) : null;
      if (restored) dispatch({ type: "restore", model: restored });
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (ready) saveDocument(KEYS.session, SESSION_VERSION, () => serializeSession(latest.current.model));
  }, [model, ready]);
  useEffect(() => {
    if (ready) saveDocument(KEYS.bookmarks, BOOKMARKS_VERSION, () => latest.current.bookmarks);
  }, [bookmarks, ready]);
  useEffect(() => {
    if (ready) saveDocument(KEYS.settings, SETTINGS_VERSION, () => latest.current.settings, 200);
  }, [settings, ready]);
  useEffect(() => {
    if (ready) saveDocument(KEYS.folders, BOOKMARKS_VERSION, () => latest.current.folders);
  }, [folders, ready]);
  useEffect(() => {
    if (ready) saveDocument(KEYS.favorites, FAVORITES_VERSION, () => latest.current.favorites);
  }, [favorites, ready]);
  useEffect(() => {
    if (ready) saveDocument(KEYS.archive, ARCHIVE_VERSION, () => latest.current.archive);
  }, [archive, ready]);
  useEffect(() => {
    if (ready) saveDocument(KEYS.mobile, SETTINGS_VERSION, () => latest.current.mobile, 200);
  }, [mobile, ready]);
  useEffect(() => {
    if (ready) saveDocument(KEYS.history, HISTORY_VERSION, () => historyRef.current.toJSON(), 2000);
  }, [historyVersion, ready]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") void flushDocuments();
      else syncRef.current?.notifyForeground();
    });
    return () => subscription.remove();
  }, []);

  // --- Sync (ADR-019) -----------------------------------------------------------------------
  useEffect(() => {
    if (!ready) return;
    // Writes go to `latest` at once: the engine reads the data back right after applying it.
    const store: MobileSyncStore = {
      settings: () => latest.current.settings,
      setSettings: (next) => {
        latest.current.settings = next;
        setSettings(next);
      },
      model: () => latest.current.model,
      dispatch: (action) => {
        latest.current.model = tabsReducer(latest.current.model, action);
        dispatch(action);
      },
      bookmarks: () => latest.current.bookmarks,
      folders: () => latest.current.folders,
      setBookmarks: (nextBookmarks, nextFolders) => {
        latest.current.bookmarks = nextBookmarks;
        latest.current.folders = nextFolders;
        setBookmarks(nextBookmarks);
        setFolders(nextFolders);
      },
      favorites: () => latest.current.favorites,
      setFavorites: (next) => {
        latest.current.favorites = next;
        setFavorites(next);
      },
      history: () => historyRef.current,
      historyChanged: () => setHistoryVersion((v) => v + 1),
      historyDeleted: (url) => deletedHistory.current.has(url),
      newId,
      now: () => Date.now(),
    };
    const controller = createMobileSync({ store, onStatus: setSyncStatus });
    syncRef.current = controller;
    setSyncStatus(controller.getStatus());
    void controller.init();
    return () => {
      controller.dispose();
      syncRef.current = null;
    };
  }, [ready]);

  // Any synced data changed: sync a little later (the controller debounces and ignores no-ops).
  useEffect(() => {
    if (ready) syncRef.current?.notifyChange();
  }, [model.tabs, model.spaces, bookmarks, favorites, settings, historyVersion, ready]);

  // --- Auto-archiving (ADR-022): at startup, every minute, and back in the foreground ----------
  useEffect(() => {
    if (!ready) return;
    const check = () => {
      const idleMs = tabArchiveDelayMs(latest.current.settings);
      if (idleMs === null) return;
      const now = Date.now();
      const tabs = mobileTabsToArchive(latest.current.model, latest.current.favorites, idleMs, now);
      if (!tabs.length) return;
      setArchive((list) => addArchived(list, archiveEntries(tabs, now, newId)));
      dispatch({ type: "close-many", ids: tabs.map((tab) => tab.id), now });
    };
    check();
    const timer = setInterval(check, 60_000);
    const subscription = AppState.addEventListener("change", (state) => state === "active" && check());
    return () => {
      clearInterval(timer);
      subscription.remove();
    };
  }, [ready]);

  // --- Actions ------------------------------------------------------------------------------
  const actions = useMemo<BrowserActions>(() => {
    const now = () => Date.now();
    const active = () => activeTab(latest.current.model);
    const webView = (id: TabId | undefined) => (id ? webViews.current.get(id) : undefined);

    const openUrl: BrowserActions["openUrl"] = (url, options = {}) => {
      const id = newId();
      const { url: target, upgradedFrom } = initialLoad(url, httpExceptions.current);
      const current = latest.current.model;
      const spaceId = options.private ? PRIVATE_SPACE_ID : current.activeSpaceId;
      const afterId =
        options.afterId ?? (latest.current.settings.behavior.newTabPosition === "next" ? (active()?.id ?? undefined) : undefined);
      dispatch({ type: "open", id, url: target, upgradedFrom, spaceId, background: options.background, afterId, now: now() });
      return id;
    };

    const loadInTab = (id: TabId, url: string) => {
      const { url: target, upgradedFrom } = initialLoad(url, httpExceptions.current);
      const tab = latest.current.model.tabs.find((candidate) => candidate.id === id);
      // Same URL as the WebView's source: React would not reload it, ask the WebView directly.
      if (tab && tab.load.url === target && tab.url !== target && target) {
        webView(id)?.injectJavaScript(`window.location.assign(${JSON.stringify(target)});true;`);
        return;
      }
      dispatch({ type: "load", id, url: target, upgradedFrom });
    };

    const recordVisit = (tab: MobileTab | undefined, report: NavigationReport) => {
      if (!tab || isPrivateTab(tab)) return;
      const history = historyRef.current;
      // Called several times per load (start, title, end): History ignores revisits within 30 s.
      if (!report.loading && history.recordVisit(report.url, now(), { title: report.title })) setHistoryVersion((v) => v + 1);
    };

    return {
      submit(input, options = {}) {
        const engine = searchEngineOf(latest.current.settings);
        const url = normalizeInput(input, engine);
        if (!url) return { kind: "none" };
        if (internalPageOf(url) === "settings") return { kind: "settings" };
        const current = active();
        if (!current || options.newTab) {
          const isPrivate = latest.current.model.activeSpaceId === PRIVATE_SPACE_ID;
          return { kind: "page", tabId: openUrl(url, { private: isPrivate }) };
        }
        loadInTab(current.id, url);
        return { kind: "page", tabId: current.id };
      },
      openUrl,
      newTab(options = {}) {
        const id = newId();
        const spaceId = options.private ? PRIVATE_SPACE_ID : latest.current.model.activeSpaceId;
        dispatch({ type: "open", id, url: "", spaceId, now: now() });
        return id;
      },
      closeTab(id) {
        dispatch({ type: "close", id, activates: latest.current.settings.behavior.closeTabActivates, now: now() });
      },
      closeTabs(ids) {
        dispatch({ type: "close-many", ids, now: now() });
      },
      activate(id) {
        dispatch({ type: "activate", id, now: now() });
      },
      setPinned(id, pinned) {
        dispatch({ type: "pin", id, pinned });
      },
      duplicate(id) {
        const newTabId = newId();
        dispatch({ type: "duplicate", id, newId: newTabId, now: now() });
        return newTabId;
      },
      moveToSpace(id, spaceId) {
        dispatch({ type: "move-to-space", id, spaceId, now: now() });
      },
      showSpace(spaceId) {
        dispatch({ type: "show-space", spaceId });
      },
      addSpace(input) {
        const id = `space-${newId()}`;
        dispatch({ type: "add-space", id, input: { ...nextSpaceDefaults(latest.current.model.spaces), ...input } });
        return id;
      },
      updateSpace(id, input) {
        dispatch({ type: "update-space", id, input });
      },
      removeSpace(id) {
        dispatch({ type: "remove-space", id });
      },
      goBack() {
        webView(active()?.id)?.goBack();
      },
      goForward() {
        webView(active()?.id)?.goForward();
      },
      reload() {
        const tab = active();
        if (!tab) return;
        if (tab.interstitial) loadInTab(tab.id, tab.interstitial.url);
        else webView(tab.id)?.reload();
      },
      clearSiteData() {
        const tab = active();
        if (tab && !tab.interstitial && mobileSiteInfo(tab.url)) webView(tab.id)?.injectJavaScript(CLEAR_SITE_DATA_SCRIPT);
      },
      fillPassword(entry) {
        const tab = active();
        // The script checks the page's origin again before filling.
        if (tab && !tab.interstitial && passwordOrigin(tab.url) === entry.origin) webView(tab.id)?.injectJavaScript(passwordFillScript(entry));
      },
      stop() {
        webView(active()?.id)?.stopLoading();
      },
      reportNavigation(id, report) {
        const tab = latest.current.model.tabs.find((candidate) => candidate.id === id);
        dispatch({
          type: "navigation",
          id,
          url: report.url,
          title: report.title,
          isLoading: report.loading,
          canGoBack: report.canGoBack,
          canGoForward: report.canGoForward,
        });
        if (/^https?:/i.test(report.url)) recordVisit(tab, report);
      },
      reportProgress(id, progress) {
        dispatch({ type: "progress", id, progress });
      },
      upgrade(id, url, from) {
        dispatch({ type: "load", id, url, upgradedFrom: from });
      },
      httpsFailed(id, httpUrl) {
        dispatch({ type: "interstitial", id, interstitial: { kind: "https-only", url: httpUrl } });
      },
      allowHttp(id, httpUrl) {
        const host = webHostname(httpUrl);
        if (host) httpExceptions.current.add(host);
        dispatch({ type: "load", id, url: httpUrl, upgradedFrom: null });
      },
      toggleBookmark(tab) {
        setBookmarks((list) => toggleBookmark(list, tab, newId(), now()));
      },
      removeBookmark(id) {
        setBookmarks((list) => list.filter((bookmark) => bookmark.id !== id));
      },
      clearHistory() {
        for (const entry of historyRef.current.toJSON()) deletedHistory.current.add(entry.url);
        historyRef.current.clear();
        setHistoryVersion((v) => v + 1);
      },
      async clearAllData() {
        for (const entry of historyRef.current.toJSON()) deletedHistory.current.add(entry.url);
        historyRef.current.clear();
        setHistoryVersion((v) => v + 1);
        setBookmarks([]);
        setArchive([]);
        httpExceptions.current.clear();
        dispatch({ type: "restore", model: initialTabsModel() });
        await removeDocuments([KEYS.history, KEYS.bookmarks, KEYS.session, KEYS.archive]);
      },
      updateSettings(patch) {
        setSettings((current) => mergeSettings(current, patch));
      },
      updateMobileSettings(patch) {
        setMobile((current) => sanitizeMobileSettings(patch, current));
      },
      registerWebView(id, ref) {
        if (ref) webViews.current.set(id, ref);
        else webViews.current.delete(id);
      },
      httpExceptions: () => httpExceptions.current,
      toggleFavorite(tab) {
        setFavorites((list) => {
          const matching = list.filter((favorite) => isFavoriteTab(favorite.url, tab.url));
          if (matching.length) return list.filter((favorite) => !matching.includes(favorite));
          return addFavorite(list, { url: tab.url, title: tab.title }, now());
        });
      },
      removeFavorite(url) {
        setFavorites((list) => removeFavorite(list, url));
      },
      openFavorite(url) {
        const current = latest.current.model;
        const here = current.tabs.filter((tab) => tab.spaceId === current.activeSpaceId);
        const match = favoriteTab(url, here);
        if (match) {
          dispatch({ type: "activate", id: match.id, now: now() });
          return match.id;
        }
        return openUrl(url);
      },
      addFolder(spaceId, tabId, name) {
        const id = `folder-${newId()}`;
        dispatch({ type: "add-folder", id, spaceId, tabId, name: name ?? nextMobileFolderName(latest.current.model, spaceId) });
        return id;
      },
      renameFolder(id, name) {
        dispatch({ type: "rename-folder", id, name });
      },
      toggleFolder(id) {
        dispatch({ type: "toggle-folder", id });
      },
      removeFolder(id, closeTabs) {
        dispatch({ type: "remove-folder", id, closeTabs, now: now() });
      },
      setTabFolder(tabId, folderId) {
        dispatch({ type: "set-tab-folder", id: tabId, folderId });
      },
      restoreArchived(id) {
        const entry = latest.current.archive.find((candidate) => candidate.id === id);
        if (!entry) return null;
        const tabId = newId();
        const spaceId = entry.spaceId && latest.current.model.spaces.some((space) => space.id === entry.spaceId) ? entry.spaceId : latest.current.model.activeSpaceId;
        const { url: target, upgradedFrom } = initialLoad(entry.url, httpExceptions.current);
        dispatch({ type: "open", id: tabId, url: target, upgradedFrom, spaceId, title: entry.title, now: now() });
        setArchive((list) => removeArchived(list, id));
        return tabId;
      },
      removeArchived(id) {
        setArchive((list) => removeArchived(list, id));
      },
      clearArchive() {
        setArchive([]);
      },
      sync: {
        createAccount: (serverUrl, secret) => syncAttempt(async () => syncRef.current?.createAccount(serverUrl, secret)),
        pair: (code) => syncAttempt(async () => syncRef.current?.pair(code)),
        pairingCode: () => syncRef.current?.pairingCode() ?? null,
        syncNow: () => void syncRef.current?.syncNow(),
        disconnect: () => syncAttempt(async () => syncRef.current?.disconnect()),
        reset: () => syncAttempt(async () => syncRef.current?.reset()),
      },
    };
  }, []);

  const state = useMemo<BrowserState>(
    () => ({ ready, model, settings, mobile, bookmarks, favorites, archive, historyVersion, history: historyRef.current, sync: syncStatus }),
    [ready, model, settings, mobile, bookmarks, favorites, archive, historyVersion, syncStatus],
  );

  return (
    <ActionsContext value={actions}>
      <StateContext value={state}>{children}</StateContext>
    </ActionsContext>
  );
}

/** Stable callback that always sees the latest props (for WebView handlers). */
export function useEvent<A extends unknown[], R>(handler: (...args: A) => R): (...args: A) => R {
  const ref = useRef(handler);
  ref.current = handler;
  return useCallback((...args: A) => ref.current(...args), []);
}
