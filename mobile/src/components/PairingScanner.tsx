import { CameraView, useCameraPermissions, type BarcodeScanningResult } from "expo-camera";
import { memo, useRef } from "react";
import { Linking, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "../state/theme";
import { Icon } from "./Icon";
import { Tap } from "./ui";

/**
 * Full-screen QR code scanner for the pairing code shown by the desktop (expo-camera, included in
 * Expo Go). Only `browser-sync:` codes are accepted; nothing scanned is opened or sent anywhere.
 */
export const PairingScanner = memo(function PairingScanner({ onCode, onClose }: { onCode: (code: string) => void; onClose: () => void }) {
  const { colors, haptic } = useTheme();
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const done = useRef(false);

  const onScanned = (result: BarcodeScanningResult) => {
    if (done.current || !result.data.startsWith("browser-sync:")) return;
    done.current = true;
    haptic("success");
    onCode(result.data);
  };

  return (
    <View style={[StyleSheet.absoluteFill, styles.root]} accessibilityViewIsModal>
      {permission?.granted ? (
        <CameraView style={StyleSheet.absoluteFill} facing="back" barcodeScannerSettings={{ barcodeTypes: ["qr"] }} onBarcodeScanned={onScanned} />
      ) : (
        <View style={styles.permission}>
          <Icon name="scan" size={44} color="#fff" />
          <Text style={styles.permissionTitle}>Accès à l'appareil photo</Text>
          <Text style={styles.permissionText}>
            Pour scanner le QR code de jumelage affiché par votre ordinateur. L'image n'est ni enregistrée ni envoyée.
          </Text>
          <Tap
            accessibilityRole="button"
            onPress={() => (permission && !permission.canAskAgain ? void Linking.openSettings() : void requestPermission())}
            style={[styles.button, { backgroundColor: colors.accent }]}
          >
            <Text style={[styles.buttonText, { color: colors.onAccent }]}>
              {permission && !permission.canAskAgain ? "Ouvrir les réglages" : "Autoriser l'appareil photo"}
            </Text>
          </Tap>
        </View>
      )}
      <View style={[styles.frame, { top: insets.top + 120 }]} pointerEvents="none" />
      <View style={[styles.top, { paddingTop: insets.top + 8 }]}>
        <Text style={styles.hint}>Visez le QR code affiché dans Paramètres, Synchronisation, sur l'ordinateur.</Text>
        <Tap accessibilityRole="button" accessibilityLabel="Fermer le scanner" onPress={onClose} style={styles.close} pressScale={0.9}>
          <Icon name="close" size={22} color="#fff" strokeWidth={2.4} />
        </Tap>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  root: { backgroundColor: "#000", zIndex: 10 },
  top: { position: "absolute", left: 0, right: 0, top: 0, flexDirection: "row", alignItems: "center", paddingHorizontal: 16, gap: 12 },
  hint: { flex: 1, color: "#fff", fontSize: 15, fontWeight: "600" },
  close: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.18)" },
  frame: { position: "absolute", alignSelf: "center", width: 250, height: 250, borderRadius: 28, borderWidth: 3, borderColor: "rgba(255,255,255,0.85)" },
  permission: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 32 },
  permissionTitle: { color: "#fff", fontSize: 20, fontWeight: "700" },
  permissionText: { color: "rgba(255,255,255,0.8)", fontSize: 15, textAlign: "center", lineHeight: 21 },
  button: { marginTop: 8, height: 48, paddingHorizontal: 22, borderRadius: 24, alignItems: "center", justifyContent: "center" },
  buttonText: { fontSize: 16, fontWeight: "700" },
});
