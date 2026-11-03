import { memo } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, { interpolate, useAnimatedStyle, type SharedValue } from "react-native-reanimated";
import type { GridLayout } from "../../lib/overviewLayout";
import { siteLabel } from "../../lib/site";
import { isPrivateTab, type MobileTab } from "../../lib/tabs";
import { useTheme } from "../../state/theme";
import { Icon } from "../Icon";
import { SiteIcon, Tap } from "../ui";

export const PINNED_TILE = 56;

/** A tab of the overview grid: tap shows it, long press opens its menu, the × closes it. */
export const TabCard = memo(function TabCard({
  tab,
  layout,
  active,
  progress,
  onPress,
  onClose,
  onLongPress,
}: {
  tab: MobileTab;
  layout: GridLayout;
  active: boolean;
  progress: SharedValue<number>;
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
    };
  });

  return (
    <>
      {/* No layout/exiting animation and no scale pop-in (`lib/motion`): cards move and leave at once. */}
      <Animated.View style={{ width, height: layout.cardHeight }}>
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

/** A pinned tab, as a tile above the grid. */
export const PinnedTile = memo(function PinnedTile({
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

const styles = StyleSheet.create({
  pinned: { width: PINNED_TILE, height: PINNED_TILE, borderRadius: 18, alignItems: "center", justifyContent: "center" },
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
});
