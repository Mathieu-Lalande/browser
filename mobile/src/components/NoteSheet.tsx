import { memo, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import Animated from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "../state/theme";
import { Tap } from "./ui";

/** What the note sheet edits: a highlight's note, or the page's note (ADR-037, ADR-050). */
export interface NoteTarget {
  kind: "highlight" | "page";
  /** Highlight id, or the page URL. */
  id: string;
  /** The quoted passage, or the page title. */
  context: string;
  initial: string;
  maxLength: number;
}

/** Bottom sheet to write or edit a note; an empty note removes it. */
export const NoteSheet = memo(function NoteSheet({ target, onSave, onClose }: { target: NoteTarget; onSave: (text: string) => void; onClose: () => void }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [text, setText] = useState(target.initial);
  const title = target.kind === "page" ? "Note de la page" : "Note du passage";

  const save = () => {
    if (text !== target.initial) onSave(text.trim());
    onClose();
  };

  return (
    <View style={StyleSheet.absoluteFill}>
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: colors.scrim }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Annuler" />
      </Animated.View>
      <KeyboardAvoidingView behavior="padding" style={styles.avoid} pointerEvents="box-none">
        <Animated.View style={[styles.sheet, { backgroundColor: colors.bgElevated, paddingBottom: insets.bottom + 16 }]} accessibilityViewIsModal>
          <View style={[styles.grabber, { backgroundColor: colors.border }]} />
          <View style={styles.header}>
            <Text style={[styles.title, { color: colors.text }]} accessibilityRole="header">
              {title}
            </Text>
            <Tap accessibilityRole="button" accessibilityLabel="Enregistrer la note" onPress={save} style={styles.ok} pressScale={0.9}>
              <Text style={[styles.okText, { color: colors.accentText }]}>OK</Text>
            </Tap>
          </View>
          {target.context !== "" && (
            <Text style={[styles.context, { color: colors.textMuted, borderLeftColor: colors.border }]} numberOfLines={3}>
              {target.context}
            </Text>
          )}
          <TextInput
            value={text}
            onChangeText={setText}
            maxLength={target.maxLength}
            multiline
            autoFocus
            textAlignVertical="top"
            style={[styles.input, { color: colors.text, backgroundColor: colors.surface }]}
            placeholder="Écrire une note…"
            placeholderTextColor={colors.textFaint}
            accessibilityLabel={title}
          />
          {target.initial !== "" && (
            <Tap accessibilityRole="button" onPress={() => (onSave(""), onClose())} style={styles.remove}>
              <Text style={{ color: colors.danger, fontSize: 15 }}>Supprimer la note</Text>
            </Tap>
          )}
        </Animated.View>
      </KeyboardAvoidingView>
    </View>
  );
});

const styles = StyleSheet.create({
  avoid: { flex: 1, justifyContent: "flex-end" },
  sheet: { marginHorizontal: 8, marginBottom: 8, borderRadius: 28, paddingTop: 8, paddingHorizontal: 16, gap: 12 },
  grabber: { alignSelf: "center", width: 36, height: 5, borderRadius: 3 },
  header: { flexDirection: "row", alignItems: "center" },
  title: { flex: 1, fontSize: 20, fontWeight: "800" },
  ok: { minWidth: 48, height: 44, alignItems: "center", justifyContent: "center" },
  okText: { fontSize: 17, fontWeight: "700" },
  context: { fontSize: 14, lineHeight: 19, borderLeftWidth: 3, paddingLeft: 10, fontStyle: "italic" },
  input: { minHeight: 120, maxHeight: 260, borderRadius: 14, padding: 14, fontSize: 16, lineHeight: 22 },
  remove: { alignSelf: "flex-start", paddingVertical: 8 },
});
