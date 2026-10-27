import * as Clipboard from "expo-clipboard";
import { memo, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import Svg, { Path, Rect } from "react-native-svg";
import { encode } from "uqr";
import { useBrowserActions, useBrowserState, type SyncResult } from "../state/BrowserProvider";
import { useTheme } from "../state/theme";
import { Icon, type IconName } from "./Icon";

/**
 * Sync settings on the phone (ADR-019), mirroring the desktop: pair by scanning the desktop's QR
 * code (or pasting the code), or create the account here; then status, other devices, pairing
 * code on request (behind a warning), disconnect and reset.
 */
export const SyncSettings = memo(function SyncSettings({ onScan }: { onScan: () => void }) {
  const { colors, dark, haptic } = useTheme();
  const { sync, model } = useBrowserState();
  const actions = useBrowserActions();
  const [serverUrl, setServerUrl] = useState("");
  const [secret, setSecret] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const isPrivate = model.activeSpaceId === "private";

  const run = async (action: () => Promise<SyncResult>, success?: string) => {
    setBusy(true);
    const result = await action();
    setBusy(false);
    if (!result.ok) Alert.alert("Synchronisation", result.message);
    else if (success) {
      haptic("success");
      Alert.alert("Synchronisation", success);
    }
    return result.ok;
  };

  const confirm = (title: string, message: string, action: string, onConfirm: () => void) =>
    Alert.alert(title, message, [
      { text: "Annuler", style: "cancel" },
      { text: action, style: "destructive", onPress: onConfirm },
    ]);

  const input = [styles.input, { color: colors.text, backgroundColor: dark ? "rgba(255,255,255,0.08)" : "rgba(20,16,40,0.06)" }];

  if (!sync?.configured) {
    return (
      <>
        <Info
          first
          icon="cloudOff"
          label="Synchroniser avec votre ordinateur"
          detail="Favoris, historique récent, onglets ouverts, espaces et thème. Chiffré sur l'appareil : votre serveur ne voit que des données illisibles."
        />
        <Action icon="scan" label="Scanner le code de jumelage" onPress={onScan} disabled={isPrivate} />
        <View style={[styles.block, { borderTopColor: colors.hairline }]}>
          <Text style={[styles.label, { color: colors.text }]}>Ou collez le code</Text>
          <TextInput
            value={code}
            onChangeText={setCode}
            placeholder="browser-sync:1:…"
            placeholderTextColor={colors.textFaint}
            autoCapitalize="none"
            autoCorrect={false}
            style={input}
            accessibilityLabel="Code de jumelage"
            keyboardAppearance={dark ? "dark" : "light"}
          />
          <Button label="Jumeler" disabled={busy || !code.trim() || isPrivate} onPress={() => void run(() => actions.sync.pair(code.trim()), "Appareil jumelé.").then((ok) => ok && setCode(""))} />
        </View>
        <View style={[styles.block, { borderTopColor: colors.hairline }]}>
          <Text style={[styles.label, { color: colors.text }]}>Premier appareil</Text>
          <Text style={[styles.detail, { color: colors.textMuted }]}>Adresse de votre serveur de synchronisation (https). Une nouvelle clé est créée ici.</Text>
          <TextInput
            value={serverUrl}
            onChangeText={setServerUrl}
            placeholder="https://sync.exemple.fr"
            placeholderTextColor={colors.textFaint}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            style={input}
            accessibilityLabel="Adresse du serveur de synchronisation"
            keyboardAppearance={dark ? "dark" : "light"}
          />
          <TextInput
            value={secret}
            onChangeText={setSecret}
            placeholder="Code d'inscription (facultatif)"
            placeholderTextColor={colors.textFaint}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            style={input}
            accessibilityLabel="Code d'inscription du serveur"
            keyboardAppearance={dark ? "dark" : "light"}
          />
          <Button
            label="Activer la synchronisation"
            disabled={busy || !serverUrl.trim() || isPrivate}
            onPress={() => void run(() => actions.sync.createAccount(serverUrl.trim(), secret.trim() || undefined), "Synchronisation activée.")}
          />
        </View>
        {busy && <ActivityIndicator style={styles.spinner} color={colors.accent} />}
      </>
    );
  }

  const status =
    sync.phase === "syncing"
      ? "Synchronisation en cours…"
      : sync.phase === "offline"
        ? "Serveur injoignable, nouvel essai automatique."
        : sync.phase === "error"
          ? (sync.error?.message ?? "Erreur de synchronisation.")
          : `Synchronisé ${ago(sync.lastSync)}.`;

  return (
    <>
      <Info first icon={sync.phase === "offline" || sync.phase === "error" ? "cloudOff" : "cloud"} label={status} detail={`${sync.deviceName} · ${sync.serverUrl?.replace(/^https?:\/\//, "")} · clé ${sync.keyFingerprint}`} />
      <Action icon="reload" label="Synchroniser maintenant" onPress={() => actions.sync.syncNow()} disabled={sync.phase === "syncing"} />
      {sync.devices.map((device) => (
        <Info
          key={device.id}
          icon={device.kind === "mobile" ? "smartphone" : "laptop"}
          label={device.name}
          detail={`${device.tabs.length} onglet${device.tabs.length > 1 ? "s" : ""} ouvert${device.tabs.length > 1 ? "s" : ""} · ${ago(device.updatedAt)}`}
        />
      ))}
      {pairingCode ? (
        <View style={[styles.block, { borderTopColor: colors.hairline, alignItems: "center" }]}>
          <QrCode value={pairingCode} size={220} />
          <Text selectable style={[styles.code, { color: colors.textMuted }]}>
            {pairingCode}
          </Text>
          <View style={styles.buttons}>
            <Button label="Copier" secondary onPress={() => void Clipboard.setStringAsync(pairingCode)} />
            <Button label="Masquer" secondary onPress={() => setPairingCode(null)} />
          </View>
        </View>
      ) : (
        <Action
          icon="qr"
          label="Afficher le code de jumelage"
          disabled={isPrivate}
          onPress={() =>
            confirm(
              "Afficher le code de jumelage ?",
              "Ce code donne un accès complet à vos données synchronisées à quiconque le voit. Ne le montrez à personne et ne l'envoyez pas.",
              "Afficher",
              () => setPairingCode(actions.sync.pairingCode()),
            )
          }
        />
      )}
      <Action
        icon="unlink"
        label="Déconnecter cet appareil"
        destructive
        disabled={busy || isPrivate}
        onPress={() =>
          confirm("Déconnecter cet appareil ?", "La synchronisation s'arrête ici. Les données restent sur le téléphone.", "Déconnecter", () => {
            setPairingCode(null);
            void run(() => actions.sync.disconnect());
          })
        }
      />
      <Action
        icon="key"
        label="Réinitialiser la synchronisation"
        destructive
        disabled={busy || isPrivate}
        onPress={() =>
          confirm(
            "Réinitialiser la synchronisation ?",
            "Toutes les données du serveur sont effacées et une nouvelle clé est créée. Vos autres appareils devront être jumelés à nouveau.",
            "Réinitialiser",
            () => {
              setPairingCode(null);
              void run(() => actions.sync.reset(), "Synchronisation réinitialisée avec une nouvelle clé.");
            },
          )
        }
      />
    </>
  );
});

function ago(time: number | null): string {
  if (!time) return "jamais";
  const minutes = Math.round((Date.now() - time) / 60_000);
  if (minutes < 1) return "à l'instant";
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `il y a ${hours} h`;
  return new Date(time).toLocaleDateString("fr-FR", { day: "numeric", month: "long" });
}

/** QR code drawn locally with react-native-svg (uqr, pure JS). */
export const QrCode = memo(function QrCode({ value, size }: { value: string; size: number }) {
  const qr = useMemo(() => encode(value, { ecc: "M", border: 2 }), [value]);
  const path = useMemo(() => qr.data.flatMap((row, y) => row.map((on, x) => (on ? `M${x} ${y}h1v1h-1z` : ""))).join(""), [qr]);
  return (
    <View accessible accessibilityLabel="QR code de jumelage" style={styles.qr}>
      <Svg width={size} height={size} viewBox={`0 0 ${qr.size} ${qr.size}`}>
        <Rect width={qr.size} height={qr.size} fill="#ffffff" />
        <Path d={path} fill="#000000" />
      </Svg>
    </View>
  );
});

function Info({ icon, label, detail, first }: { icon: IconName; label: string; detail: string; first?: boolean }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.row, !first && { borderTopColor: colors.hairline, borderTopWidth: StyleSheet.hairlineWidth }]}>
      <Icon name={icon} size={20} color={colors.accentText} />
      <View style={styles.rowText}>
        <Text style={[styles.label, { color: colors.text }]}>{label}</Text>
        <Text style={[styles.detail, { color: colors.textMuted }]}>{detail}</Text>
      </View>
    </View>
  );
}

