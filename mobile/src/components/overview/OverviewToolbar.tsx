import { StyleSheet, Text } from "react-native";
import Animated, { type AnimatedStyle } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { ViewStyle } from "react-native";
import { useTheme } from "../../state/theme";
import { Icon } from "../Icon";
import { IconButton, Tap } from "../ui";

export const OVERVIEW_BAR = 64;

/** The overview's bottom bar: search the tabs, the space's name, a big +, and "OK" back to the page. */
export function OverviewToolbar({
  spaceName,
  style,
  onSearch,
  onNewTab,
  onDone,
}: {
  /** Short: it sits beside the + button. */
  spaceName: string;
  /** Its entrance (fade and slide with the overview's zoom). */
  style: AnimatedStyle<ViewStyle>;
  onSearch: () => void;
  onNewTab: () => void;
  onDone: () => void;
}) {
  const { colors, isPrivate } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Animated.View style={[styles.bottom, { height: OVERVIEW_BAR + insets.bottom, paddingBottom: insets.bottom, borderTopColor: colors.hairline, backgroundColor: colors.bgElevated }, style]}>
      <IconButton icon="search" label="Rechercher dans les onglets" onPress={onSearch} />
      <Text style={[styles.spaceName, { color: colors.textMuted }]} numberOfLines={1}>
        {spaceName}
      </Text>
      <Tap
        accessibilityRole="button"
        accessibilityLabel={isPrivate ? "Nouvel onglet privé" : "Nouvel onglet"}
        onPress={onNewTab}
        pressScale={0.88}
        style={[styles.plus, { backgroundColor: colors.accent }]}
        testID="overview-new-tab"
      >
        <Icon name="plus" size={24} color={colors.onAccent} strokeWidth={2} />
      </Tap>
      {/* Same width as the name on the left: the + stays centered. */}
      <Text style={[styles.spaceName, { color: "transparent" }]} numberOfLines={1}>
        {spaceName}
      </Text>
      <Tap accessibilityRole="button" onPress={onDone} pressScale={0.9} style={styles.done}>
        <Text style={[styles.doneText, { color: colors.accentText }]}>OK</Text>
      </Tap>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  bottom: { position: "absolute", left: 0, right: 0, bottom: 0, flexDirection: "row", alignItems: "center", paddingHorizontal: 10, borderTopWidth: StyleSheet.hairlineWidth },
  spaceName: { flex: 1, fontSize: 13, fontWeight: "600", textAlign: "center" },
  plus: { width: 52, height: 52, borderRadius: 26, alignItems: "center", justifyContent: "center", marginTop: -2 },
  done: { minWidth: 44, height: 44, alignItems: "center", justifyContent: "center", paddingHorizontal: 6 },
  doneText: { fontSize: 17, fontWeight: "700" },
});
