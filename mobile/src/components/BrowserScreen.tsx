import { getCommand, type CommandId } from "@shared/commands";
import { cycleSpace, FALLBACK_SPACE_ICON } from "@shared/spaces";
import type { SpaceInfo } from "@shared/types";
import { StatusBar } from "expo-status-bar";
import * as SystemUI from "expo-system-ui";
import { useEffect, useMemo, useState } from "react";
import { Alert, Platform, StyleSheet, View, useWindowDimensions } from "react-native";
import Animated from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAndroidBack } from "../hooks/useAndroidBack";
import { useBrowserMenus } from "../hooks/useBrowserMenus";
import { useEvent } from "../hooks/useEvent";
import { useHighlights } from "../hooks/useHighlights";
import { useLinkMenu } from "../hooks/useLinkMenu";
import { useMiniPlayer } from "../hooks/useMiniPlayer";
import { useOverviewTransition } from "../hooks/useOverviewTransition";
import { usePageSwipe } from "../hooks/usePageSwipe";
import { usePasswordMenus } from "../hooks/usePasswordMenus";
import { useAutofillMenus } from "../hooks/useAutofillMenus";
import { useReader } from "../hooks/useReader";
import { useShareActions } from "../hooks/useShareActions";
import { useSiteMenus } from "../hooks/useSiteMenus";
import { useToolbarCollapse } from "../hooks/useToolbarCollapse";
import { boostPayload } from "../lib/boosts";
import type { SheetItem } from "../lib/searchSheet";
import { activeTab, isPrivateTab, liveTabIds, mountUrl, orderedTabs, type MobileFolder } from "../lib/tabs";
import { useBrowserActions, useBrowserState } from "../state/BrowserProvider";
import { useTheme } from "../state/theme";
import { usePageTranslation } from "../state/usePageTranslation";
import { ActionSheet, type MenuSpec } from "./ActionSheet";
import { BottomBar, COLLAPSED_HEIGHT, EXPANDED_HEIGHT } from "./BottomBar";
import { FolderNameSheet } from "./FolderNameSheet";
import { HttpsOnlyPage } from "./HttpsOnlyPage";
import { MiniBar } from "./MiniBar";
import { PeekSheet, type PeekRequest } from "./PeekSheet";
import { ReaderScreen } from "./ReaderScreen";
import { SearchSheet } from "./SearchSheet";
import { SettingsScreen } from "./SettingsScreen";
import { SpaceEditor } from "./SpaceEditor";
import { StartPage } from "./StartPage";
import { TabOverview } from "./TabOverview";
import { WebTab } from "./WebTab";

/** WebViews kept alive besides the active one (unmounted tabs reload when shown again). */
const MAX_LIVE_TABS = 4;

type Overlay = "none" | "search" | "tabs" | "settings";

/**
 * The browser: the pages (live WebViews), the bottom toolbar, and what opens over them (search
 * sheet, tab overview, settings, reader, sheets). Each concern lives in a hook of `hooks/`.
 */
