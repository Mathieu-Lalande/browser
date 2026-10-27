import type { SpaceInfo } from "@shared/types";
import { LinearGradient } from "expo-linear-gradient";
import { memo, useMemo } from "react";
import { ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
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
import { shouldDismissCard } from "../lib/gestures";
import { cardRect, gridLayout, scrollOffsetFor, type GridLayout, type Rect } from "../lib/overviewLayout";
import { siteHue, siteLabel } from "../lib/site";
import { isPrivateTab, orderedTabs, PRIVATE_SPACE_ID, type MobileTab, type TabsModel } from "../lib/tabs";
import { useTheme } from "../state/theme";
import { Icon } from "./Icon";
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
}

export function overviewGeometry(width: number, height: number, top: number, bottom: number, hasPinned: boolean): OverviewGeometry {
  const pinnedTop = top + CHIPS_HEIGHT;
  const gridTop = pinnedTop + (hasPinned ? PINNED_HEIGHT : 0);
  return { layout: gridLayout(width, 8), gridTop, gridHeight: height - gridTop - OVERVIEW_BAR - bottom, pinnedTop };
}

/** Where the given tab sits on screen in the overview (zoom transition target). */
export function overviewTarget(geometry: OverviewGeometry, model: TabsModel, tabId: string | null, scrollY: number, width: number): Rect {
  const tabs = orderedTabs(model);
  const pinned = tabs.filter((tab) => tab.isPinned);
  const grid = tabs.filter((tab) => !tab.isPinned);
  const pinnedIndex = pinned.findIndex((tab) => tab.id === tabId);
  if (pinnedIndex !== -1) {
    return { x: 16 + pinnedIndex * (PINNED_TILE + 14), y: geometry.pinnedTop + 6, width: PINNED_TILE, height: PINNED_TILE };
  }
  const index = grid.findIndex((tab) => tab.id === tabId);
  if (index === -1) {
    return { x: width / 2 - 40, y: geometry.gridTop + geometry.gridHeight / 2 - 50, width: 80, height: 100 };
  }
  const rect = cardRect(geometry.layout, index);
  return { ...rect, y: geometry.gridTop + rect.y - scrollY };
}

export function initialScroll(geometry: OverviewGeometry, model: TabsModel, tabId: string | null, bottom: number): number {
  const grid = orderedTabs(model).filter((tab) => !tab.isPinned);
  return scrollOffsetFor(geometry.layout, grid.findIndex((tab) => tab.id === tabId), grid.length, geometry.gridHeight, bottom + 24);
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
}

