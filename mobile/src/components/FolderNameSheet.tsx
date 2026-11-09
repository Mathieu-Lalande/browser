import { t } from "@shared/i18n";
import { memo, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import Animated from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "../state/theme";
import { Icon } from "./Icon";
import { Tap } from "./ui";

/** Bottom sheet to name a folder of the tab overview (ADR-022). */
export const FolderNameSheet = memo(function FolderNameSheet({ initial, onSave, onClose }: { initial: string; onSave: (name: string) => void; onClose: () => void }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [name, setName] = useState(initial);

  const save = () => {
    if (name.trim() && name !== initial) onSave(name);
    onClose();
  };

  return (
    <View style={StyleSheet.absoluteFill}>
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: colors.scrim }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel={t("mobile.folderNameSheet.cancel")} />
      </Animated.View>
      <KeyboardAvoidingView behavior="padding" style={styles.avoid} pointerEvents="box-none">
        <Animated.View
          style={[styles.sheet, { backgroundColor: colors.bgElevated, paddingBottom: insets.bottom + 16 }]}
          accessibilityViewIsModal
        >
          <View style={[styles.grabber, { backgroundColor: colors.border }]} />
          <View style={styles.header}>
            <Text style={[styles.title, { color: colors.text }]} accessibilityRole="header">
              {t("mobile.folderNameSheet.renameFolder")}
            </Text>
            <Tap accessibilityRole="button" onPress={save} style={styles.ok} pressScale={0.9}>
              <Text style={[styles.okText, { color: colors.accentText }]}>{t("mobile.folderNameSheet.ok")}</Text>
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
              placeholder={t("mobile.folderNameSheet.folderName")}
              placeholderTextColor={colors.textFaint}
              accessibilityLabel={t("mobile.folderNameSheet.folderName")}
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
