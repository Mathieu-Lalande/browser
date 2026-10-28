import { isFavoriteTab, type Favorite } from "@shared/favorites";
import type { SpaceInfo } from "@shared/types";
import { memo, useEffect, useMemo, useRef } from "react";
import { ScrollView, StyleSheet, Text, View, useWindowDimensions, type ScrollViewInstance } from "react-native";
import { GestureDetector, usePanGesture } from "react-native-gesture-handler";
import Animated, {
  FadeIn,
  FadeOut,
  interpolate,
  LinearTransition,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { scheduleOnRN } from "react-native-worklets";
import { pagerTarget, rubberBand } from "../lib/gestures";
import { pagerPages } from "../lib/organize";
import { FOLDER_HEADER, gridLayout, scrollOffsetForRect, sectionedGrid, type GridLayout, type GridSection, type Rect } from "../lib/overviewLayout";
import { siteLabel } from "../lib/site";
import { isPrivateTab, orderedTabs, overviewGroups, PRIVATE_SPACE_ID, type MobileFolder, type MobileTab, type TabsModel } from "../lib/tabs";
import { useBrowserState } from "../state/BrowserProvider";
import { useTheme } from "../state/theme";
import { Icon, type IconName } from "./Icon";
import { ArchivedTabs, FAVORITES_ROW, FavoritesRow } from "./Organize";
import { RemoteTabs } from "./RemoteTabs";
import { IconButton, SiteIcon, Tap } from "./ui";

export const CHIPS_HEIGHT = 56;
export const PINNED_HEIGHT = 84;
export const OVERVIEW_BAR = 64;
const PINNED_TILE = 56;

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
  const insets = useSafeAreaInsets();
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

  // The chips follow the pager: the selected one scrolls into view.
  const chipsScroll = useRef<ScrollViewInstance>(null);
  const chipX = useRef(new Map<string, number>());
  useEffect(() => {
    const x = chipX.current.get(model.activeSpaceId);
    if (x !== undefined) chipsScroll.current?.scrollTo({ x: Math.max(0, x - 48), animated: !reduceMotion });
  }, [model.activeSpaceId, reduceMotion]);

  const chrome = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0.3, 1], [0, 1], "clamp"),
    transform: [{ translateY: interpolate(progress.value, [0, 1], [reduceMotion ? 0 : -10, 0]) }],
  }));
  const bottomChrome = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0.3, 1], [0, 1], "clamp"),
    transform: [{ translateY: interpolate(progress.value, [0, 1], [reduceMotion ? 0 : 24, 0]) }],
  }));
  const backdrop = useAnimatedStyle(() => ({ opacity: interpolate(progress.value, [0, 0.6], [0, 1], "clamp") }));

  // Short: it sits beside the + button.
  const spaceName = isPrivate ? "Privé" : (model.spaces.find((space) => space.id === model.activeSpaceId)?.name ?? "");

  return (
    <View style={StyleSheet.absoluteFill} testID="tab-overview">
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: colors.bg }, backdrop]} />

      {/* Spaces right above the bottom bar: within thumb reach. */}
      <Animated.View style={[styles.chipsRow, { top: geometry.chipsTop, borderTopColor: colors.hairline, backgroundColor: colors.bg }, bottomChrome]}>
        <ScrollView ref={chipsScroll} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          <Chip
            onLayout={(x) => chipX.current.set(PRIVATE_SPACE_ID, x)}
            label={privateCount ? `Privé · ${privateCount}` : "Privé"}
            icon="mask"
            selected={isPrivate}
            onPress={() => props.onShowSpace(PRIVATE_SPACE_ID)}
          />
          <View style={[styles.chipDivider, { backgroundColor: colors.border }]} />
          {model.spaces.map((space) => (
            <Chip
              key={space.id}
              onLayout={(x) => chipX.current.set(space.id, x)}
              label={space.name}
              icon={space.icon}
              color={space.color}
              selected={model.activeSpaceId === space.id}
              onPress={() => props.onShowSpace(space.id)}
              onLongPress={() => props.onSpaceMenu(space)}
            />
          ))}
          <Chip label="Espace" icon="plus" selected={false} onPress={props.onAddSpace} />
        </ScrollView>
      </Animated.View>

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
        {groups.loose.map((tab) => (
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
        ))}
        {groups.folders.map(({ folder, tabs: filed }) => [
          <FolderHeader key={`folder-${folder.id}`} folder={folder} count={filed.length} onToggle={props.onToggleFolder} onLongPress={props.onFolderMenu} />,
          ...(folder.collapsed
            ? []
            : filed.map((tab) => (
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
              ))),
        ])}
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

      <Animated.View style={[styles.bottom, { height: OVERVIEW_BAR + insets.bottom, paddingBottom: insets.bottom, borderTopColor: colors.hairline, backgroundColor: colors.bgElevated }, bottomChrome]}>
        <IconButton icon="search" label="Rechercher dans les onglets" onPress={props.onSearch} />
        <Text style={[styles.spaceName, { color: colors.textMuted }]} numberOfLines={1}>
          {spaceName}
        </Text>
        <Tap
          accessibilityRole="button"
          accessibilityLabel={isPrivate ? "Nouvel onglet privé" : "Nouvel onglet"}
          onPress={props.onNewTab}
          pressScale={0.88}
          style={[styles.plus, { backgroundColor: colors.accent }]}
          testID="overview-new-tab"
        >
          <Icon name="plus" size={24} color={colors.onAccent} strokeWidth={2} />
        </Tap>
        <Text style={[styles.spaceName, { color: "transparent" }]} numberOfLines={1}>
          {spaceName}
        </Text>
        <Tap accessibilityRole="button" onPress={props.onDone} pressScale={0.9} style={styles.done}>
          <Text style={[styles.doneText, { color: colors.accentText }]}>OK</Text>
        </Tap>
      </Animated.View>
    </View>
  );
});