/** Tab grid with spaces (chips), private tabs and pinned favorites, Arc/Safari style. */
export const TabOverview = memo(function TabOverview(props: Props) {
  const { model, activeId, geometry, progress, scrollY, initialScrollY } = props;
  const { colors, isPrivate, reduceMotion } = useTheme();
  const insets = useSafeAreaInsets();
  const tabs = useMemo(() => orderedTabs(model), [model]);
  const pinned = tabs.filter((tab) => tab.isPinned);
  const grid = tabs.filter((tab) => !tab.isPinned);
  const privateCount = useMemo(() => model.tabs.filter(isPrivateTab).length, [model.tabs]);

  const chrome = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0.3, 1], [0, 1], "clamp"),
    transform: [{ translateY: interpolate(progress.value, [0, 1], [reduceMotion ? 0 : -10, 0]) }],
  }));
  const bottomChrome = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0.3, 1], [0, 1], "clamp"),
    transform: [{ translateY: interpolate(progress.value, [0, 1], [reduceMotion ? 0 : 24, 0]) }],
  }));
  const backdrop = useAnimatedStyle(() => ({ opacity: interpolate(progress.value, [0, 0.6], [0, 1], "clamp") }));

  const spaceName = isPrivate ? "Navigation privée" : (model.spaces.find((space) => space.id === model.activeSpaceId)?.name ?? "");

  return (
    <View style={StyleSheet.absoluteFill} testID="tab-overview">
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: colors.bg }, backdrop]} />

      <Animated.View style={[styles.chipsRow, { top: insets.top }, chrome]}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          <Chip
            label={privateCount ? `Privé · ${privateCount}` : "Privé"}
            icon="mask"
            selected={isPrivate}
            onPress={() => props.onShowSpace(PRIVATE_SPACE_ID)}
          />
          <View style={[styles.chipDivider, { backgroundColor: colors.border }]} />
          {model.spaces.map((space) => (
            <Chip
              key={space.id}
              label={space.name}
              emoji={space.icon}
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

      <Animated.ScrollView
        style={[styles.grid, { top: geometry.gridTop, height: geometry.gridHeight }]}
        contentContainerStyle={[styles.gridContent, { paddingHorizontal: geometry.layout.padding, gap: geometry.layout.gap, paddingTop: geometry.layout.top, paddingBottom: 24 }]}
        contentOffset={{ x: 0, y: initialScrollY }}
        onScroll={(event) => {
          scrollY.value = event.nativeEvent.contentOffset.y;
        }}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
      >
        {grid.map((tab) => (
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
        {tabs.length === 0 && (
          <Animated.View entering={FadeIn} style={styles.empty}>
            <Icon name={isPrivate ? "mask" : "tabs"} size={36} color={colors.textFaint} />
            <Text style={[styles.emptyTitle, { color: colors.text }]}>{isPrivate ? "Aucun onglet privé" : "Aucun onglet"}</Text>
            <Text style={[styles.emptyText, { color: colors.textMuted }]}>Touchez + pour ouvrir un nouvel onglet{isPrivate ? " privé" : ""}.</Text>
          </Animated.View>
        )}
      </Animated.ScrollView>

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
          <Icon name="plus" size={26} color={colors.onAccent} strokeWidth={2.4} />
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

function Chip({
  label,
  icon,
  emoji,
  color,
  selected,
  onPress,
  onLongPress,
}: {
  label: string;
  icon?: "mask" | "plus";
  emoji?: string;
  color?: string | null;
  selected: boolean;
  onPress: () => void;
  onLongPress?: () => void;
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
      style={[
        styles.chip,
        { backgroundColor: selected ? tint : colors.surface, borderColor: selected ? tint : colors.hairline },
      ]}
    >
      {emoji ? <Text style={styles.chipEmoji}>{emoji}</Text> : icon ? <Icon name={icon} size={15} color={selected ? colors.onAccent : colors.text} strokeWidth={2.2} /> : null}
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
        accessibilityLabel={`Onglet épinglé : ${tab.title || siteLabel(tab.url)}`}
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
  const { colors, dark, haptic } = useTheme();
  const x = useSharedValue(0);
  const width = layout.cardWidth;
  const hue = siteHue(tab.url);
  const label = tab.url ? siteLabel(tab.url) : "Page d'accueil";
  const title = tab.title || label;
  const privateTab = isPrivateTab(tab);

  const close = () => {
    haptic("light");
    onClose(tab.id);
  };

  const swipe = usePanGesture({
    activeOffsetX: [-14, 14],
    failOffsetY: [-12, 12],
    onUpdate: (event) => {
      "worklet";
      x.value = event.translationX;
    },
    onDeactivate: (event) => {
      "worklet";
      if (shouldDismissCard(event.translationX, event.velocityX, width)) {
        const direction = event.translationX < 0 ? -1 : 1;
        x.value = withTiming(direction * width * 1.6, { duration: 180 }, () => scheduleOnRN(close));
      } else {
        x.value = withSpring(0, { damping: 18, stiffness: 240 });
      }
    },
  });

  const style = useAnimatedStyle(() => {
    const p = progress.value;
    return {
      opacity: (active ? interpolate(p, [0.85, 1], [0, 1], "clamp") : interpolate(p, [0.2, 1], [0, 1], "clamp")) * (1 - Math.min(1, Math.abs(x.value) / (width * 1.4))),
      transform: [{ translateX: x.value }, { scale: active || reduceMotion ? 1 : interpolate(p, [0, 1], [0.92, 1]) }, { rotateZ: `${x.value / 40}deg` }],
    };
  });

  return (
    <GestureDetector gesture={swipe}>
      <Animated.View
        layout={reduceMotion ? undefined : LinearTransition.springify().damping(20).stiffness(200)}
        exiting={FadeOut.duration(120)}
        style={[{ width, height: layout.cardHeight }, style]}
      >
        <Tap
          accessibilityRole="button"
          accessibilityLabel={`${title}${active ? ", onglet actif" : ""}`}
          accessibilityHint="Balayer sur le côté pour fermer, maintenir pour plus d'options"
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
              shadowColor: dark ? "#000" : "#3c2d78",
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
                <Icon name="close" size={12} color={colors.textMuted} strokeWidth={2.6} />
              </View>
            </Tap>
          </View>
          <View style={styles.preview}>
            {tab.url ? (
              <LinearGradient
                colors={[`hsla(${hue}, 75%, ${dark ? 45 : 62}%, ${dark ? 0.5 : 0.45})`, `hsla(${(hue + 40) % 360}, 70%, ${dark ? 30 : 80}%, ${dark ? 0.25 : 0.25})`]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={StyleSheet.absoluteFill}
              />
            ) : (
              <LinearGradient colors={[colors.accentSoft, "transparent"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
            )}
            <View style={[styles.previewIcon, { backgroundColor: dark ? "rgba(0,0,0,0.25)" : "rgba(255,255,255,0.7)" }]}>
              <SiteIcon url={tab.url} title={tab.title} size={34} offline={privateTab} />
            </View>
            <Text style={[styles.previewLabel, { color: colors.text }]} numberOfLines={1}>
              {label}
            </Text>
            {tab.isLoading && <View style={[styles.loadingDot, { backgroundColor: colors.accent }]} />}
          </View>
        </Tap>
      </Animated.View>
    </GestureDetector>
  );
});

const styles = StyleSheet.create({
  chipsRow: { position: "absolute", left: 0, right: 0, height: CHIPS_HEIGHT, justifyContent: "center" },
  chips: { paddingHorizontal: 14, gap: 8, alignItems: "center" },
  chipDivider: { width: StyleSheet.hairlineWidth * 2, height: 22, marginHorizontal: 2 },
  chip: { flexDirection: "row", alignItems: "center", gap: 6, height: 38, paddingHorizontal: 14, borderRadius: 19, borderWidth: StyleSheet.hairlineWidth },
  chipEmoji: { fontSize: 15 },
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
  preview: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10, overflow: "hidden" },
  previewIcon: { width: 60, height: 60, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  previewLabel: { fontSize: 12, fontWeight: "600", opacity: 0.75, paddingHorizontal: 10 },
  loadingDot: { position: "absolute", top: 10, right: 10, width: 7, height: 7, borderRadius: 4 },
  empty: { width: "100%", alignItems: "center", paddingTop: 80, gap: 8 },
  emptyTitle: { fontSize: 18, fontWeight: "700" },
  emptyText: { fontSize: 14 },
  bottom: { position: "absolute", left: 0, right: 0, bottom: 0, flexDirection: "row", alignItems: "center", paddingHorizontal: 10, borderTopWidth: StyleSheet.hairlineWidth },
  spaceName: { flex: 1, fontSize: 13, fontWeight: "600", textAlign: "center" },
  plus: { width: 52, height: 52, borderRadius: 26, alignItems: "center", justifyContent: "center", marginTop: -2 },
  done: { minWidth: 44, height: 44, alignItems: "center", justifyContent: "center", paddingHorizontal: 6 },
  doneText: { fontSize: 17, fontWeight: "700" },
});

export const useOverviewWidth = () => useWindowDimensions().width;
