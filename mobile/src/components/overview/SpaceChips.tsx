import type { SpaceInfo } from "@shared/types";
import { useEffect, useRef } from "react";
import { ScrollView, StyleSheet, Text, View, type ScrollViewInstance, type ViewStyle } from "react-native";
import Animated, { type AnimatedStyle } from "react-native-reanimated";
import { PRIVATE_SPACE_ID } from "../../lib/tabs";
import { useTheme } from "../../state/theme";
import { Icon, type IconName } from "../Icon";
import { Tap } from "../ui";

export const CHIPS_HEIGHT = 56;

/**
 * The spaces as chips, right above the overview's bottom bar (within thumb reach): private tabs,
 * each space (long press edits it), and "+ Espace". The selected chip scrolls into view.
 */
export function SpaceChips({
  spaces,
  activeSpaceId,
  privateCount,
  top,
  style,
  onShowSpace,
  onSpaceMenu,
  onAddSpace,
}: {
  spaces: SpaceInfo[];
  activeSpaceId: string;
  privateCount: number;
  top: number;
  /** Its entrance (fade and slide with the overview's zoom). */
  style: AnimatedStyle<ViewStyle>;
  onShowSpace: (id: string) => void;
  onSpaceMenu: (space: SpaceInfo) => void;
  onAddSpace: () => void;
}) {
  const { colors, isPrivate, reduceMotion } = useTheme();
  // The chips follow the pager: the selected one scrolls into view.
  const scroll = useRef<ScrollViewInstance>(null);
  const chipX = useRef(new Map<string, number>());
  useEffect(() => {
    const x = chipX.current.get(activeSpaceId);
    if (x !== undefined) scroll.current?.scrollTo({ x: Math.max(0, x - 48), animated: !reduceMotion });
  }, [activeSpaceId, reduceMotion]);

  return (
    <Animated.View style={[styles.chipsRow, { top, borderTopColor: colors.hairline, backgroundColor: colors.bg }, style]}>
      <ScrollView ref={scroll} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        <Chip
          onLayout={(x) => chipX.current.set(PRIVATE_SPACE_ID, x)}
          label={privateCount ? `Privé · ${privateCount}` : "Privé"}
          icon="mask"
          selected={isPrivate}
          onPress={() => onShowSpace(PRIVATE_SPACE_ID)}
        />
        <View style={[styles.chipDivider, { backgroundColor: colors.border }]} />
        {spaces.map((space) => (
          <Chip
            key={space.id}
            onLayout={(x) => chipX.current.set(space.id, x)}
            label={space.name}
            icon={space.icon}
            color={space.color}
            selected={activeSpaceId === space.id}
            onPress={() => onShowSpace(space.id)}
            onLongPress={() => onSpaceMenu(space)}
          />
        ))}
        <Chip label="Espace" icon="plus" selected={false} onPress={onAddSpace} />
      </ScrollView>
    </Animated.View>
  );
}

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
      style={[styles.chip, { backgroundColor: selected ? tint : colors.surface, borderColor: selected ? tint : colors.hairline }]}
    >
      {icon ? <Icon name={icon} size={16} color={selected ? colors.onAccent : colors.textMuted} strokeWidth={2} /> : null}
      <Text style={[styles.chipText, { color: selected ? colors.onAccent : colors.text }]} numberOfLines={1}>
        {label}
      </Text>
    </Tap>
  );
}

const styles = StyleSheet.create({
  chipsRow: { position: "absolute", left: 0, right: 0, height: CHIPS_HEIGHT, justifyContent: "center", borderTopWidth: StyleSheet.hairlineWidth },
  chips: { paddingHorizontal: 14, gap: 8, alignItems: "center" },
  chipDivider: { width: StyleSheet.hairlineWidth * 2, height: 22, marginHorizontal: 2 },
  chip: { flexDirection: "row", alignItems: "center", gap: 6, height: 38, paddingHorizontal: 14, borderRadius: 19, borderWidth: StyleSheet.hairlineWidth },
  chipText: { fontSize: 15, fontWeight: "600", maxWidth: 160 },
});
