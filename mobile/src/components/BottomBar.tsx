import { BlurView } from "expo-blur";
import { memo, useEffect } from "react";
import { Platform, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { GestureDetector, usePanGesture } from "react-native-gesture-handler";
import Animated, { interpolate, useAnimatedStyle, useSharedValue, withSpring, withTiming, type SharedValue } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { isSwipeUp, resolveHorizontalSwipe, rubberBand } from "../lib/gestures";
import { siteLabel } from "../lib/site";
import type { MobileTab } from "../lib/tabs";
import { metrics, useTheme } from "../state/theme";
import { Icon } from "./Icon";
import { IconButton, Tap } from "./ui";

export const PILL_ROW = 58;
export const TOOL_ROW = 50;
export const EXPANDED_HEIGHT = PILL_ROW + TOOL_ROW;
export const COLLAPSED_HEIGHT = metrics.collapsedBar;

interface Props {
  tab: MobileTab | null;
  tabCount: number;
  bottomInset: number;
  /** Mirrors `collapse` for touch handling (hidden rows must not catch taps). */
  collapsed: boolean;
  /** False while another screen covers the bar (it must not catch touches). */
  interactive: boolean;
  /** 0 = expanded, 1 = collapsed (driven by page scrolling). */
  collapse: SharedValue<number>;
  /** Whether swiping towards the previous / next tab is possible (rubber band otherwise). */
  canSwipe: { previous: boolean; next: boolean };
  onSwipeTab: (direction: 1 | -1) => void;
  onSwipeUp: () => void;
  onOpenSearch: () => void;
  onExpand: () => void;
  onLongPressAddress: () => void;
  /** Tap on the lock: site info sheet (ADR-021). */
  onSiteInfo: () => void;
  /** Passwords are saved for the page (ADR-025): the key button lists them to fill the form. */
  hasPasswords: boolean;
  onPasswords: () => void;
  onBack: () => void;
  onForward: () => void;
  onShare: () => void;
  onTabs: () => void;
  onTabsLongPress: () => void;
  onMenu: () => void;
  onReload: () => void;
  onStop: () => void;
}

/**
 * Bottom toolbar in the thumb zone (Safari iOS 15+ / Arc Search): the address pill above the
 * navigation buttons. Scrolling the page down collapses it into a small domain label; swiping
 * the pill sideways switches tabs, swiping it up opens the tab overview.
 */
export const BottomBar = memo(function BottomBar(props: Props) {
  const { tab, tabCount, bottomInset, collapse, canSwipe, collapsed, interactive, onSwipeTab, onSwipeUp } = props;
  const { colors, dark, isPrivate, reduceMotion, haptic } = useTheme();
  const { width } = useWindowDimensions();
  const pillX = useSharedValue(0);
  const pillY = useSharedValue(0);
  const canPrevious = useSharedValue(canSwipe.previous);
  const canNext = useSharedValue(canSwipe.next);
  useEffect(() => {
    canPrevious.value = canSwipe.previous;
    canNext.value = canSwipe.next;
  }, [canPrevious, canNext, canSwipe.previous, canSwipe.next]);

  const label = tab?.url ? siteLabel(tab.url) : "";
  const secure = tab?.url.startsWith("https:") ?? false;
  const loading = tab?.isLoading ?? false;
  const progress = tab?.progress ?? 0;

  const swipe = usePanGesture({
    activeOffsetX: [-12, 12],
    activeOffsetY: [-14, 10_000],
    onUpdate: (event) => {
      "worklet";
      const horizontal = Math.abs(event.translationX) > Math.abs(event.translationY);
      if (horizontal) {
        const blocked = event.translationX < 0 ? !canNext.value : !canPrevious.value;
        pillX.value = blocked ? rubberBand(event.translationX, width * 0.5, 0.3) : event.translationX;
        pillY.value = 0;
      } else {
        pillX.value = 0;
        pillY.value = Math.min(0, rubberBand(event.translationY, 160, 0.5));
      }
    },
    onDeactivate: (event) => {
      "worklet";
      const horizontal = Math.abs(event.translationX) > Math.abs(event.translationY);
      if (!horizontal) {
        pillY.value = withSpring(0, { damping: 18, stiffness: 260 });
        if (isSwipeUp(event.translationY, event.velocityY)) scheduleOnRN(onSwipeUp);
        pillX.value = withSpring(0);
        return;
      }
      const direction = resolveHorizontalSwipe(event.translationX, event.velocityX, width);
      const allowed = direction === 1 ? canNext.value : direction === -1 ? canPrevious.value : false;
      if (!allowed || direction === 0) {
        pillX.value = withSpring(0, { damping: 18, stiffness: 260 });
        return;
      }
      if (reduceMotion) {
        pillX.value = 0;
      } else {
        // Slide out with the finger, then come back in from the other side.
        pillX.value = withTiming(-direction * width * 0.7, { duration: 130 }, () => {
          pillX.value = direction * width * 0.5;
          pillX.value = withSpring(0, { damping: 20, stiffness: 240 });
        });
      }
      scheduleOnRN(onSwipeTab, direction);
    },
  });

  const container = useAnimatedStyle(() => ({
    height: interpolate(collapse.value, [0, 1], [EXPANDED_HEIGHT, COLLAPSED_HEIGHT]) + bottomInset,
  }));
  const pill = useAnimatedStyle(() => ({
    opacity: interpolate(collapse.value, [0, 0.6], [1, 0], "clamp"),
    transform: [
      { translateX: pillX.value },
      { translateY: pillY.value + interpolate(collapse.value, [0, 1], [0, 18]) },
      { scale: interpolate(collapse.value, [0, 1], [1, 0.82]) },
    ],
  }));
  const tools = useAnimatedStyle(() => ({
    opacity: interpolate(collapse.value, [0, 0.5], [1, 0], "clamp"),
    transform: [{ translateY: interpolate(collapse.value, [0, 1], [0, 40]) }],
  }));
  const mini = useAnimatedStyle(() => ({
    opacity: interpolate(collapse.value, [0.5, 1], [0, 1], "clamp"),
    transform: [{ translateY: interpolate(collapse.value, [0, 1], [-12, 0]) }],
  }));

  const pillBackground = isPrivate ? "rgba(255, 255, 255, 0.08)" : dark ? "rgba(255, 255, 255, 0.09)" : "rgba(255, 255, 255, 0.92)";

  return (
    <Animated.View style={[styles.root, container]} testID="bottom-bar">
      <BlurView
        intensity={Platform.OS === "ios" ? 70 : 0}
        tint={dark ? "dark" : "light"}
        style={[StyleSheet.absoluteFill, { backgroundColor: Platform.OS === "ios" ? colors.bar : colors.bgElevated }]}
      />
      <View style={[styles.hairline, { backgroundColor: colors.hairline }]} />

      {/* Collapsed: just the domain; tap to bring the toolbar back. */}
      <Animated.View style={[styles.mini, mini]} pointerEvents={collapsed && interactive ? "box-none" : "none"}>
        <Tap
          accessibilityRole="button"
          accessibilityLabel="Afficher la barre d'outils"
          onPress={props.onExpand}
          hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
          style={styles.miniTap}
          pressScale={0.97}
        >
          {secure && <Icon name="lock" size={12} color={colors.textMuted} strokeWidth={2} />}
          <Text style={[styles.miniText, { color: colors.text }]} numberOfLines={1}>
            {label || "Page d'accueil"}
          </Text>
        </Tap>
      </Animated.View>

      <View style={styles.rows} pointerEvents={collapsed || !interactive ? "none" : "box-none"}>
        <GestureDetector gesture={swipe}>
          <Animated.View style={[styles.pillRow, pill]}>
            <Tap
              accessibilityRole="search"
              accessibilityLabel={label ? `Adresse : ${label}. Toucher pour rechercher` : "Rechercher ou saisir une adresse"}
              accessibilityHint="Balayer vers la gauche ou la droite pour changer d'onglet"
              onPress={props.onOpenSearch}
              onLongPress={() => {
                haptic("medium");
                props.onLongPressAddress();
              }}
              pressScale={0.97}
              style={[
                styles.pill,
                { backgroundColor: pillBackground, borderColor: colors.hairline, shadowColor: dark ? "#000" : "#3c2d78" },
              ]}
              testID="address-pill"
            >
              {label && /^https?:/i.test(tab?.url ?? "") ? (
                <Tap
                  accessibilityRole="button"
                  accessibilityLabel={`Infos sur le site (${secure ? "connexion sécurisée" : "connexion non sécurisée"})`}
                  onPress={props.onSiteInfo}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 4 }}
                  style={styles.pillIcon}
                  testID="site-info"
                >
                  <Icon name={isPrivate ? "mask" : secure ? "lock" : "unlock"} size={16} color={isPrivate ? colors.accentText : colors.textMuted} strokeWidth={2} />
                </Tap>
              ) : (
                <View style={styles.pillIcon}>
                  <Icon
                    name={isPrivate ? "mask" : label ? (secure ? "lock" : "unlock") : "search"}
                    size={16}
                    color={isPrivate ? colors.accentText : colors.textMuted}
                    strokeWidth={2}
                  />
                </View>
              )}
              <Text style={[styles.pillText, { color: label ? colors.text : colors.textMuted }]} numberOfLines={1}>
                {label || (isPrivate ? "Recherche privée" : "Rechercher ou saisir une adresse")}
              </Text>
              {props.hasPasswords && (
                <IconButton icon="key" label="Remplir un mot de passe enregistré" size={17} color={colors.accentText} onPress={props.onPasswords} style={styles.pillAction} testID="passwords" />
              )}
              {tab?.url ? (
                <IconButton
                  icon={loading ? "close" : "reload"}
                  label={loading ? "Arrêter le chargement" : "Actualiser"}
                  size={17}
                  color={colors.textMuted}
                  onPress={loading ? props.onStop : props.onReload}
                  style={styles.pillAction}
                />
              ) : (
                <View style={styles.pillAction} />
              )}
              {loading && (
                <View style={styles.progressTrack} pointerEvents="none">
                  <View style={[styles.progress, { width: `${Math.max(8, progress * 100)}%`, backgroundColor: colors.accent }]} />
                </View>
              )}
            </Tap>
          </Animated.View>
        </GestureDetector>

        <Animated.View style={[styles.toolRow, tools]}>
          <IconButton icon="back" label="Page précédente" onPress={props.onBack} disabled={!tab?.canGoBack} size={24} />
          <IconButton icon="forward" label="Page suivante" onPress={props.onForward} disabled={!tab?.canGoForward} size={24} />
          <IconButton icon="share" label="Partager la page" onPress={props.onShare} disabled={!tab?.url} />
          <Tap
            accessibilityRole="button"
            accessibilityLabel={`Onglets (${tabCount})`}
            accessibilityHint="Maintenir pour plus d'options"
            onPress={props.onTabs}
            onLongPress={() => {
              haptic("medium");
              props.onTabsLongPress();
            }}
            pressScale={0.88}
            style={styles.tabsButton}
            testID="tabs-button"
          >
            <View style={[styles.tabsCount, { borderColor: colors.text }]}>
              <Text style={[styles.tabsCountText, { color: colors.text }]} allowFontScaling={false}>
                {tabCount > 99 ? "99+" : tabCount}
              </Text>
            </View>
          </Tap>
          <IconButton icon="more" label="Plus d'actions" onPress={props.onMenu} size={24} testID="menu-button" />
        </Animated.View>
      </View>
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  root: { position: "absolute", left: 0, right: 0, bottom: 0, overflow: "hidden" },
  hairline: { position: "absolute", top: 0, left: 0, right: 0, height: StyleSheet.hairlineWidth },
  rows: { height: EXPANDED_HEIGHT },
  pillRow: { height: PILL_ROW, paddingHorizontal: 12, paddingTop: 8, justifyContent: "center" },
  pill: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    paddingLeft: 14,
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
    overflow: "hidden",
  },
  pillIcon: { width: 20, alignItems: "center" },
  pillText: { flex: 1, textAlign: "center", fontSize: 16, fontWeight: "500", marginHorizontal: 4 },
  pillAction: { width: 44, height: 44 },
  progressTrack: { position: "absolute", left: 0, right: 0, bottom: 0, height: 2.5 },
  progress: { height: 2.5, borderRadius: 2 },
  toolRow: { height: TOOL_ROW, flexDirection: "row", alignItems: "center", justifyContent: "space-around", paddingHorizontal: 8 },
  tabsButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  tabsCount: { minWidth: 22, height: 22, borderRadius: 6, borderWidth: 2, alignItems: "center", justifyContent: "center", paddingHorizontal: 3 },
  tabsCountText: { fontSize: 12, fontWeight: "700" },
  mini: { position: "absolute", top: 0, left: 0, right: 0, height: COLLAPSED_HEIGHT, alignItems: "center", justifyContent: "center" },
  miniTap: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 24, height: COLLAPSED_HEIGHT },
  miniText: { fontSize: 13, fontWeight: "600", maxWidth: 260 },
});
