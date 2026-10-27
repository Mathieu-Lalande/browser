import { History } from "@shared/history";
import { webHostname } from "@shared/hosts";
import { internalPageOf } from "@shared/internal";
import { DEFAULT_SETTINGS, mergeSettings, sanitizeSettings, searchEngineOf, type Settings, type SettingsPatch } from "@shared/settings";
import { nextSpaceDefaults } from "@shared/spaces";
import type { Bookmark, HistoryEntry, SpaceInput } from "@shared/types";
import { normalizeInput } from "@shared/url";
import { createContext, use, useCallback, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from "react";
import { AppState } from "react-native";
import type { WebViewHandle } from "../components/webViewHandle";
import { parseBookmarks, toggleBookmark } from "../lib/bookmarks";
import { DEFAULT_MOBILE_SETTINGS, sanitizeMobileSettings, type MobileSettings } from "../lib/mobileSettings";
import { initialLoad } from "../lib/navigation";
import { flushDocuments, KEYS, loadDocument, removeDocuments, saveDocument } from "../lib/storage";
import {
  activeTab,
  initialTabsModel,
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
/** AsyncStorage values must stay small (Android limits a row to ~2 MB). */
const MAX_HISTORY = 3000;

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
  httpExceptions(): ReadonlySet<string>;
}

interface BrowserState {
  ready: boolean;
  model: TabsModel;
  settings: Settings;
  mobile: MobileSettings;
  bookmarks: Bookmark[];
  /** Bumped when history changes (the History instance is mutable). */
  historyVersion: number;
  history: History;
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
  const [historyVersion, setHistoryVersion] = useState(0);
  const historyRef = useRef(new History([], MAX_HISTORY));

  // Latest values for the stable action callbacks.
  const latest = useRef({ model, settings, mobile, bookmarks });
  latest.current = { model, settings, mobile, bookmarks };
  const webViews = useRef(new Map<TabId, WebViewHandle>());
  const httpExceptions = useRef(new Set<string>());

  // --- Loading & saving ---------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [session, history, storedBookmarks, storedSettings, storedMobile] = await Promise.all([
        loadDocument(KEYS.session, SESSION_VERSION),
        loadDocument(KEYS.history, HISTORY_VERSION),
        loadDocument(KEYS.bookmarks, BOOKMARKS_VERSION),
        loadDocument(KEYS.settings, SETTINGS_VERSION),
        loadDocument(KEYS.mobile, SETTINGS_VERSION),
      ]);
      if (cancelled) return;
      const nextSettings = sanitizeSettings(storedSettings);
      setSettings(nextSettings);
      setMobile(sanitizeMobileSettings(storedMobile));
      setBookmarks(parseBookmarks(storedBookmarks));
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
    if (ready) saveDocument(KEYS.mobile, SETTINGS_VERSION, () => latest.current.mobile, 200);
  }, [mobile, ready]);
  useEffect(() => {
    if (ready) saveDocument(KEYS.history, HISTORY_VERSION, () => historyRef.current.toJSON(), 2000);
  }, [historyVersion, ready]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") void flushDocuments();
    });
    return () => subscription.remove();
  }, []);

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
        historyRef.current.clear();
        setHistoryVersion((v) => v + 1);
      },
      async clearAllData() {
        historyRef.current.clear();
        setHistoryVersion((v) => v + 1);
        setBookmarks([]);
        httpExceptions.current.clear();
        dispatch({ type: "restore", model: initialTabsModel() });
        await removeDocuments([KEYS.history, KEYS.bookmarks, KEYS.session]);
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
    };
  }, []);

  const state = useMemo<BrowserState>(
    () => ({ ready, model, settings, mobile, bookmarks, historyVersion, history: historyRef.current }),
    [ready, model, settings, mobile, bookmarks, historyVersion],
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