/** A folder of the grid (ADR-022): a full-width header; tap folds it, long press opens its menu. */
const FolderHeader = memo(function FolderHeader({
  folder,
  count,
  onToggle,
  onLongPress,
}: {
  folder: MobileFolder;
  count: number;
  onToggle: (id: string) => void;
  onLongPress: (folder: MobileFolder) => void;
}) {
  const { colors, haptic } = useTheme();
  return (
    <Tap
      accessibilityRole="button"
      accessibilityState={{ expanded: !folder.collapsed }}
      accessibilityLabel={`Dossier ${folder.name}, ${count} onglet${count > 1 ? "s" : ""}`}
      accessibilityHint="Toucher pour replier ou déplier, maintenir pour plus d'options"
      onPress={() => {
        haptic("selection");
        onToggle(folder.id);
      }}
      onLongPress={() => {
        haptic("medium");
        onLongPress(folder);
      }}
      pressScale={0.98}
      style={[styles.folder, { backgroundColor: colors.surface, borderColor: colors.hairline }]}
      testID={`folder-${folder.id}`}
    >
      <View style={{ transform: [{ rotate: folder.collapsed ? "0deg" : "90deg" }] }}>
        <Icon name="forward" size={16} color={colors.textMuted} strokeWidth={2.2} />
      </View>
      <Icon name="folder" size={18} color={colors.accentText} />
      <Text style={[styles.folderName, { color: colors.text }]} numberOfLines={1}>
        {folder.name}
      </Text>
      <Text style={[styles.folderCount, { color: colors.textMuted }]}>{count}</Text>
    </Tap>
  );
});

function Chip({
  label,
  icon,
  color,
  selected,
  onPress,
  onLongPress,
  onLayout,
}: {
  label: string;
  icon?: IconName;
  color?: string | null;
  selected: boolean;
  onPress: () => void;
  onLongPress?: () => void;
  onLayout?: (x: number) => void;
}) {
  const { colors, haptic } = useTheme();
  const tint = color ?? colors.accent;
  return (
    <Tap
      accessibilityRole="tab"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      accessibilityHint={onLongPress ? "Maintenir pour modifier l'espace" : undefined}
      onPress={() => {
        haptic("selection");
        onPress();
      }}
      onLongPress={
        onLongPress &&
        (() => {
          haptic("medium");
          onLongPress();
        })
      }
      pressScale={0.92}
      onLayout={onLayout && ((event) => onLayout(event.nativeEvent.layout.x))}
      hitSlop={{ top: 6, bottom: 6, left: 2, right: 2 }}
      style={[
        styles.chip,
        { backgroundColor: selected ? tint : colors.surface, borderColor: selected ? tint : colors.hairline },
      ]}
    >
      {icon ? <Icon name={icon} size={16} color={selected ? colors.onAccent : colors.textMuted} strokeWidth={2} /> : null}
      <Text style={[styles.chipText, { color: selected ? colors.onAccent : colors.text }]} numberOfLines={1}>
        {label}
      </Text>
    </Tap>
  );
}

