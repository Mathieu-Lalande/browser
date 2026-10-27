import { StyleSheet, Text, View } from "react-native";
import { useTheme } from "../state/theme";
import { Icon } from "./Icon";
import { Tap } from "./ui";

/** Shown by the WebView when a page cannot load (offline, unknown host…). */
export function LoadError({ code, description, onRetry }: { code: number; description: string; onRetry: () => void }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.root, { backgroundColor: colors.bg }]}>
      <View style={[styles.badge, { backgroundColor: colors.surfaceActive }]}>
        <Icon name="globe" size={32} color={colors.textMuted} />
      </View>
      <Text style={[styles.title, { color: colors.text }]}>Impossible d'ouvrir la page</Text>
      <Text style={[styles.detail, { color: colors.textMuted }]}>
        Vérifiez votre connexion ou l'adresse saisie.{"\n"}
        <Text style={{ color: colors.textFaint }}>
          {description} ({code})
        </Text>
      </Text>
      <Tap accessibilityRole="button" onPress={onRetry} style={[styles.button, { backgroundColor: colors.accent }]}>
        <Icon name="reload" size={20} color={colors.onAccent} />
        <Text style={[styles.buttonText, { color: colors.onAccent }]}>Réessayer</Text>
      </Tap>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center", padding: 32, gap: 12 },
  badge: { width: 64, height: 64, borderRadius: 32, alignItems: "center", justifyContent: "center", marginBottom: 4 },
  title: { fontSize: 20, fontWeight: "700", textAlign: "center" },
  detail: { fontSize: 15, lineHeight: 21, textAlign: "center" },
  button: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 20, height: 46, borderRadius: 23, marginTop: 8 },
  buttonText: { fontSize: 16, fontWeight: "600" },
});
