import * as Clipboard from "expo-clipboard";
import { applyTheme, isCurrentTheme, themePatch, THEME_GALLERY, type SharedTheme } from "@shared/theme-share";
import { memo, useMemo, useState } from "react";
import { Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View, useColorScheme } from "react-native";
import { colorsFor } from "../lib/colors";
import { currentThemeCode, importTheme, previewColors, shareMessage } from "../lib/themeShare";
import { useBrowserActions, useBrowserState } from "../state/BrowserProvider";
import { useTheme } from "../state/theme";
import { Icon, type IconName } from "./Icon";
import { QrCode } from "./SyncSettings";

/**
 * Theme gallery, export (share sheet, QR code, copy) and import (paste or QR scan) with a preview
 * card (ADR-030). The scanner is full screen, so the settings screen owns it: `onScan`, and the
 * scanned code comes back through `input`.
 */
export const ThemeSettings = memo(function ThemeSettings({
  input,
  onInput,
  onScan,
}: {
  input: string;
  onInput: (text: string) => void;
  onScan: () => void;
}) {
  const { colors, dark, haptic } = useTheme();
  const { settings } = useBrowserState();
  const actions = useBrowserActions();
  const system = useColorScheme();
  const [showQr, setShowQr] = useState(false);
  const code = useMemo(() => currentThemeCode(settings), [settings]);
  const result = useMemo(() => (input.trim() ? importTheme(input, settings) : null), [input, settings]);
  const scheme = system === "dark" || system === "light" ? system : null;

  const apply = (theme: SharedTheme) => {
    haptic("success");
    actions.updateSettings(themePatch(theme, settings));
  };

  return (
    <View style={[styles.block, { borderTopColor: colors.hairline }]}>
      <Text style={[styles.label, { color: colors.text }]}>Thèmes</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.gallery}>
        {THEME_GALLERY.map((theme) => {
          const selected = isCurrentTheme(settings, theme);
          const preview = colorsFor(applyTheme(settings, theme), scheme, null, false);
          return (
            <Pressable
              key={theme.name}
              accessibilityRole="button"
              accessibilityLabel={`Thème ${theme.name}`}
              accessibilityState={{ selected }}
              onPress={() => apply(theme)}
              style={[styles.card, { backgroundColor: preview.bg, borderColor: selected ? colors.accent : colors.hairline }]}
            >
              <View style={styles.cardSwatches}>
                <View style={[styles.dot, { backgroundColor: preview.accent }]} />
                <View style={[styles.dot, { backgroundColor: preview.accent2 }]} />
              </View>
              <View style={[styles.cardBar, { backgroundColor: preview.surfaceActive }]} />
              <Text style={[styles.cardName, { color: preview.text }]} numberOfLines={1}>
                {theme.name}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <Text style={[styles.label, { color: colors.text }]}>Partager le thème</Text>
      <View style={styles.buttons}>
        <SmallButton icon="share" label="Partager" onPress={() => void Share.share({ message: shareMessage(settings) })} />
        <SmallButton icon="qr" label={showQr ? "Masquer le QR" : "QR code"} onPress={() => setShowQr((on) => !on)} />
        <SmallButton icon="copy" label="Copier" onPress={() => void Clipboard.setStringAsync(code).then(() => haptic("success"))} />
      </View>
      {showQr && (
        <View style={styles.qr}>
          <QrCode value={code} size={180} label="QR code du thème" />
        </View>
      )}

      <Text style={[styles.label, { color: colors.text }]}>Importer un thème</Text>
      <TextInput
        value={input}
        onChangeText={onInput}
        placeholder="Collez un code browser-theme:v1:…"
        placeholderTextColor={colors.textFaint}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardAppearance={dark ? "dark" : "light"}
        style={[styles.input, { color: colors.text, backgroundColor: colors.surface }]}
        accessibilityLabel="Code de thème à importer"
      />
      <View style={styles.buttons}>
        <SmallButton icon="scan" label="Scanner un QR code" onPress={onScan} />
        <SmallButton
          icon="copy"
          label="Coller"
          onPress={() => void Clipboard.getStringAsync().then((text) => text && onInput(text.slice(0, 4096)))}
        />
      </View>
      {result && !result.ok && (
        <Text style={[styles.error, { color: colors.danger }]} accessibilityLiveRegion="polite">
          {result.error}
        </Text>
      )}
      {result?.ok && renderPreview(result.theme, () => (apply(result.theme), onInput("")), () => onInput(""))}
    </View>
  );

  function renderPreview(theme: SharedTheme, onApply: () => void, onCancel: () => void) {
    const preview = previewColors(settings, theme, scheme);
    return (
      <View style={[styles.preview, { backgroundColor: preview.bg, borderColor: colors.hairline }]} accessibilityLabel="Aperçu du thème importé">
        <Text style={[styles.previewName, { color: preview.text }]}>{theme.name || "Thème importé"}</Text>
        <View style={styles.cardSwatches}>
          <View style={[styles.dot, { backgroundColor: preview.accent }]} />
          <View style={[styles.dot, { backgroundColor: preview.accent2 }]} />
          <Text style={{ color: preview.textMuted }}>{theme.mode === "dark" ? "Sombre" : theme.mode === "light" ? "Clair" : "Auto"}</Text>
        </View>
        <View style={styles.buttons}>
          <Pressable accessibilityRole="button" onPress={onApply} style={[styles.button, { backgroundColor: preview.accent }]}>
            <Text style={[styles.buttonText, { color: preview.onAccent }]}>Appliquer</Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={onCancel} style={[styles.button, { backgroundColor: preview.surfaceActive }]}>
            <Text style={[styles.buttonText, { color: preview.text }]}>Annuler</Text>
          </Pressable>
        </View>
      </View>
    );
  }
});

function SmallButton({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.small, { backgroundColor: colors.surfaceActive, opacity: pressed ? 0.75 : 1 }]}
    >
      <Icon name={icon} size={16} color={colors.accentText} />
      <Text style={[styles.smallText, { color: colors.text }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  block: { paddingHorizontal: 16, paddingVertical: 12, gap: 10, borderTopWidth: StyleSheet.hairlineWidth },
  label: { fontSize: 16 },
  gallery: { gap: 10, paddingVertical: 2 },
  card: { width: 104, height: 76, borderRadius: 14, borderWidth: 2, padding: 8, justifyContent: "space-between" },
  cardSwatches: { flexDirection: "row", alignItems: "center", gap: 6 },
  dot: { width: 16, height: 16, borderRadius: 8 },
  cardBar: { height: 6, borderRadius: 3, width: "70%" },
  cardName: { fontSize: 13, fontWeight: "600" },
  buttons: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  small: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 44, paddingHorizontal: 12, borderRadius: 12 },
  smallText: { fontSize: 14, fontWeight: "600" },
  qr: { alignItems: "center" },
  input: { minHeight: 44, borderRadius: 12, paddingHorizontal: 12, fontSize: 13 },
  error: { fontSize: 13 },
  preview: { borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, padding: 12, gap: 10 },
  previewName: { fontSize: 16, fontWeight: "700" },
  button: { height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center", paddingHorizontal: 18 },
  buttonText: { fontSize: 15, fontWeight: "700" },
});
