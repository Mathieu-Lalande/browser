import { SPACE_COLORS, SPACE_ICONS } from "@shared/spaces";
import type { SpaceInfo } from "@shared/types";
import { memo, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import Animated, { FadeIn, FadeOut, SlideInDown, SlideOutDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useBrowserActions, useBrowserState } from "../state/BrowserProvider";
import { useTheme } from "../state/theme";
import { Icon } from "./Icon";
import { Tap } from "./ui";

/** Bottom sheet to rename a space and pick its emoji and color (shared lists), or delete it. */
export const SpaceEditor = memo(function SpaceEditor({ space, onClose }: { space: SpaceInfo; onClose: () => void }) {
  const { colors, dark, reduceMotion, haptic } = useTheme();
  const { model } = useBrowserState();
  const actions = useBrowserActions();
  const insets = useSafeAreaInsets();
  const [name, setName] = useState(space.name);
  const current = model.spaces.find((candidate) => candidate.id === space.id) ?? space;
  const canDelete = model.spaces.length > 1;

  const save = () => {
    if (name.trim() && name !== current.name) actions.updateSpace(space.id, { name });
    onClose();
  };

  return (
    <View style={StyleSheet.absoluteFill}>
      <Animated.View entering={FadeIn.duration(160)} exiting={FadeOut.duration(120)} style={[StyleSheet.absoluteFill, { backgroundColor: colors.scrim }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={save} accessibilityLabel="Fermer" />
      </Animated.View>
      <KeyboardAvoidingView behavior="padding" style={styles.avoid} pointerEvents="box-none">
        <Animated.View
          entering={reduceMotion ? FadeIn : SlideInDown.springify().damping(22).stiffness(260)}
          exiting={reduceMotion ? FadeOut : SlideOutDown.duration(180)}
          style={[styles.sheet, { backgroundColor: colors.bgElevated, paddingBottom: insets.bottom + 16 }]}
          accessibilityViewIsModal
        >
          <View style={[styles.grabber, { backgroundColor: colors.border }]} />
          <View style={styles.header}>
            <Text style={[styles.title, { color: colors.text }]} accessibilityRole="header">
              Modifier l'espace
            </Text>
            <Tap accessibilityRole="button" onPress={save} style={styles.ok} pressScale={0.9}>
              <Text style={[styles.okText, { color: colors.accentText }]}>OK</Text>
            </Tap>
          </View>
          <View style={[styles.field, { backgroundColor: colors.surface }]}>
            <Text style={styles.fieldEmoji}>{current.icon}</Text>
            <TextInput
              value={name}
              onChangeText={setName}
              onSubmitEditing={save}
              maxLength={40}
              style={[styles.input, { color: colors.text }]}
              placeholder="Nom de l'espace"
              placeholderTextColor={colors.textFaint}
              keyboardAppearance={dark ? "dark" : "light"}
              returnKeyType="done"
              accessibilityLabel="Nom de l'espace"
            />
          </View>
          <View style={styles.grid}>
            {SPACE_ICONS.map((icon) => (
              <Tap
                key={icon}
                accessibilityRole="radio"
                accessibilityLabel={icon}
                accessibilityState={{ selected: icon === current.icon }}
                onPress={() => {
                  haptic("selection");
                  actions.updateSpace(space.id, { icon });
                }}
                pressScale={0.85}
                style={[styles.emoji, { backgroundColor: icon === current.icon ? colors.accentSoft : "transparent" }]}
              >
                <Text style={styles.emojiText}>{icon}</Text>
              </Tap>
            ))}
          </View>
          <View style={styles.colors}>
            <Tap
              accessibilityRole="radio"
              accessibilityLabel="Couleur du thème"
              accessibilityState={{ selected: current.color === null }}
              onPress={() => actions.updateSpace(space.id, { color: null })}
              pressScale={0.85}
              style={[styles.color, { borderColor: current.color === null ? colors.text : colors.border }]}
            >
              <Icon name="close" size={14} color={colors.textMuted} />
            </Tap>
            {SPACE_COLORS.map((color) => (
              <Tap
                key={color}
                accessibilityRole="radio"
                accessibilityLabel={`Couleur ${color}`}
                accessibilityState={{ selected: color === current.color }}
                onPress={() => {
                  haptic("selection");
                  actions.updateSpace(space.id, { color });
                }}
                pressScale={0.85}
                style={[styles.color, { borderColor: color === current.color ? colors.text : "transparent" }]}
              >
                <View style={[styles.colorDot, { backgroundColor: color }]} />
              </Tap>
            ))}
          </View>
          {canDelete && (
            <Pressable
              accessibilityRole="button"
              onPress={() =>
                Alert.alert(`Supprimer « ${current.name} » ?`, "Les onglets de cet espace seront fermés.", [
                  { text: "Annuler", style: "cancel" },
                  {
                    text: "Supprimer",
                    style: "destructive",
                    onPress: () => {
                      haptic("warning");
                      actions.removeSpace(space.id);
                      onClose();
                    },
                  },
                ])
              }
              style={({ pressed }) => [styles.delete, pressed && { backgroundColor: colors.surface }]}
            >
              <Icon name="trash" size={18} color={colors.danger} />
              <Text style={[styles.deleteText, { color: colors.danger }]}>Supprimer l'espace</Text>
            </Pressable>
          )}
        </Animated.View>
      </KeyboardAvoidingView>
    </View>
  );
});

const styles = StyleSheet.create({
  avoid: { flex: 1, justifyContent: "flex-end" },
  sheet: { marginHorizontal: 8, marginBottom: 8, borderRadius: 28, paddingTop: 8, paddingHorizontal: 16, gap: 14 },
  grabber: { alignSelf: "center", width: 36, height: 5, borderRadius: 3 },
  header: { flexDirection: "row", alignItems: "center" },
  title: { flex: 1, fontSize: 20, fontWeight: "800" },
  ok: { minWidth: 48, height: 44, alignItems: "center", justifyContent: "center" },
  okText: { fontSize: 17, fontWeight: "700" },
  field: { flexDirection: "row", alignItems: "center", gap: 10, height: 50, borderRadius: 14, paddingHorizontal: 14 },
  fieldEmoji: { fontSize: 22 },
  input: { flex: 1, fontSize: 17, height: 50 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 4, justifyContent: "space-between" },
  emoji: { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  emojiText: { fontSize: 24 },
  colors: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  color: { width: 36, height: 36, borderRadius: 18, borderWidth: 2.5, alignItems: "center", justifyContent: "center" },
  colorDot: { width: 26, height: 26, borderRadius: 13 },
  delete: { flexDirection: "row", alignItems: "center", gap: 10, height: 48, borderRadius: 14, paddingHorizontal: 8 },
  deleteText: { fontSize: 16, fontWeight: "600" },
});