const PinnedTile = memo(function PinnedTile({
  tab,
  active,
  progress,
  onPress,
  onLongPress,
}: {
  tab: MobileTab;
  active: boolean;
  progress: SharedValue<number>;
  onPress: (id: string) => void;
  onLongPress: (tab: MobileTab) => void;
}) {
  const { colors } = useTheme();
  const style = useAnimatedStyle(() => ({ opacity: active ? interpolate(progress.value, [0.85, 1], [0, 1], "clamp") : 1 }));
  return (
    <Animated.View style={style}>
      <Tap
        accessibilityRole="button"
        accessibilityLabel={`Onglet épinglé : ${tab.title || siteLabel(tab.url)}`}
        onPress={() => onPress(tab.id)}
        onLongPress={() => onLongPress(tab)}
        pressScale={0.9}
        style={[
          styles.pinned,
          { backgroundColor: colors.bgElevated, borderColor: active ? colors.accent : colors.hairline, borderWidth: active ? 2.5 : StyleSheet.hairlineWidth },
        ]}
      >
        <SiteIcon url={tab.url} title={tab.title} size={28} offline={isPrivateTab(tab)} />
      </Tap>
    </Animated.View>
  );
});

const TabCard = memo(function TabCard({
  tab,
  layout,
  active,
  progress,
  reduceMotion,
  onPress,
  onClose,
  onLongPress,
}: {
  tab: MobileTab;
  layout: GridLayout;
  active: boolean;
  progress: SharedValue<number>;
  reduceMotion: boolean;
  onPress: (id: string) => void;
  onClose: (id: string) => void;
  onLongPress: (tab: MobileTab) => void;
}) {
  const { colors, haptic } = useTheme();
  const width = layout.cardWidth;
  const label = tab.url ? siteLabel(tab.url) : "Page d'accueil";
  const title = tab.title || label;
  const privateTab = isPrivateTab(tab);

  const close = () => {
    haptic("light");
    onClose(tab.id);
  };

  // Horizontal swipes belong to the pager between spaces (ADR-022): a card closes with its button,
  // its long-press menu or the accessibility action.
  const style = useAnimatedStyle(() => {
    const p = progress.value;
    return {
      opacity: active ? interpolate(p, [0.85, 1], [0, 1], "clamp") : interpolate(p, [0.2, 1], [0, 1], "clamp"),
      transform: [{ scale: active || reduceMotion ? 1 : interpolate(p, [0, 1], [0.92, 1]) }],
    };
  });

  return (
    <>
      {/* Layout animations on the wrapper, animated opacity/transform on the child: Reanimated
          warns (and the layout animation wins) when both target the same view. */}
      <Animated.View
        layout={reduceMotion ? undefined : LinearTransition.springify().damping(20).stiffness(200)}
        exiting={FadeOut.duration(120)}
        style={{ width, height: layout.cardHeight }}
      >
        <Animated.View style={[{ flex: 1 }, style]}>
          <Tap
            accessibilityRole="button"
            accessibilityLabel={`${title}${active ? ", onglet actif" : ""}`}
            accessibilityHint="Maintenir pour plus d'options"
            accessibilityActions={[{ name: "close", label: "Fermer l'onglet" }]}
            onAccessibilityAction={(event) => event.nativeEvent.actionName === "close" && close()}
            onPress={() => onPress(tab.id)}
            onLongPress={() => {
              haptic("medium");
              onLongPress(tab);
            }}
            pressScale={0.96}
            style={[
              styles.card,
              {
                backgroundColor: colors.bgElevated,
                borderColor: active ? colors.accent : colors.hairline,
                borderWidth: active ? 2.5 : StyleSheet.hairlineWidth,
                shadowColor: "#000",
              },
            ]}
          >
            <View style={styles.cardHeader}>
              <SiteIcon url={tab.url} title={tab.title} size={18} offline={privateTab} radius={5} />
              <Text style={[styles.cardTitle, { color: colors.text }]} numberOfLines={1}>
                {title}
              </Text>
              <Tap accessibilityRole="button" accessibilityLabel="Fermer l'onglet" onPress={close} hitSlop={8} pressScale={0.8} style={styles.cardClose}>
                <View style={[styles.cardCloseDot, { backgroundColor: colors.surfaceActive }]}>
                  <Icon name="close" size={12} color={colors.textMuted} strokeWidth={2} />
                </View>
              </Tap>
            </View>
            <View style={[styles.preview, { backgroundColor: colors.surface, borderTopColor: colors.hairline }]}>
              <View style={[styles.previewIcon, { backgroundColor: colors.bgElevated, borderColor: colors.hairline }]}>
                <SiteIcon url={tab.url} title={tab.title} size={32} offline={privateTab} plain />
              </View>
              <Text style={[styles.previewLabel, { color: colors.text }]} numberOfLines={1}>
                {label}
              </Text>
              {tab.isLoading && <View style={[styles.loadingDot, { backgroundColor: colors.accent }]} />}
            </View>
          </Tap>
        </Animated.View>
      </Animated.View>
    </>
  );
});

