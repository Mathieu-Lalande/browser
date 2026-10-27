import { StyleSheet, Text, View } from "react-native";
import { siteHost } from "../lib/site";
import { useTheme } from "../state/theme";
import { Icon } from "./Icon";
import { Tap } from "./ui";

/** HTTPS-Only (ADR-007): the upgraded https load failed; offer the http version explicitly. */
export function HttpsOnlyPage({ url, onContinue, onBack }: { url: string; onContinue: () => void; onBack: () => void }) {
  const { colors } = useTheme();
  return (
    <View style={[StyleSheet.absoluteFill, styles.root, { backgroundColor: colors.bg }]}>
      <View style={[styles.badge, { backgroundColor: colors.accentSoft }]}>
        <Icon name="shield" size={32} color={colors.accentText} />
      </View>
      <Text style={[styles.title, { color: colors.text }]} accessibilityRole="header">
        Connexion sécurisée indisponible
      </Text>
      <Text style={[styles.text, { color: colors.textMuted }]}>
        {siteHost(url) || url} ne prend pas en charge HTTPS. En HTTP, ce que vous voyez et saisissez sur ce site peut être lu ou modifié
        sur le réseau.
      </Text>
      <Tap accessibilityRole="button" onPress={onBack} style={[styles.primary, { backgroundColor: colors.accent }]}>
        <Text style={[styles.primaryText, { color: colors.onAccent }]}>Revenir en lieu sûr</Text>
      </Tap>
      <Tap accessibilityRole="button" onPress={onContinue} style={styles.secondary}>
        <Text style={[styles.secondaryText, { color: colors.textMuted }]}>Continuer en HTTP</Text>
      </Tap>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { alignItems: "center", justifyContent: "center", padding: 32, gap: 12 },
  badge: { width: 68, height: 68, borderRadius: 34, alignItems: "center", justifyContent: "center", marginBottom: 6 },
  title: { fontSize: 22, fontWeight: "800", textAlign: "center" },
  text: { fontSize: 15, lineHeight: 21, textAlign: "center", maxWidth: 420 },
  primary: { height: 50, borderRadius: 25, paddingHorizontal: 26, alignItems: "center", justifyContent: "center", marginTop: 12 },
  primaryText: { fontSize: 16, fontWeight: "700" },
  secondary: { height: 44, paddingHorizontal: 16, alignItems: "center", justifyContent: "center" },
  secondaryText: { fontSize: 15, fontWeight: "600", textDecorationLine: "underline" },
});
