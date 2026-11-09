import { t } from "@shared/i18n";
import { autofill } from "./autofill";
import { passwords } from "./passwords";
import type { AnnotationsData } from "@shared/annotations/model";
import type { ArchivedTab } from "@shared/archive";
import type { Boost } from "@shared/boosts";
import type { ReadingItem } from "@shared/reading-list";
import { favoriteTab, type Favorite } from "@shared/favorites";
import type { History } from "@shared/history";
import { webHostname } from "@shared/hosts";
import { internalPageOf } from "@shared/internal";
import { passwordOrigin, type PasswordEntry } from "@shared/passwords";
import { searchEngineOf, tabArchiveDelayMs, type Settings, type SettingsPatch } from "@shared/settings";
import { nextSpaceDefaults } from "@shared/spaces";
import { SyncError } from "@shared/sync/client";
import type { SyncController, SyncStatus } from "@shared/sync/controller";
import type { Bookmark, HistoryEntry, SpaceInput } from "@shared/types";
import { displayUrl, normalizeInput } from "@shared/url";
import { createContext, use, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Alert, AppState } from "react-native";
import type { WebViewHandle } from "../components/webViewHandle";
import { mediaControlScript } from "../lib/media";
import type { MobileSettings } from "../lib/mobileSettings";
import { initialLoad } from "../lib/navigation";
import { archiveEntries, mobileTabsToArchive } from "../lib/organize";
import { passwordFillScript } from "../lib/passwords";
import { CLEAR_SITE_DATA_SCRIPT, mobileSiteInfo } from "../lib/siteInfo";
import type { MobileSyncStore } from "../lib/sync/adapters";
import { createMobileSync } from "../lib/sync/platform";
import { flushDocuments, KEYS, removeDocuments } from "../lib/storage";
import { clearPrivacyStats } from "../lib/privacyStats";
import {
  activeTab,
  initialTabsModel,
  isPrivateTab,
  nextMobileFolderName,
  PRIVATE_SPACE_ID,
  type MobileTab,
  type TabId,
  type TabsAction,
  type TabsModel,
} from "../lib/tabs";
import { useStore } from "./store";
import { createStores, loadStores, persistStores, StoresContext } from "./stores";

export { BOOKMARKS_VERSION, HISTORY_VERSION, SETTINGS_VERSION } from "./stores";
export { useEvent } from "../hooks/useEvent";

/**
 * The browser's state and actions for the screens. The data lives in stores (`state/stores`:
 * tabs, history, bookmarks, settings…, each saved by `lib/storage`); this provider loads and saves
 * them, runs the sync engine and the auto-archiving, and offers the actions.
 */

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
  /** Mini-player (ADR-035): plays/pauses the media of the tab's page. */
  controlMedia(id: TabId, action: "toggle" | "pause"): void;
  /** Favorites grid (ADR-022): never edited from private tabs (the caller checks). */
  toggleFavorite(tab: Pick<MobileTab, "url" | "title">): void;
  removeFavorite(url: string): void;
  /** Replaces the boosts (ADR-029): page menu toggles, settings list. */
  setBoosts(update: (boosts: Boost[]) => Boost[]): void;
  /** Highlights and page notes (ADR-037): normal tabs only (the caller checks). */
  setAnnotations(update: (data: AnnotationsData) => AnnotationsData): void;
  /** "Lire plus tard" (ADR-047): normal tabs only (the caller checks). */
  setReadingList(update: (list: ReadingItem[]) => ReadingItem[]): void;
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
    /** A tab another device sent (ADR-033) was opened or dismissed: deleted from the account. */
    dismissReceived(id: string): void;
  };
}

export type SyncResult = { ok: true } | { ok: false; message: string };