const styles = StyleSheet.create({
  chipsRow: { position: "absolute", left: 0, right: 0, height: CHIPS_HEIGHT, justifyContent: "center", borderTopWidth: StyleSheet.hairlineWidth },
  chips: { paddingHorizontal: 14, gap: 8, alignItems: "center" },
  chipDivider: { width: StyleSheet.hairlineWidth * 2, height: 22, marginHorizontal: 2 },
  chip: { flexDirection: "row", alignItems: "center", gap: 6, height: 38, paddingHorizontal: 14, borderRadius: 19, borderWidth: StyleSheet.hairlineWidth },
  chipText: { fontSize: 15, fontWeight: "600", maxWidth: 160 },
  pinnedRow: { position: "absolute", left: 16, right: 16, height: PINNED_HEIGHT, flexDirection: "row", gap: 14, paddingTop: 6 },
  pinned: { width: PINNED_TILE, height: PINNED_TILE, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  grid: { position: "absolute", left: 0, right: 0 },
  gridContent: { flexDirection: "row", flexWrap: "wrap" },
  card: {
    flex: 1,
    borderRadius: 20,
    overflow: "hidden",
    shadowOpacity: 0.12,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
  },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 7, paddingLeft: 10, paddingRight: 4, height: 38 },
  cardTitle: { flex: 1, fontSize: 13, fontWeight: "600" },
  cardClose: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  cardCloseDot: { width: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  preview: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, overflow: "hidden", borderTopWidth: StyleSheet.hairlineWidth },
  previewIcon: { width: 60, height: 60, borderRadius: 16, alignItems: "center", justifyContent: "center", borderWidth: StyleSheet.hairlineWidth },
  previewLabel: { fontSize: 12, fontWeight: "600", opacity: 0.75, paddingHorizontal: 10 },
  loadingDot: { position: "absolute", top: 10, right: 10, width: 7, height: 7, borderRadius: 4 },
  empty: { width: "100%", alignItems: "center", paddingTop: 80, gap: 8 },
  folder: {
    width: "100%",
    height: FOLDER_HEADER,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  folderName: { flex: 1, fontSize: 15, fontWeight: "700" },
  folderCount: { fontSize: 13, fontWeight: "600" },
  emptyTitle: { fontSize: 18, fontWeight: "700" },
  emptyText: { fontSize: 14 },
  bottom: { position: "absolute", left: 0, right: 0, bottom: 0, flexDirection: "row", alignItems: "center", paddingHorizontal: 10, borderTopWidth: StyleSheet.hairlineWidth },
  spaceName: { flex: 1, fontSize: 13, fontWeight: "600", textAlign: "center" },
  plus: { width: 52, height: 52, borderRadius: 26, alignItems: "center", justifyContent: "center", marginTop: -2 },
  done: { minWidth: 44, height: 44, alignItems: "center", justifyContent: "center", paddingHorizontal: 6 },
  doneText: { fontSize: 17, fontWeight: "700" },
});

export const useOverviewWidth = () => useWindowDimensions().width;