function Action({ icon, label, destructive, disabled, onPress }: { icon: IconName; label: string; destructive?: boolean; disabled?: boolean; onPress: () => void }) {
  const { colors } = useTheme();
  const color = destructive ? colors.danger : colors.accentText;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.row, { borderTopColor: colors.hairline, borderTopWidth: StyleSheet.hairlineWidth, opacity: disabled ? 0.45 : 1 }, pressed && { backgroundColor: colors.surface }]}
    >
      <Icon name={icon} size={20} color={color} />
      <Text style={[styles.label, styles.flex, { color }]}>{label}</Text>
    </Pressable>
  );
}

function Button({ label, onPress, disabled, secondary }: { label: string; onPress: () => void; disabled?: boolean; secondary?: boolean }) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: secondary ? colors.surfaceActive : colors.accent, opacity: disabled ? 0.45 : pressed ? 0.8 : 1 },
      ]}
    >
      <Text style={[styles.buttonText, { color: secondary ? colors.text : colors.onAccent }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: "row", alignItems: "center", minHeight: 52, paddingHorizontal: 16, paddingVertical: 8, gap: 12 },
  rowText: { flex: 1, gap: 2 },
  label: { fontSize: 16 },
  detail: { fontSize: 13, lineHeight: 18 },
  block: { paddingHorizontal: 16, paddingVertical: 12, gap: 10, borderTopWidth: StyleSheet.hairlineWidth },
  input: { minHeight: 44, borderRadius: 12, paddingHorizontal: 12, fontSize: 15 },
  button: { height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center", paddingHorizontal: 16 },
  buttonText: { fontSize: 15, fontWeight: "700" },
  buttons: { flexDirection: "row", gap: 10 },
  code: { fontSize: 11, fontFamily: "Courier", textAlign: "center" },
  qr: { borderRadius: 14, overflow: "hidden" },
  spinner: { paddingBottom: 12 },
});