export function BrowserScreen() {
  const { model, bookmarks, mobile, favorites, boosts, annotations } = useBrowserState();
  // Boosts (ADR-029): one payload for normal tabs, one for private ones (scripts only if allowed).
  const normalBoosts = useMemo(() => boostPayload(boosts, false), [boosts]);
  const privateBoosts = useMemo(() => boostPayload(boosts, true), [boosts]);
  const actions = useBrowserActions();
  const { colors, dark, isPrivate, reduceMotion, haptic } = useTheme();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();

  const [overlay, setOverlay] = useState<Overlay>("none");
  const [menu, setMenu] = useState<MenuSpec | null>(null);
  const [editingSpace, setEditingSpace] = useState<SpaceInfo | null>(null);
  const [renamingFolder, setRenamingFolder] = useState<MobileFolder | null>(null);
  const [searchText, setSearchText] = useState("");
  /** "Version ordinateur" tabs (ADR-026), for this run of the app. */
  const [desktopTabs, setDesktopTabs] = useState<ReadonlySet<string>>(() => new Set());
  /** Page translation (ADR-036). */
  const translation = usePageTranslation(() => setOverlay("settings"));
  /** Link peek (ADR-027): the long-pressed link shown in a sheet. */
  const [peek, setPeek] = useState<PeekRequest | null>(null);

  const tab = activeTab(model);
  const tabs = useMemo(() => orderedTabs(model), [model]);
  const { copy, share } = useShareActions(haptic);

  useEffect(() => {
    SystemUI.setBackgroundColorAsync(colors.bg).catch(() => {});
  }, [colors.bg]);

  const { collapse, collapsed, expand, onPageScroll } = useToolbarCollapse({ enabled: mobile.collapseToolbar, reduceMotion, tabId: tab?.id, loadSeq: tab?.load.seq });

  // --- Geometry -------------------------------------------------------------------------------
  const pageTop = insets.top;
  const collapsedBar = COLLAPSED_HEIGHT + insets.bottom;
  const expandedBar = EXPANDED_HEIGHT + insets.bottom;
  // iOS: the page runs under the translucent toolbar (content inset, no relayout while
  // scrolling). Android has no content inset: the page is resized when the toolbar toggles.
  const pageBottom = Platform.OS === "ios" ? collapsedBar : collapsed ? collapsedBar : expandedBar;
  const pageHeight = Math.max(1, height - pageTop - pageBottom);
  const contentInset = Platform.OS === "ios" ? EXPANDED_HEIGHT - COLLAPSED_HEIGHT : 0;

  // --- Live WebViews --------------------------------------------------------------------------
  const live = useMemo(() => new Set(liveTabIds(model, MAX_LIVE_TABS, Platform.OS === "ios")), [model]);
  const liveTabs = model.tabs.filter((candidate) => live.has(candidate.id));

  // --- Tab overview zoom transition -----------------------------------------------------------
  const overview = useOverviewTransition({
    model,
    tabId: tab?.id ?? null,
    width,
    height,
    insets,
    pageTop,
    pageHeight,
    hasPinned: tabs.some((candidate) => candidate.isPinned),
    hasFavorites: !isPrivate && favorites.length > 0,
    reduceMotion,
    onOpened: () => {
      haptic("light");
      setMenu(null);
      setOverlay("tabs");
    },
    onClosed: () => setOverlay("none"),
    onActivate: actions.activate,
  });

  // --- Actions --------------------------------------------------------------------------------
  const openSearch = useEvent(() => {
    setMenu(null);
    setSearchText(tab?.url ?? "");
    setOverlay("search");
  });

  const newTab = useEvent((asPrivate: boolean) => {
    haptic("light");
    actions.newTab({ private: asPrivate });
    overview.reset();
    setSearchText("");
    setOverlay("search");
  });

  const submit = useEvent((text: string) => {
    const result = actions.submit(text);
    if (result.kind === "settings") setOverlay("settings");
    else if (result.kind === "page") {
      haptic("light");
      setOverlay("none");
    }
  });

  const { siteInfoMenu, showSiteInfo, boostMenu } = useSiteMenus({ tab, boosts, actions, haptic, setMenu, copy });

  const runCommand = useEvent((id: CommandId) => {
    const current = tab;
    switch (id) {
      case "new-tab":
        return newTab(false);
      case "close-tab":
        if (current) actions.closeTab(current.id);
        break;
      case "duplicate-tab":
        if (current) actions.duplicate(current.id);
        break;
      case "toggle-pin":
        if (current) actions.setPinned(current.id, !current.isPinned);
        break;
      case "reload":
        actions.reload();
        break;
      case "back":
        actions.goBack();
        break;
      case "forward":
        actions.goForward();
        break;
      case "copy-url":
        if (current?.url) copy(current.url);
        break;
      case "toggle-bookmark":
        if (current?.url) {
          actions.toggleBookmark(current);
          haptic("success");
        }
        break;
      case "clear-history": {
        const confirm = getCommand("clear-history").confirm;
        if (confirm)
          Alert.alert(confirm.title, confirm.detail, [
            { text: "Annuler", style: "cancel" },
            { text: confirm.action, style: "destructive", onPress: () => actions.clearHistory() },
          ]);
        break;
      }
      case "open-settings":
        setOverlay("settings");
        return;
      case "sync-now":
        actions.sync.syncNow();
        break;
      case "site-info":
        showSiteInfo();
        break;
      case "new-space": {
        const spaceId = actions.addSpace();
        setEditingSpace({ id: spaceId, name: "", icon: FALLBACK_SPACE_ICON, color: null, isolated: false });
        break;
      }
      case "next-space":
      case "previous-space": {
        const next = cycleSpace(model.spaces, model.activeSpaceId, id === "next-space" ? 1 : -1);
        if (next) actions.showSpace(next);
        break;
      }
      default:
        break;
    }
    setOverlay("none");
  });

  const pick = useEvent((item: SheetItem) => {
    const { action } = item;
    switch (action.type) {
      case "tab":
        actions.activate(action.tabId);
        setOverlay("none");
        break;
      case "open":
      case "favorite":
      case "archived":
        // Pages, remote tabs and typed addresses alike: the sheet's tab loads it.
        submit(action.url);
        break;
      case "copy":
        copy(action.text);
        setOverlay("none");
        break;
      case "command":
        runCommand(action.command.id);
        break;
      case "custom":
        if (action.id === "share" && tab?.url) {
          setOverlay("none");
          share(tab.url, tab.title);
        } else if (action.id === "new-private-tab") newTab(true);
        else if (action.id === "show-tabs") overview.open();
        break;
      case "scope":
        break;
    }
  });

  const { shiftStyle, canSwipe, onSwipeTab } = usePageSwipe({ model, width, reduceMotion, haptic, onActivate: actions.activate, onNewTab: () => newTab(isPrivate) });

  const onLinkMenu = useLinkMenu({ busy: !!menu || !!peek || overlay !== "none", isPrivate, tabId: tab?.id, actions, haptic, setMenu, setPeek, copy, share });
  const { onHighlight, onHighlightPress } = useHighlights({ model, annotations, activeId: tab?.id, busy: !!menu || overlay !== "none", actions, haptic, setMenu, copy });
  const mini = useMiniPlayer({ tab, shown: overlay === "none", actions });
  const passwordMenus = usePasswordMenus({ tab, model, busy: !!menu || overlay !== "none", actions, haptic, setMenu });
  const autofillMenus = useAutofillMenus(tab);
  const reader = useReader({ tab, visible: overlay === "none" });

  const toggleDesktopSite = useEvent((tabId: string) =>
    setDesktopTabs((current) => {
      const next = new Set(current);
      if (!next.delete(tabId)) next.add(tabId);
      return next;
    }),
  );

  const openFavorite = useEvent((url: string) => {
    if (overlay === "tabs") overview.close(actions.openFavorite(url));
    else actions.openFavorite(url);
  });

  const menus = useBrowserMenus({
    tab,
    model,
    bookmarks,
    favorites,
    isPrivate,
    actions,
    haptic,
    setMenu,
    copy,
    share,
    newTab,
    submit,
    openSettings: () => setOverlay("settings"),
    openFavorite,
    renameFolder: setRenamingFolder,
    siteInfoMenu,
    boostMenu: () => boostMenu(),
    passwordsMenu: passwordMenus.passwordsMenu,
    hasPasswords: passwordMenus.tabPasswords.length > 0,
    autofillMenu: autofillMenus.menu,
    autofillSections: autofillMenus.sections,
    openReader: reader.open,
    translated: !!tab && translation.translated.has(tab.id),
    toggleTranslation: () => void (tab && translation.toggle(tab.id, isPrivateTab(tab))),
    desktopSite: !!tab && desktopTabs.has(tab.id),
    toggleDesktopSite,
  });

  const toggleFolder = useEvent((id: string) => actions.toggleFolder(id));
  const restoreArchived = useEvent((id: string) => {
    const tabId = actions.restoreArchived(id);
    if (tabId) overview.close(tabId);
  });
  const removeArchived = useEvent((id: string) => actions.removeArchived(id));
  const clearArchive = useEvent(() => actions.clearArchive());
  const openFromStart = useEvent((url: string) => submit(url));
  const showSpace = useEvent((id: string) => actions.showSpace(id));
  const addSpace = useEvent(() => runCommand("new-space"));
  const closeTab = useEvent((id: string) => actions.closeTab(id));
  const goBack = useEvent(() => actions.goBack());
  const goForward = useEvent(() => actions.goForward());
  const reload = useEvent(() => actions.reload());
  const stop = useEvent(() => actions.stop());
  const shareActive = useEvent(() => tab?.url && share(tab.url, tab.title));
  const closeSearch = useEvent(() => setOverlay("none"));
  const closePeek = useEvent(() => setPeek(null));
  const newTabHere = useEvent(() => newTab(isPrivate));
  const overviewDone = useEvent(() => overview.close());
  const selectTab = useEvent((id: string) => overview.close(id));
  const openRemote = useEvent((url: string) => overview.close(actions.openUrl(url)));

  // Android back: close what is open, then go back in the page.
  useAndroidBack(() => {
    if (menu) return setMenu(null), true;
    if (peek) return setPeek(null), true;
    if (editingSpace) return setEditingSpace(null), true;
    if (renamingFolder) return setRenamingFolder(null), true;
    if (overlay === "tabs") return overview.close(), true;
    if (overlay !== "none") return setOverlay("none"), true;
    if (reader.shown) return reader.close(), true;
    if (tab?.interstitial) return actions.reload(), true;
    if (tab?.canGoBack) return actions.goBack(), true;
    return false;
  });

  const showStart = !tab || tab.url === "";

  return (
    <View style={[styles.root, { backgroundColor: colors.bg }]}>
      <StatusBar style={dark ? "light" : "dark"} />

      {overlay === "tabs" && (
        <View style={[StyleSheet.absoluteFill, { zIndex: 1 }]}>
          <TabOverview
            model={model}
            activeId={tab?.id ?? null}
            geometry={overview.geometry}
            progress={overview.progress}
            scrollY={overview.gridScrollY}
            initialScrollY={overview.initialScrollY}
            onSelect={selectTab}
            onCloseTab={closeTab}
            onTabMenu={menus.tabMenu}
            onNewTab={newTabHere}
            onDone={overviewDone}
            onSearch={openSearch}
            onShowSpace={showSpace}
            onSpaceMenu={setEditingSpace}
            onAddSpace={addSpace}
            onOpenRemote={openRemote}
            onOpenFavorite={openFavorite}
            onFavoriteMenu={menus.favoriteMenu}
            onToggleFolder={toggleFolder}
            onFolderMenu={menus.folderMenu}
            onRestoreArchived={restoreArchived}
            onRemoveArchived={removeArchived}
            onClearArchive={clearArchive}
          />
        </View>
      )}

      <Animated.View
        style={[styles.page, { top: pageTop, width, zIndex: overlay === "tabs" ? 2 : 0, backgroundColor: colors.bg }, overview.pageStyle]}
        pointerEvents={overlay === "tabs" ? "none" : "auto"}
      >
        <Animated.View style={[{ height: pageHeight, width }, shiftStyle]}>
          {liveTabs.map((candidate) => (
            <WebTab
              key={candidate.id}
              id={candidate.id}
              loadUrl={candidate.load.url}
              loadSeq={candidate.load.seq}
              resumeUrl={mountUrl(candidate)}
              upgradedFrom={candidate.upgradedFrom}
              isPrivate={isPrivateTab(candidate)}
              active={candidate.id === tab?.id && !showStart && !candidate.interstitial}
              background={colors.bg}
              bottomInset={contentInset}
              onScroll={onPageScroll}
              onLinkMenu={onLinkMenu}
              onPasswordCapture={passwordMenus.onCapture}
              desktopSite={desktopTabs.has(candidate.id)}
              readerToken={reader.request?.tabId === candidate.id ? reader.request.token : null}
              onReaderArticle={reader.onArticle}
              boosts={isPrivateTab(candidate) ? privateBoosts : normalBoosts}
              onMedia={mini.onMedia}
              translateRequest={translation.requests[candidate.id] ?? null}
              autofillRequest={autofillMenus.requests[candidate.id] ?? null}
              onTranslateBatch={translation.batch}
              onTranslateReset={translation.reset}
              annotations={annotations}
              onHighlight={onHighlight}
              onHighlightPress={onHighlightPress}
            />
          ))}
          {showStart && (
            <StartPage
              bottomInset={contentInset}
              onSearch={openSearch}
              onOpen={openFromStart}
              onLongPressSite={menus.siteMenu}
              onOpenFavorite={openFavorite}
              onFavoriteMenu={menus.favoriteMenu}
            />
          )}
          {tab?.interstitial && (
            <HttpsOnlyPage
              url={tab.interstitial.url}
              onContinue={() => actions.allowHttp(tab.id, tab.interstitial!.url)}
              onBack={() => (tab.canGoBack ? actions.goBack() : actions.submit(""))}
            />
          )}
        </Animated.View>
      </Animated.View>

      {mini.miniBar && !showStart && (
        <View style={[styles.miniBar, { bottom: (collapsed ? collapsedBar : expandedBar) + 8 }]} pointerEvents="box-none">
          <MiniBar {...mini.miniBar} onToggle={mini.toggle} onClose={mini.close} />
        </View>
      )}
      <Animated.View style={[StyleSheet.absoluteFill, { zIndex: 3 }, overview.barStyle]} pointerEvents={overlay === "none" ? "box-none" : "none"}>
        <BottomBar
          tab={tab}
          tabCount={tabs.length}
          bottomInset={insets.bottom}
          collapse={collapse}
          collapsed={collapsed}
          interactive={overlay === "none"}
          canSwipe={canSwipe}
          onSwipeTab={onSwipeTab}
          onSwipeUp={overview.open}
          onOpenSearch={openSearch}
          onExpand={expand}
          onLongPressAddress={menus.addressMenu}
          onSiteInfo={showSiteInfo}
          hasPasswords={passwordMenus.tabPasswords.length > 0}
          onPasswords={passwordMenus.showPasswords}
          onBack={goBack}
          onForward={goForward}
          onShare={shareActive}
          onTabs={overview.open}
          onTabsLongPress={menus.tabsMenu}
          onMenu={menus.pageMenu}
          onReload={reload}
          onStop={stop}
        />
      </Animated.View>

      {reader.shown && (
        <View style={[StyleSheet.absoluteFill, { zIndex: 4 }]}>
          <ReaderScreen
            article={reader.shown}
            onClose={reader.close}
            onOpenLink={(url) => {
              reader.close();
              submit(url);
            }}
          />
        </View>
      )}
      {overlay === "search" && (
        <View style={[StyleSheet.absoluteFill, { zIndex: 4 }]}>
          <SearchSheet initialText={searchText} onSubmit={submit} onPick={pick} onClose={closeSearch} />
        </View>
      )}
      {overlay === "settings" && (
        <View style={[StyleSheet.absoluteFill, { zIndex: 4 }]}>
          <SettingsScreen onClose={closeSearch} />
        </View>
      )}
      {peek && (
        <View style={[StyleSheet.absoluteFill, { zIndex: 5 }]} pointerEvents="box-none">
          <PeekSheet peek={peek} onClose={closePeek} />
        </View>
      )}
      <View style={[StyleSheet.absoluteFill, { zIndex: 5 }]} pointerEvents="box-none">
        <ActionSheet menu={menu} onClose={() => setMenu(null)} onReplace={setMenu} />
        {editingSpace && <SpaceEditor space={editingSpace} onClose={() => setEditingSpace(null)} />}
        {renamingFolder && (
          <FolderNameSheet
            initial={renamingFolder.name}
            onSave={(name) => actions.renameFolder(renamingFolder.id, name)}
            onClose={() => setRenamingFolder(null)}
          />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  page: { position: "absolute", left: 0, overflow: "hidden", transformOrigin: "left top" },
  miniBar: { position: "absolute", left: 0, right: 0, zIndex: 3 },
});