async function syncAttempt(action: () => Promise<void>): Promise<SyncResult> {
  try {
    await action();
    return { ok: true };
  } catch (error) {
    return { ok: false, message: error instanceof SyncError ? error.message : t("mobile.browserProvider.syncFailed") };
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
  /** Per-site boosts (ADR-029). */
  boosts: Boost[];
  /** Highlights and page notes (ADR-037). */
  annotations: AnnotationsData;
  /** "Lire plus tard" (ADR-047). */
  reading: ReadingItem[];
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
  const [stores] = useState(createStores);
  const [ready, setReady] = useState(false);
  const model = useStore(stores.tabs);
  const { settings, mobile } = useStore(stores.settings);
  const { bookmarks, favorites } = useStore(stores.bookmarks);
  const archive = useStore(stores.archive);
  const boosts = useStore(stores.boosts);
  const annotations = useStore(stores.annotations);
  const reading = useStore(stores.reading);
  const { history, version: historyVersion } = useStore(stores.history);
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const syncRef = useRef<SyncController | null>(null);
  const webViews = useRef(new Map<TabId, WebViewHandle>());
  const httpExceptions = useRef(new Set<string>());

  // --- Loading & saving ---------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    void loadStores(stores, () => cancelled).then((loaded) => loaded && setReady(true));
    return () => {
      cancelled = true;
    };
  }, [stores]);

  useEffect(() => (ready ? persistStores(stores) : undefined), [ready, stores]);

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
    // The stores apply writes at once: the engine reads the data back right after applying it.
    const store: MobileSyncStore = {
      settings: () => stores.settings.settings,
      setSettings: (next) => stores.settings.setSettings(next),
      model: stores.tabs.get,
      dispatch: (action) => stores.tabs.dispatch(action),
      bookmarks: () => stores.bookmarks.bookmarks,
      folders: () => stores.bookmarks.folders,
      setBookmarks: (nextBookmarks, nextFolders) => stores.bookmarks.setBookmarks(nextBookmarks, nextFolders),
      favorites: () => stores.bookmarks.favorites,
      setFavorites: (next) => stores.bookmarks.setFavorites(next),
      boosts: stores.boosts.get,
      setBoosts: (next) => stores.boosts.set(next),
      annotations: stores.annotations.get,
      setAnnotations: (next) => stores.annotations.set(next),
      reading: { list: stores.reading.get, set: (next) => stores.reading.set(next) },
      autofill,
      passwords,
      history: () => stores.history.history,
      historyChanged: () => stores.history.changed(),
      historyDeleted: (url) => stores.history.isDeleted(url),
      newId,
      now: () => Date.now(),
    };
    const controller = createMobileSync({ store, onStatus: setSyncStatus });
    syncRef.current = controller;
    setSyncStatus(controller.getStatus());
    void controller.init();
    // Password sync (ADR-050, opt-in) compares the vault only once it was read from the secure store.
    passwords.load().catch(() => {});
    const stopPasswords = passwords.subscribe(() => controller.notifyChange());
    return () => {
      stopPasswords();
      controller.dispose();
      syncRef.current = null;
    };
  }, [ready, stores]);

  // Any synced data changed: sync a little later (the controller debounces and ignores no-ops).
  useEffect(() => {
    if (ready) syncRef.current?.notifyChange();
  }, [model.tabs, model.spaces, bookmarks, favorites, boosts, annotations, reading, settings, historyVersion, ready]);

  // --- Auto-archiving (ADR-022): at startup, every minute, and back in the foreground ----------
  useEffect(() => {
    if (!ready) return;
    const check = () => {
      const idleMs = tabArchiveDelayMs(stores.settings.settings);
      if (idleMs === null) return;
      const now = Date.now();
      const tabs = mobileTabsToArchive(stores.tabs.get(), stores.bookmarks.favorites, idleMs, now);
      if (!tabs.length) return;
      stores.archive.add(archiveEntries(tabs, now, newId));
      stores.tabs.dispatch({ type: "close-many", ids: tabs.map((tab) => tab.id), now });
    };
    check();
    const timer = setInterval(check, 60_000);
    const subscription = AppState.addEventListener("change", (state) => state === "active" && check());
    return () => {
      clearInterval(timer);
      subscription.remove();
    };
  }, [ready, stores]);

  // --- Actions ------------------------------------------------------------------------------
  const actions = useMemo<BrowserActions>(() => {
    const { tabs, archive: archived, history: visits, bookmarks: marks, settings: prefs } = stores;
    const dispatch = (action: TabsAction) => tabs.dispatch(action);
    const now = () => Date.now();
    const active = () => activeTab(tabs.get());
    const webView = (id: TabId | undefined) => (id ? webViews.current.get(id) : undefined);

    const openUrl: BrowserActions["openUrl"] = (url, options = {}) => {
      const id = newId();
      const { url: target, upgradedFrom } = initialLoad(url, httpExceptions.current);
      const current = tabs.get();
      const spaceId = options.private ? PRIVATE_SPACE_ID : current.activeSpaceId;
      const afterId = options.afterId ?? (prefs.settings.behavior.newTabPosition === "next" ? (active()?.id ?? undefined) : undefined);
      dispatch({ type: "open", id, url: target, upgradedFrom, spaceId, background: options.background, afterId, now: now() });
      return id;
    };

    const loadInTab = (id: TabId, url: string) => {
      const { url: target, upgradedFrom } = initialLoad(url, httpExceptions.current);
      const tab = tabs.get().tabs.find((candidate) => candidate.id === id);
      // Same URL as the WebView's source: React would not reload it, ask the WebView directly.
      if (tab && tab.load.url === target && tab.url !== target && target) {
        webView(id)?.injectJavaScript(`window.location.assign(${JSON.stringify(target)});true;`);
        return;
      }
      dispatch({ type: "load", id, url: target, upgradedFrom });
    };

    const recordVisit = (tab: MobileTab | undefined, report: NavigationReport) => {
      if (!tab || isPrivateTab(tab) || report.loading) return;
      visits.recordVisit(report.url, report.title, now());
    };

    return {
      submit(input, options = {}) {
        const engine = searchEngineOf(prefs.settings);
        const url = normalizeInput(input, engine);
        if (!url) return { kind: "none" };
        if (internalPageOf(url) === "settings") return { kind: "settings" };
        const current = active();
        if (!current || options.newTab) {
          const isPrivate = tabs.get().activeSpaceId === PRIVATE_SPACE_ID;
          return { kind: "page", tabId: openUrl(url, { private: isPrivate }) };
        }
        loadInTab(current.id, url);
        return { kind: "page", tabId: current.id };
      },
      openUrl,
      newTab(options = {}) {
        const id = newId();
        const spaceId = options.private ? PRIVATE_SPACE_ID : tabs.get().activeSpaceId;
        dispatch({ type: "open", id, url: "", spaceId, now: now() });
        return id;
      },
      closeTab(id) {
        dispatch({ type: "close", id, activates: prefs.settings.behavior.closeTabActivates, now: now() });
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
        dispatch({ type: "add-space", id, input: { ...nextSpaceDefaults(tabs.get().spaces), ...input } });
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
      controlMedia(id, action) {
        webView(id)?.injectJavaScript(mediaControlScript(action));
      },
      reportNavigation(id, report) {
        const tab = tabs.get().tabs.find((candidate) => candidate.id === id);
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
        marks.toggle(tab, newId(), now());
      },
      removeBookmark(id) {
        marks.remove(id);
      },
      clearHistory() {
        visits.clear();
      },
      async clearAllData() {
        visits.clear();
        marks.clearBookmarks();
        archived.clear();
        httpExceptions.current.clear();
        dispatch({ type: "restore", model: initialTabsModel() });
        await removeDocuments([KEYS.history, KEYS.bookmarks, KEYS.session, KEYS.archive]);
        await clearPrivacyStats();
      },
      updateSettings(patch) {
        prefs.update(patch);
      },
      updateMobileSettings(patch) {
        prefs.updateMobile(patch);
      },
      registerWebView(id, ref) {
        if (ref) webViews.current.set(id, ref);
        else webViews.current.delete(id);
      },
      httpExceptions: () => httpExceptions.current,
      toggleFavorite(tab) {
        marks.toggleFavorite(tab, now());
      },
      removeFavorite(url) {
        marks.removeFavorite(url);
      },
      setBoosts(update) {
        stores.boosts.set(update);
      },
      setAnnotations(update) {
        stores.annotations.set(update);
      },
      setReadingList(update) {
        stores.reading.set(update);
      },
      openFavorite(url) {
        const current = tabs.get();
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
        dispatch({ type: "add-folder", id, spaceId, tabId, name: name ?? nextMobileFolderName(tabs.get(), spaceId) });
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
        const entry = archived.get().find((candidate) => candidate.id === id);
        if (!entry) return null;
        const tabId = newId();
        const current = tabs.get();
        const spaceId = entry.spaceId && current.spaces.some((space) => space.id === entry.spaceId) ? entry.spaceId : current.activeSpaceId;
        const { url: target, upgradedFrom } = initialLoad(entry.url, httpExceptions.current);
        dispatch({ type: "open", id: tabId, url: target, upgradedFrom, spaceId, title: entry.title, now: now() });
        archived.remove(id);
        return tabId;
      },
      removeArchived(id) {
        archived.remove(id);
      },
      clearArchive() {
        archived.clear();
      },
      sync: {
        createAccount: (serverUrl, secret) => syncAttempt(async () => syncRef.current?.createAccount(serverUrl, secret)),
        pair: (code) => syncAttempt(async () => syncRef.current?.pair(code)),
        pairingCode: () => syncRef.current?.pairingCode() ?? null,
        syncNow: () => void syncRef.current?.syncNow(),
        disconnect: () => syncAttempt(async () => syncRef.current?.disconnect()),
        reset: () => syncAttempt(async () => syncRef.current?.reset()),
        dismissReceived: (id) => syncRef.current?.dismissReceivedTab(id),
      },
    };
  }, [stores]);

  // Tabs sent from another device (ADR-033): asked once each; "Plus tard" leaves them under
  // "Autres appareils" in the tab overview.
  const announced = useRef(new Set<string>());
  useEffect(() => {
    for (const tab of syncStatus?.received ?? []) {
      if (announced.current.has(tab.id)) continue;
      announced.current.add(tab.id);
      Alert.alert(t("mobile.browserProvider.tabReceivedFrom", { fromName: tab.fromName }), tab.title || displayUrl(tab.url), [
        { text: t("mobile.browserProvider.later"), style: "cancel" },
        {
          text: t("mobile.browserProvider.open"),
          onPress: () => {
            actions.openUrl(tab.url);
            actions.sync.dismissReceived(tab.id);
          },
        },
      ]);
    }
  }, [syncStatus, actions]);

  const state = useMemo<BrowserState>(
    () => ({ ready, model, settings, mobile, bookmarks, favorites, archive, boosts, annotations, reading, historyVersion, history, sync: syncStatus }),
    [ready, model, settings, mobile, bookmarks, favorites, archive, boosts, annotations, reading, historyVersion, history, syncStatus],
  );

  return (
    <StoresContext value={stores}>
      <ActionsContext value={actions}>
        <StateContext value={state}>{children}</StateContext>
      </ActionsContext>
    </StoresContext>
  );
}
