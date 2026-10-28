import { memo, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import Animated, { FadeIn, FadeOut, SlideInDown, SlideOutDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "../state/theme";
import { Icon } from "./Icon";
import { Tap } from "./ui";

/** Bottom sheet to name a folder of the tab overview (ADR-022). */
export const FolderNameSheet = memo(function FolderNameSheet({ initial, onSave, onClose }: { initial: string; onSave: (name: string) => void; onClose: () => void }) {
  const { colors, reduceMotion } = useTheme();
  const insets = useSafeAreaInsets();
  const [name, setName] = useState(initial);

  const save = () => {
    if (name.trim() && name !== initial) onSave(name);
    onClose();
  };

  return (
    <View style={StyleSheet.absoluteFill}>
      <Animated.View entering={FadeIn.duration(160)} exiting={FadeOut.duration(120)} style={[StyleSheet.absoluteFill, { backgroundColor: colors.scrim }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Annuler" />
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
              Renommer le dossier
            </Text>
            <Tap accessibilityRole="button" onPress={save} style={styles.ok} pressScale={0.9}>
              <Text style={[styles.okText, { color: colors.accentText }]}>OK</Text>
            </Tap>
          </View>
          <View style={[styles.field, { backgroundColor: colors.surface }]}>
            <Icon name="folder" size={20} color={colors.accentText} />
            <TextInput
              value={name}
              onChangeText={setName}
              onSubmitEditing={save}
              maxLength={40}
              autoFocus
              selectTextOnFocus
              style={[styles.input, { color: colors.text }]}
              placeholder="Nom du dossier"
              placeholderTextColor={colors.textFaint}
              accessibilityLabel="Nom du dossier"
              returnKeyType="done"
            />
          </View>
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
  input: { flex: 1, fontSize: 17, height: 50 },
});
