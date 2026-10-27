import { getCommand, type CommandId } from "@shared/commands";
import { cycleSpace, FALLBACK_SPACE_ICON } from "@shared/spaces";
import type { SpaceInfo } from "@shared/types";
import { displayUrl } from "@shared/url";
import * as Clipboard from "expo-clipboard";
import { StatusBar } from "expo-status-bar";
import * as SystemUI from "expo-system-ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, BackHandler, Platform, Share, StyleSheet, View, useWindowDimensions } from "react-native";
import Animated, { Easing, interpolate, useAnimatedStyle, useSharedValue, withSpring, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { scheduleOnRN } from "react-native-worklets";
import { isBookmarked } from "../lib/bookmarks";
import { initialCollapse, nextCollapse } from "../lib/gestures";
import type { LinkMenuRequest } from "../lib/linkMenu";
import type { Rect } from "../lib/overviewLayout";
import type { SheetItem } from "../lib/searchSheet";
import { connectionLabel, mobileSiteInfo, SITE_DATA_NOTE } from "../lib/siteInfo";
import { activeTab, isPrivateTab, liveTabIds, mountUrl, orderedTabs, swipeTarget, type MobileTab } from "../lib/tabs";
import { useBrowserActions, useBrowserState, useEvent } from "../state/BrowserProvider";
import { useTheme } from "../state/theme";
import { ActionSheet, type MenuItem, type MenuSpec } from "./ActionSheet";
import { BottomBar, COLLAPSED_HEIGHT, EXPANDED_HEIGHT } from "./BottomBar";
import { HttpsOnlyPage } from "./HttpsOnlyPage";
import { SearchSheet } from "./SearchSheet";
import { SettingsScreen } from "./SettingsScreen";
import { SpaceEditor } from "./SpaceEditor";
import { StartPage } from "./StartPage";
import { initialScroll, overviewGeometry, overviewTarget, TabOverview } from "./TabOverview";
import { WebTab } from "./WebTab";

/** WebViews kept alive besides the active one (unmounted tabs reload when shown again). */
const MAX_LIVE_TABS = 4;

type Overlay = "none" | "search" | "tabs" | "settings";

export function BrowserScreen() {
  const { model, bookmarks, mobile } = useBrowserState();
  const actions = useBrowserActions();
  const { colors, dark, isPrivate, reduceMotion, haptic } = useTheme();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();

  const [overlay, setOverlay] = useState<Overlay>("none");
  const [menu, setMenu] = useState<MenuSpec | null>(null);
  const [editingSpace, setEditingSpace] = useState<SpaceInfo | null>(null);
  const [searchText, setSearchText] = useState("");
  const [overviewScroll, setOverviewScroll] = useState(0);

  const tab = activeTab(model);
  const tabs = useMemo(() => orderedTabs(model), [model]);
  const tabBookmarked = tab ? isBookmarked(bookmarks, tab.url) : false;

  useEffect(() => {
    SystemUI.setBackgroundColorAsync(colors.bg).catch(() => {});
  }, [colors.bg]);

  // --- Toolbar collapse -----------------------------------------------------------------------
  const collapse = useSharedValue(0);
  const collapseState = useRef(initialCollapse);
  const [collapsed, setCollapsed] = useState(false);
  const applyCollapse = useCallback(
    (value: boolean) => {
      collapse.value = withTiming(value ? 1 : 0, { duration: reduceMotion ? 0 : 220, easing: Easing.out(Easing.cubic) });
      setCollapsed(value);
    },
    [collapse, reduceMotion],
  );
  const expand = useCallback(() => {
    collapseState.current = initialCollapse;
    applyCollapse(false);
  }, [applyCollapse]);
  const onPageScroll = useEvent((y: number, contentHeight: number, viewportHeight: number) => {
    if (!mobile.collapseToolbar) return;
    const next = nextCollapse(collapseState.current, y, contentHeight, viewportHeight);
    collapseState.current = next;
    if (next.collapsed !== collapsed) applyCollapse(next.collapsed);
  });
  useEffect(() => {
    expand();
  }, [tab?.id, tab?.load.seq, expand]);

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
  const progress = useSharedValue(0);
  const target = useSharedValue<Rect>({ x: 0, y: pageTop, width, height: pageHeight });
  const gridScrollY = useSharedValue(0);
  const hasPinned = tabs.some((candidate) => candidate.isPinned);
  const geometry = useMemo(() => overviewGeometry(width, height, insets.top, insets.bottom, hasPinned), [width, height, insets.top, insets.bottom, hasPinned]);
  const zoomTiming = { duration: reduceMotion ? 0 : 360, easing: Easing.bezier(0.2, 0.85, 0.1, 1) };

  const openOverview = useEvent(() => {
    haptic("light");
    setMenu(null);
    const scroll = initialScroll(geometry, model, tab?.id ?? null, insets.bottom);
    gridScrollY.value = scroll;
    setOverviewScroll(scroll);
    target.value = overviewTarget(geometry, model, tab?.id ?? null, scroll, width);
    setOverlay("tabs");
    progress.value = withTiming(1, zoomTiming);
  });

  const closeOverview = useEvent((id?: string) => {
    const destination = id ?? tab?.id ?? null;
    target.value = overviewTarget(geometry, model, destination, gridScrollY.value, width);
    if (id && id !== tab?.id) actions.activate(id);
    progress.value = withTiming(0, zoomTiming, (finished) => {
      if (finished) scheduleOnRN(setOverlay, "none");
    });
  });

  const pageStyle = useAnimatedStyle(() => {
    const p = progress.value;
    const t = target.value;
    const rx = interpolate(p, [0, 1], [0, t.x]);
    const ry = interpolate(p, [0, 1], [pageTop, t.y]);
    const rw = interpolate(p, [0, 1], [width, t.width]);
    const rh = interpolate(p, [0, 1], [pageHeight, t.height]);
    const scale = rw / width;
    return {
      height: rh / scale,
      borderRadius: interpolate(p, [0, 1], [0, 20]) / scale,
      opacity: interpolate(p, [0.86, 1], [1, 0], "clamp"),
      transform: [{ translateX: rx }, { translateY: ry - pageTop }, { scale }],
    };
  });
  const barStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 0.4], [1, 0], "clamp"),
    transform: [{ translateY: interpolate(progress.value, [0, 1], [0, reduceMotion ? 0 : 60]) }],
  }));

  // Sideways slide when switching tabs from the address bar.
  const shift = useSharedValue(0);
  const shiftStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: shift.value }],
    opacity: interpolate(Math.abs(shift.value), [0, width * 0.3], [1, 0.4], "clamp"),
  }));

  // --- Actions --------------------------------------------------------------------------------
  const openSearch = useEvent(() => {
    setMenu(null);
    setSearchText(tab?.url ?? "");
    setOverlay("search");
  });

  const newTab = useEvent((asPrivate: boolean) => {
    haptic("light");
    actions.newTab({ private: asPrivate });
    progress.value = 0;
    setSearchText("");
    setOverlay("search");
  });

  const share = useEvent((url: string, title?: string) => {
    Share.share(Platform.OS === "ios" ? { url, title } : { message: url, title }).catch(() => {});
  });

  const copy = useEvent((text: string) => {
    Clipboard.setStringAsync(text).then(() => haptic("success"), () => {});
  });

  const submit = useEvent((text: string) => {
    const result = actions.submit(text);
    if (result.kind === "settings") setOverlay("settings");
    else if (result.kind === "page") {
      haptic("light");
      setOverlay("none");
    }
  });

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
    switch (item.kind) {
      case "tab":
        actions.activate(item.tab.id);
        setOverlay("none");
        break;
      case "bookmark":
      case "history":
      case "navigate":
      case "search":
        submit(item.url);
        break;
      case "remote":
        actions.openUrl(item.url, { private: isPrivate });
        setOverlay("none");
        break;
      case "command":
        runCommand(item.command.id);
        break;
      case "action":
        if (item.action.id === "share" && tab?.url) {
          setOverlay("none");
          share(tab.url, tab.title);
        } else if (item.action.id === "new-private-tab") newTab(true);
        else if (item.action.id === "show-tabs") openOverview();
        break;
    }
  });

  const onSwipeTab = useEvent((direction: 1 | -1) => {
    const destination = swipeTarget(model, direction);
    if (!destination) return;
    haptic("light");
    if (!reduceMotion) {
      shift.value = direction * width * 0.3;
      shift.value = withSpring(0, { damping: 22, stiffness: 220 });
    }
    if (destination.kind === "tab") actions.activate(destination.id);
    else newTab(isPrivate);
  });

  const onLinkMenu = useEvent((_tabId: string, request: LinkMenuRequest) => {
    if (menu || overlay !== "none") return;
    haptic("medium");
    const items: MenuItem[] = [
      { key: "open", label: "Ouvrir dans un nouvel onglet", icon: "plus", onPress: () => void actions.openUrl(request.url, { private: isPrivate, afterId: tab?.id }) },
      {
        key: "background",
        label: "Ouvrir en arrière-plan",
        icon: "tabs",
        onPress: () => void actions.openUrl(request.url, { private: isPrivate, background: true, afterId: tab?.id }),
      },
    ];
    if (!isPrivate) items.push({ key: "private", label: "Ouvrir dans un onglet privé", icon: "mask", onPress: () => void actions.openUrl(request.url, { private: true }) });
    items.push(
      { key: "copy", label: "Copier le lien", icon: "link", onPress: () => copy(request.url) },
      { key: "share", label: "Partager le lien", icon: "share", onPress: () => share(request.url, request.text) },
    );
    setMenu({ title: request.text || displayUrl(request.url), subtitle: request.url, siteUrl: request.url, items });
  });

  /** Site info sheet (tap on the lock, ADR-021): connection, host, copy link, clear the site's data. */
  const siteInfoMenu = useEvent((): MenuSpec | null => {
    const info = tab ? mobileSiteInfo(tab.url) : null;
    if (!tab || !info) return null;
    const url = tab.url;
    return {
      title: info.host,
      subtitle: connectionLabel(info),
      siteUrl: url,
      note: SITE_DATA_NOTE,
      items: [
        { key: "copy", label: "Copier le lien", icon: "link", onPress: () => copy(url) },
        {
          key: "clear",
          label: "Effacer les données du site",
          icon: "trash",
          destructive: true,
          onPress: () => ({
            title: `Effacer les données de ${info.host} ?`,
            subtitle: "Vous pourriez être déconnecté de ce site. La page sera rechargée.",
            items: [
              {
                key: "confirm",
                label: "Effacer et recharger",
                icon: "trash",
                destructive: true,
                onPress: () => {
                  actions.clearSiteData();
                  haptic("success");
                },
              },
              { key: "cancel", label: "Annuler", icon: "close", onPress: () => {} },
            ],
          }),
        },
      ],
    };
  });

  const showSiteInfo = useEvent(() => {
    const spec = siteInfoMenu();
    if (spec) setMenu(spec);
  });

  const pageMenu = useEvent(() => {
    const items: MenuItem[] = [];
    if (tab?.url) {
      items.push(
        {
          key: "bookmark",
          label: tabBookmarked ? "Retirer des favoris" : "Ajouter aux favoris",
          icon: "star",
          onPress: () => {
            actions.toggleBookmark(tab);
            haptic("success");
          },
        },
        { key: "copy", label: "Copier le lien", icon: "link", onPress: () => copy(tab.url) },
        ...(mobileSiteInfo(tab.url) ? [{ key: "site-info", label: "Infos sur le site", icon: "info" as const, onPress: () => siteInfoMenu() ?? undefined }] : []),
        { key: "pin", label: tab.isPinned ? "Désépingler l'onglet" : "Épingler l'onglet", icon: "pin", onPress: () => actions.setPinned(tab.id, !tab.isPinned) },
        { key: "duplicate", label: "Dupliquer l'onglet", icon: "copy", onPress: () => void actions.duplicate(tab.id) },
      );
    }
    items.push(
      { key: "new", label: "Nouvel onglet", icon: "plus", onPress: () => newTab(false) },
      { key: "private", label: isPrivate ? "Nouvel onglet privé" : "Nouvel onglet privé", icon: "mask", onPress: () => newTab(true) },
      { key: "settings", label: "Paramètres", icon: "settings", onPress: () => setOverlay("settings") },
    );
    setMenu({ title: tab?.title || (tab?.url ? displayUrl(tab.url) : "Page d'accueil"), subtitle: tab?.url ? displayUrl(tab.url) : undefined, siteUrl: tab?.url, items });
  });

  const addressMenu = useEvent(() => {
    const items: MenuItem[] = [
      {
        key: "paste",
        label: "Coller et aller",
        icon: "fill",
        onPress: () => {
          Clipboard.getStringAsync().then((text) => text.trim() && submit(text), () => {});
        },
      },
    ];
    if (tab?.url) {
      items.unshift({ key: "copy", label: "Copier le lien", icon: "link", onPress: () => copy(tab.url) });
      items.push({ key: "share", label: "Partager", icon: "share", onPress: () => share(tab.url, tab.title) });
      if (mobileSiteInfo(tab.url)) items.push({ key: "site-info", label: "Infos sur le site", icon: "info", onPress: () => siteInfoMenu() ?? undefined });
    }
    setMenu({ items });
  });

  const tabsMenu = useEvent(() => {
    const items: MenuItem[] = [
      { key: "new", label: "Nouvel onglet", icon: "plus", onPress: () => newTab(false) },
      { key: "private", label: "Nouvel onglet privé", icon: "mask", onPress: () => newTab(true) },
    ];
    if (tab) items.push({ key: "close", label: "Fermer cet onglet", icon: "close", destructive: true, onPress: () => actions.closeTab(tab.id) });
    setMenu({ items });
  });

  const tabMenu = useEvent((target: MobileTab): void => {
    const items: MenuItem[] = [
      { key: "pin", label: target.isPinned ? "Désépingler" : "Épingler", icon: "pin", onPress: () => actions.setPinned(target.id, !target.isPinned) },
      { key: "duplicate", label: "Dupliquer", icon: "copy", onPress: () => void actions.duplicate(target.id) },
    ];
    const destinations = model.spaces.filter((space) => space.id !== target.spaceId);
    if (!isPrivateTab(target) && destinations.length > 0) {
      items.push({
        key: "move",
        label: "Déplacer vers l'espace…",
        icon: "layers",
        onPress: () => ({
          title: "Déplacer vers",
          items: destinations.map((space) => ({
            key: space.id,
            label: space.name,
            icon: space.icon,
            onPress: () => actions.moveToSpace(target.id, space.id),
          })),
        }),
      });
    }
    if (target.url) items.push({ key: "share", label: "Partager", icon: "share", onPress: () => share(target.url, target.title) });
    items.push({ key: "close", label: "Fermer l'onglet", icon: "close", destructive: true, onPress: () => actions.closeTab(target.id) });
    setMenu({ title: target.title || (target.url ? displayUrl(target.url) : "Page d'accueil"), subtitle: target.url ? displayUrl(target.url) : undefined, siteUrl: target.url, items });
  });

  const siteMenu = useEvent((url: string, title: string) => {
    haptic("medium");
    const bookmark = bookmarks.find((candidate) => candidate.url === url);
    const items: MenuItem[] = [
      { key: "open", label: "Ouvrir dans un nouvel onglet", icon: "plus", onPress: () => void actions.openUrl(url) },
      { key: "copy", label: "Copier le lien", icon: "link", onPress: () => copy(url) },
    ];
    if (bookmark) items.push({ key: "remove", label: "Retirer des favoris", icon: "trash", destructive: true, onPress: () => actions.removeBookmark(bookmark.id) });
    setMenu({ title, subtitle: displayUrl(url), siteUrl: url, items });
  });

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
  const newTabHere = useEvent(() => newTab(isPrivate));
  const overviewDone = useEvent(() => closeOverview());
  const selectTab = useEvent((id: string) => closeOverview(id));
  const openRemote = useEvent((url: string) => closeOverview(actions.openUrl(url)));

  // Android back: close what is open, then go back in the page.
  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (menu) return setMenu(null), true;
      if (editingSpace) return setEditingSpace(null), true;
      if (overlay === "tabs") return closeOverview(), true;
      if (overlay !== "none") return setOverlay("none"), true;
      if (tab?.interstitial) return actions.reload(), true;
      if (tab?.canGoBack) return actions.goBack(), true;
      return false;
    });
    return () => subscription.remove();
  }, [menu, editingSpace, overlay, tab, actions, closeOverview]);

  const canSwipe = useMemo(() => ({ previous: swipeTarget(model, -1) !== null, next: swipeTarget(model, 1) !== null }), [model]);
  const showStart = !tab || tab.url === "";

  return (
    <View style={[styles.root, { backgroundColor: colors.bg }]}>
      <StatusBar style={dark ? "light" : "dark"} />

      {overlay === "tabs" && (
        <View style={[StyleSheet.absoluteFill, { zIndex: 1 }]}>
          <TabOverview
            model={model}
            activeId={tab?.id ?? null}
            geometry={geometry}
            progress={progress}
            scrollY={gridScrollY}
            initialScrollY={overviewScroll}
            onSelect={selectTab}
            onCloseTab={closeTab}
            onTabMenu={tabMenu}
            onNewTab={newTabHere}
            onDone={overviewDone}
            onSearch={openSearch}
            onShowSpace={showSpace}
            onSpaceMenu={setEditingSpace}
            onAddSpace={addSpace}
            onOpenRemote={openRemote}
          />
        </View>
      )}

      <Animated.View
        style={[styles.page, { top: pageTop, width, zIndex: overlay === "tabs" ? 2 : 0, backgroundColor: colors.bg }, pageStyle]}
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
            />
          ))}
          {showStart && <StartPage bottomInset={contentInset} onSearch={openSearch} onOpen={openFromStart} onLongPressSite={siteMenu} />}
          {tab?.interstitial && (
            <HttpsOnlyPage
              url={tab.interstitial.url}
              onContinue={() => actions.allowHttp(tab.id, tab.interstitial!.url)}
              onBack={() => (tab.canGoBack ? actions.goBack() : actions.submit(""))}
            />
          )}
        </Animated.View>
      </Animated.View>

      <Animated.View style={[StyleSheet.absoluteFill, { zIndex: 3 }, barStyle]} pointerEvents={overlay === "none" ? "box-none" : "none"}>
        <BottomBar
          tab={tab}
          tabCount={tabs.length}
          bottomInset={insets.bottom}
          collapse={collapse}
          collapsed={collapsed}
          interactive={overlay === "none"}
          canSwipe={canSwipe}
          onSwipeTab={onSwipeTab}
          onSwipeUp={openOverview}
          onOpenSearch={openSearch}
          onExpand={expand}
          onLongPressAddress={addressMenu}
          onSiteInfo={showSiteInfo}
          onBack={goBack}
          onForward={goForward}
          onShare={shareActive}
          onTabs={openOverview}
          onTabsLongPress={tabsMenu}
          onMenu={pageMenu}
          onReload={reload}
          onStop={stop}
        />
      </Animated.View>

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
      <View style={[StyleSheet.absoluteFill, { zIndex: 5 }]} pointerEvents="box-none">
        <ActionSheet menu={menu} onClose={() => setMenu(null)} onReplace={setMenu} />
        {editingSpace && <SpaceEditor space={editingSpace} onClose={() => setEditingSpace(null)} />}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  page: { position: "absolute", left: 0, overflow: "hidden", transformOrigin: "left top" },
});
