import { memo } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated from "react-native-reanimated";
import { useTheme } from "../state/theme";
import { Icon } from "./Icon";
import { IconButton } from "./ui";

interface Props {
  title: string;
  subtitle: string;
  playing: boolean;
  onToggle: () => void;
  onClose: () => void;
}

/** "Pause des médias" on the phone (ADR-035): a bar above the toolbar while the page has media. */
export const MiniBar = memo(function MiniBar({ title, subtitle, playing, onToggle, onClose }: Props) {
  const { colors } = useTheme();
  return (
    <Animated.View
      style={[styles.bar, { backgroundColor: colors.bgElevated, borderColor: colors.hairline }]}
      accessibilityLabel="Lecture en cours"
      testID="mini-bar"
    >
      <View style={[styles.art, { backgroundColor: colors.surface }]}>
        <Icon name="audio-lines" size={18} color={colors.textMuted} />
      </View>
      <View style={styles.labels}>
        <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>
          {title}
        </Text>
        <Text style={[styles.subtitle, { color: colors.textMuted }]} numberOfLines={1}>
          {subtitle}
        </Text>
      </View>
      <IconButton icon={playing ? "pause" : "play"} label={playing ? "Mettre en pause" : "Lire"} size={22} onPress={onToggle} />
      <IconButton icon="close" label="Fermer le lecteur" size={20} color={colors.textMuted} onPress={onClose} />
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: 12,
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
  },
  art: { width: 36, height: 36, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  labels: { flex: 1, minWidth: 0 },
  title: { fontSize: 14, fontWeight: "600" },
  subtitle: { fontSize: 12 },
});
