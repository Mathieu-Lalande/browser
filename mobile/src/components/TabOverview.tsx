import { isFavoriteTab, type Favorite } from "@shared/favorites";
import type { SpaceInfo } from "@shared/types";
import { memo, useMemo } from "react";
import { StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { GestureDetector, usePanGesture } from "react-native-gesture-handler";
import Animated, { FadeIn, interpolate, useAnimatedStyle, useSharedValue, withSpring, withTiming, type SharedValue } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { pagerTarget, rubberBand } from "../lib/gestures";
import { pagerPages } from "../lib/organize";
import { gridLayout, scrollOffsetForRect, sectionedGrid, type GridLayout, type GridSection, type Rect } from "../lib/overviewLayout";
import { isPrivateTab, orderedTabs, overviewGroups, PRIVATE_SPACE_ID, type MobileFolder, type MobileTab, type TabsModel } from "../lib/tabs";
import { useBrowserState } from "../state/BrowserProvider";
import { useTheme } from "../state/theme";
import { Icon } from "./Icon";
import { ArchivedTabs, FAVORITES_ROW, FavoritesRow } from "./Organize";
import { FolderGroup } from "./overview/FolderGroup";
import { OVERVIEW_BAR, OverviewToolbar } from "./overview/OverviewToolbar";
import { CHIPS_HEIGHT, SpaceChips } from "./overview/SpaceChips";
import { PINNED_TILE, PinnedTile, TabCard } from "./overview/TabCard";
import { RemoteTabs } from "./RemoteTabs";

export { CHIPS_HEIGHT, OVERVIEW_BAR };
export const PINNED_HEIGHT = 84;

export interface OverviewGeometry {
  layout: GridLayout;
  /** Screen y of the grid's scroll content origin. */
  gridTop: number;
  gridHeight: number;
  pinnedTop: number;
  /** Screen y of the space chips, right above the bottom bar (thumb zone). */
  chipsTop: number;
}

/** Top margin above the pinned tiles / grid, now that the space chips live at the bottom. */
const TOP_MARGIN = 8;

/** Top padding of the grid's scroll content. */
const GRID_TOP = 8;

/**
 * `hasFavorites`: the favorites row (ADR-022) sits at the top of the grid's scroll content, the
 * cards below it.
 */
export function overviewGeometry(width: number, height: number, top: number, bottom: number, hasPinned: boolean, hasFavorites = false): OverviewGeometry {
  const pinnedTop = top + TOP_MARGIN;
  const gridTop = pinnedTop + (hasPinned ? PINNED_HEIGHT : 0);
  const chipsTop = height - bottom - OVERVIEW_BAR - CHIPS_HEIGHT;
  const base = gridLayout(width, GRID_TOP);
  const layout = hasFavorites ? { ...base, top: GRID_TOP + FAVORITES_ROW + base.gap } : base;
  return { layout, gridTop, gridHeight: Math.max(0, chipsTop - gridTop), pinnedTop, chipsTop };
}

/** Cards of the space shown, grouped by folder (ADR-022): the grid's sections and its visible cards in order. */
export function overviewSections(model: TabsModel): { sections: GridSection[]; visible: MobileTab[] } {
  const groups = overviewGroups(model);
  const sections: GridSection[] = [{ header: false, count: groups.loose.length }];
  const visible = [...groups.loose];
  for (const { folder, tabs } of groups.folders) {
    sections.push({ header: true, count: folder.collapsed ? 0 : tabs.length });
    if (!folder.collapsed) visible.push(...tabs);
  }
  return { sections, visible };
}

/** Where the given tab sits on screen in the overview (zoom transition target). */
export function overviewTarget(geometry: OverviewGeometry, model: TabsModel, tabId: string | null, scrollY: number, width: number): Rect {
  const tabs = orderedTabs(model);
  const pinned = tabs.filter((tab) => tab.isPinned);
  const pinnedIndex = pinned.findIndex((tab) => tab.id === tabId);
  if (pinnedIndex !== -1) {
    return { x: 16 + pinnedIndex * (PINNED_TILE + 14), y: geometry.pinnedTop + 6, width: PINNED_TILE, height: PINNED_TILE };
  }
  const { sections, visible } = overviewSections(model);
  const index = visible.findIndex((tab) => tab.id === tabId);
  const rect = index === -1 ? undefined : sectionedGrid(geometry.layout, sections).cards[index];
  if (!rect) {
    return { x: width / 2 - 40, y: geometry.gridTop + geometry.gridHeight / 2 - 50, width: 80, height: 100 };
  }
  return { ...rect, y: geometry.gridTop + rect.y - scrollY };
}

export function initialScroll(geometry: OverviewGeometry, model: TabsModel, tabId: string | null, bottom: number): number {
  const { sections, visible } = overviewSections(model);
  const grid = sectionedGrid(geometry.layout, sections);
  return scrollOffsetForRect(grid.cards[visible.findIndex((tab) => tab.id === tabId)], grid.bottom, geometry.gridHeight, bottom + 24);
}

interface Props {
  model: TabsModel;
  activeId: string | null;
  geometry: OverviewGeometry;
  /** 0 = page shown, 1 = overview shown. */
  progress: SharedValue<number>;
  scrollY: SharedValue<number>;
  initialScrollY: number;
  onSelect: (id: string) => void;
  onCloseTab: (id: string) => void;
  onTabMenu: (tab: MobileTab) => void;
  onNewTab: () => void;
  onDone: () => void;
  onSearch: () => void;
  onShowSpace: (id: string) => void;
  onSpaceMenu: (space: SpaceInfo) => void;
  onAddSpace: () => void;
  /** Opens a tab of another synced device ("Autres appareils"). */
  onOpenRemote?: (url: string) => void;
  /** Favorites row (ADR-022). */
  onOpenFavorite: (url: string) => void;
  onFavoriteMenu: (favorite: Favorite) => void;
  /** Folder header: tap folds it, long press opens its menu. */
  onToggleFolder: (id: string) => void;
  onFolderMenu: (folder: MobileFolder) => void;
  /** "Archivés" section. */
  onRestoreArchived: (id: string) => void;
  onRemoveArchived: (id: string) => void;
  onClearArchive: () => void;
}

/**
 * Tab grid with spaces (chips), private tabs, pinned tabs, favorites and folders, Arc/Safari style.
 * A horizontal swipe on the grid goes to the previous/next space (pager, ADR-022), the chips follow.
 */
export const TabOverview = memo(function TabOverview(props: Props) {
  const { model, activeId, geometry, progress, scrollY, initialScrollY } = props;
  const { colors, isPrivate, reduceMotion, haptic } = useTheme();
  const { favorites } = useBrowserState();
  const { width } = useWindowDimensions();
  const tabs = useMemo(() => orderedTabs(model), [model]);
  const pinned = tabs.filter((tab) => tab.isPinned);
  const groups = useMemo(() => overviewGroups(model), [model]);
  const privateCount = useMemo(() => model.tabs.filter(isPrivateTab).length, [model.tabs]);
  const spaceTabs = useMemo(() => model.tabs.filter((tab) => tab.spaceId === model.activeSpaceId), [model]);
  const showFavorites = !isPrivate && favorites.length > 0;

  // --- Pager between spaces ------------------------------------------------------------------
  const pages = useMemo(() => pagerPages(model, PRIVATE_SPACE_ID), [model]);
  const pageIndex = Math.max(0, pages.indexOf(model.activeSpaceId));
  const pageX = useSharedValue(0);
  const showPage = (index: number, direction: number) => {
    haptic("selection");
    props.onShowSpace(pages[index]);
    // The new space's grid comes in from the side the finger went to.
    pageX.value = reduceMotion ? 0 : direction * width * 0.35;
    pageX.value = withSpring(0, { damping: 22, stiffness: 260 });
  };
  const pager = usePanGesture({
    activeOffsetX: [-16, 16],
    failOffsetY: [-12, 12],
    onUpdate: (event) => {
      "worklet";
      const edge = (event.translationX > 0 && pageIndex === 0) || (event.translationX < 0 && pageIndex === pages.length - 1);
      pageX.value = edge ? rubberBand(event.translationX, width * 0.5) : event.translationX;
    },
    onDeactivate: (event) => {
      "worklet";
      const target = pagerTarget(pageIndex, pages.length, event.translationX, event.velocityX, width);
      if (target === pageIndex) {
        pageX.value = withSpring(0, { damping: 20, stiffness: 240 });
        return;
      }
      const direction = target > pageIndex ? 1 : -1;
      pageX.value = withTiming(-direction * width * 0.6, { duration: reduceMotion ? 0 : 140 }, () => scheduleOnRN(showPage, target, direction));
    },
  });
  const pageStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: pageX.value }],
    opacity: 1 - Math.min(0.6, Math.abs(pageX.value) / (width * 1.2)),
  }));

  const chrome = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0.3, 1], [0, 1], "clamp"),
    transform: [{ translateY: interpolate(progress.value, [0, 1], [reduceMotion ? 0 : -10, 0]) }],
  }));
  const bottomChrome = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0.3, 1], [0, 1], "clamp"),
    transform: [{ translateY: interpolate(progress.value, [0, 1], [reduceMotion ? 0 : 24, 0]) }],
  }));
  const backdrop = useAnimatedStyle(() => ({ opacity: interpolate(progress.value, [0, 0.6], [0, 1], "clamp") }));

  const renderTab = (tab: MobileTab) => (
    <TabCard
      key={tab.id}
      tab={tab}
      layout={geometry.layout}
      active={tab.id === activeId}
      progress={progress}
      reduceMotion={reduceMotion}
      onPress={props.onSelect}
      onClose={props.onCloseTab}
      onLongPress={props.onTabMenu}
    />
  );

  // Short: it sits beside the + button.
  const spaceName = isPrivate ? "Privé" : (model.spaces.find((space) => space.id === model.activeSpaceId)?.name ?? "");

  return (
    <View style={StyleSheet.absoluteFill} testID="tab-overview">
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: colors.bg }, backdrop]} />

      <SpaceChips
        spaces={model.spaces}
        activeSpaceId={model.activeSpaceId}
        privateCount={privateCount}
        top={geometry.chipsTop}
        style={bottomChrome}
        onShowSpace={props.onShowSpace}
        onSpaceMenu={props.onSpaceMenu}
        onAddSpace={props.onAddSpace}
      />

      {pinned.length > 0 && (
        <Animated.View style={[styles.pinnedRow, { top: geometry.pinnedTop }, chrome]}>
          {pinned.map((tab) => (
            <PinnedTile key={tab.id} tab={tab} active={tab.id === activeId} progress={progress} onPress={props.onSelect} onLongPress={props.onTabMenu} />
          ))}
        </Animated.View>
      )}

      <GestureDetector gesture={pager}>
      <Animated.View style={[styles.grid, { top: geometry.gridTop, height: geometry.gridHeight }, pageStyle]} testID="overview-pager">
      <Animated.ScrollView
        style={StyleSheet.absoluteFill}
        contentContainerStyle={[styles.gridContent, { paddingHorizontal: geometry.layout.padding, gap: geometry.layout.gap, paddingTop: GRID_TOP, paddingBottom: 24 }]}
        contentOffset={{ x: 0, y: initialScrollY }}
        onScroll={(event) => {
          scrollY.value = event.nativeEvent.contentOffset.y;
        }}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
      >
        {showFavorites && (
          <FavoritesRow
            favorites={favorites}
            isOpen={(url) => spaceTabs.some((tab) => isFavoriteTab(url, tab.url))}
            onOpen={props.onOpenFavorite}
            onLongPress={props.onFavoriteMenu}
          />
        )}
        {groups.loose.map(renderTab)}
        {groups.folders.map(({ folder, tabs: filed }) => (
          <FolderGroup key={folder.id} folder={folder} tabs={filed} renderTab={renderTab} onToggle={props.onToggleFolder} onLongPress={props.onFolderMenu} />
        ))}
        {tabs.length === 0 && (
          <Animated.View entering={FadeIn} style={styles.empty}>
            <Icon name={isPrivate ? "mask" : "tabs"} size={36} color={colors.textFaint} />
            <Text style={[styles.emptyTitle, { color: colors.text }]}>{isPrivate ? "Aucun onglet privé" : "Aucun onglet"}</Text>
            <Text style={[styles.emptyText, { color: colors.textMuted }]}>Touchez + pour ouvrir un nouvel onglet{isPrivate ? " privé" : ""}.</Text>
          </Animated.View>
        )}
        {!isPrivate && props.onOpenRemote && <RemoteTabs onOpen={props.onOpenRemote} />}
        {!isPrivate && <ArchivedTabs onRestore={props.onRestoreArchived} onRemove={props.onRemoveArchived} onClear={props.onClearArchive} />}
      </Animated.ScrollView>
      </Animated.View>
      </GestureDetector>

      <OverviewToolbar spaceName={spaceName} style={bottomChrome} onSearch={props.onSearch} onNewTab={props.onNewTab} onDone={props.onDone} />
    </View>
  );
});

const styles = StyleSheet.create({
  pinnedRow: { position: "absolute", left: 16, right: 16, height: PINNED_HEIGHT, flexDirection: "row", gap: 14, paddingTop: 6 },
  grid: { position: "absolute", left: 0, right: 0 },
  gridContent: { flexDirection: "row", flexWrap: "wrap" },
  empty: { width: "100%", alignItems: "center", paddingTop: 80, gap: 8 },
  emptyTitle: { fontSize: 18, fontWeight: "700" },
  emptyText: { fontSize: 14 },
});

export const useOverviewWidth = () => useWindowDimensions().width;
