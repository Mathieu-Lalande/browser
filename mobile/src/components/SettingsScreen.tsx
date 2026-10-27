import { ACCENT_PRESETS, LIMITS, type CloseTabActivates, type NewTabPosition, type ThemeMode } from "@shared/settings";
import { displayUrl, SEARCH_ENGINES } from "@shared/url";
import { memo, useState, type ReactNode } from "react";
import { Alert, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import Animated, { FadeIn, FadeOut, SlideInDown, SlideOutDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { APP_VERSION } from "../lib/version";
import { useBrowserActions, useBrowserState } from "../state/BrowserProvider";
import { useTheme } from "../state/theme";
import { Icon, type IconName } from "./Icon";
import { PairingScanner } from "./PairingScanner";
import { SyncSettings } from "./SyncSettings";
import { IconButton, SiteIcon, Tap } from "./ui";

/** Settings: search engine, theme/accent, start page, tabs, privacy, favorites, about. */
export const SettingsScreen = memo(function SettingsScreen({ onClose }: { onClose: () => void }) {
  const { colors, dark, reduceMotion, haptic } = useTheme();
  const { settings, mobile, bookmarks } = useBrowserState();
  const actions = useBrowserActions();
  const insets = useSafeAreaInsets();
  const { appearance, startPage, behavior } = settings;
  const [scanning, setScanning] = useState(false);
  const { sync } = useBrowserState();

  const confirm = (title: string, message: string, action: string, run: () => void) =>
    Alert.alert(title, message, [
      { text: "Annuler", style: "cancel" },
      {
        text: action,
        style: "destructive",
        onPress: () => {
          haptic("warning");
          run();
        },
      },
    ]);

  return (
    <Animated.View
      entering={reduceMotion ? FadeIn.duration(120) : SlideInDown.springify().damping(24).stiffness(240)}
      exiting={reduceMotion ? FadeOut.duration(100) : SlideOutDown.duration(200)}
      style={[StyleSheet.absoluteFill, { backgroundColor: colors.bg, paddingTop: insets.top }]}
      accessibilityViewIsModal
    >
      <View style={[styles.header, { borderBottomColor: colors.hairline }]}>
        <Text style={[styles.title, { color: colors.text }]} accessibilityRole="header">
          Paramètres
        </Text>
        <Tap accessibilityRole="button" onPress={onClose} style={styles.done} pressScale={0.9}>
          <Text style={[styles.doneText, { color: colors.accentText }]}>OK</Text>
        </Tap>
      </View>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
        <Group title="Recherche" icon="search">
          {SEARCH_ENGINES.map((engine, index) => (
            <Choice
              key={engine.id}
              label={engine.name}
              detail={engine.id === "duckduckgo" ? "Par défaut, respecte la vie privée" : undefined}
              selected={settings.search.engine === engine.id}
              first={index === 0}
              onPress={() => actions.updateSettings({ search: { engine: engine.id } })}
            />
          ))}
        </Group>

        <Group title="Apparence" icon="sparkles">
          <Row label="Thème" first>
            <Segmented<ThemeMode>
              value={appearance.mode}
              options={[
                ["system", "Auto"],
                ["light", "Clair"],
                ["dark", "Sombre"],
              ]}
              onChange={(mode) => actions.updateSettings({ appearance: { mode } })}
            />
          </Row>
          <View style={[styles.swatchRow, { borderTopColor: colors.hairline }]}>
            <Text style={[styles.rowLabel, { color: colors.text }]}>Couleur d'accent</Text>
            <View style={styles.swatches}>
              {ACCENT_PRESETS.map((preset) => {
                const selected = preset.accent === appearance.accent;
                return (
                  <Tap
                    key={preset.name}
                    accessibilityRole="radio"
                    accessibilityLabel={preset.name}
                    accessibilityState={{ selected }}
                    onPress={() => {
                      haptic("selection");
                      actions.updateSettings({ appearance: { accent: preset.accent, accent2: preset.accent2 } });
                    }}
                    pressScale={0.85}
                    style={[styles.swatch, { borderColor: selected ? colors.text : "transparent" }]}
                  >
                    <View style={[styles.swatchInner, { backgroundColor: preset.accent }]}>
                      <View style={[styles.swatchHalf, { backgroundColor: preset.accent2 }]} />
                    </View>
                  </Tap>
                );
              })}
            </View>
          </View>
          <Toggle
            label="Réduire les animations"
            detail="S'ajoute au réglage du système"
            value={appearance.reduceMotion}
            onChange={(reduceMotion) => actions.updateSettings({ appearance: { reduceMotion } })}
          />
        </Group>

        <Group title="Page d'accueil" icon="home">
          <Row label="Prénom" first>
            <TextInput
              value={startPage.greetingName}
              onChangeText={(greetingName) => actions.updateSettings({ startPage: { greetingName } })}
              placeholder="Facultatif"
              placeholderTextColor={colors.textFaint}
              maxLength={LIMITS.greetingName}
              style={[styles.input, { color: colors.text }]}
              keyboardAppearance={dark ? "dark" : "light"}
              returnKeyType="done"
              accessibilityLabel="Prénom affiché dans le message d'accueil"
            />
          </Row>
          <Toggle label="Afficher l'heure" value={startPage.showClock} onChange={(showClock) => actions.updateSettings({ startPage: { showClock } })} />
          <Toggle
            label="Sites fréquents"
            value={startPage.showTopSites}
            onChange={(showTopSites) => actions.updateSettings({ startPage: { showTopSites } })}
          />
        </Group>

        <Group title="Onglets" icon="tabs">
          <Toggle
            label="Rouvrir les onglets au démarrage"
            first
            value={behavior.restoreSession}
            onChange={(restoreSession) => actions.updateSettings({ behavior: { restoreSession } })}
          />
          <Row label="Nouveaux onglets">
            <Segmented<NewTabPosition>
              value={behavior.newTabPosition}
              options={[
                ["end", "À la fin"],
                ["next", "À côté"],
              ]}
              onChange={(newTabPosition) => actions.updateSettings({ behavior: { newTabPosition } })}
            />
          </Row>
          <Row label="Après fermeture" vertical>
            <Segmented<CloseTabActivates>
              value={behavior.closeTabActivates}
              options={[
                ["next", "Suivant"],
                ["previous", "Précédent"],
                ["recent", "Récent"],
              ]}
              onChange={(closeTabActivates) => actions.updateSettings({ behavior: { closeTabActivates } })}
            />
          </Row>
          <Toggle
            label="Masquer la barre en défilant"
            value={mobile.collapseToolbar}
            onChange={(collapseToolbar) => actions.updateMobileSettings({ collapseToolbar })}
          />
          {Platform.OS !== "web" && (
            <Toggle label="Retour haptique" value={mobile.haptics} onChange={(haptics) => actions.updateMobileSettings({ haptics })} />
          )}
        </Group>

        <Group title="Synchronisation" icon="cloud">
          <SyncSettings onScan={() => setScanning(true)} />
        </Group>

        <Group title="Confidentialité" icon="shield">
          <Info
            first
            icon="lock"
            label="Mode HTTPS uniquement"
            detail="Les adresses http:// sont ouvertes en https:// ; si le site ne le permet pas, vous choisissez."
          />
          <Info
            icon="shield"
            label="Bloqueur de pubs et traqueurs"
            detail="Bientôt : il demande une version compilée de l'app (le blocage est impossible dans Expo Go)."
          />
          <Action
            icon="clock"
            label="Effacer l'historique"
            destructive
            onPress={() =>
              confirm("Effacer tout l'historique ?", "Toutes les pages visitées seront oubliées. Les favoris et les onglets ouverts sont conservés.", "Effacer", () =>
                actions.clearHistory(),
              )
            }
          />
          <Action
            icon="trash"
            label="Effacer toutes les données"
            destructive
            onPress={() =>
              confirm(
                "Tout effacer ?",
                sync?.configured
                  ? "Historique, favoris et onglets ouverts seront supprimés, aussi sur vos appareils synchronisés. Les cookies des sites restent gérés par le système."
                  : "Historique, favoris et onglets ouverts seront supprimés. Les cookies des sites restent gérés par le système.",
                "Tout effacer",
                () => void actions.clearAllData(),
              )
            }
          />
        </Group>

        {bookmarks.length > 0 && (
          <Group title={`Favoris (${bookmarks.length})`} icon="star">
            {[...bookmarks].reverse().slice(0, 50).map((bookmark, index) => (
              <View key={bookmark.id} style={[styles.row, index > 0 && { borderTopColor: colors.hairline, borderTopWidth: StyleSheet.hairlineWidth }]}>
                <SiteIcon url={bookmark.url} title={bookmark.title} size={24} />
                <View style={styles.rowText}>
                  <Text style={[styles.rowLabel, { color: colors.text }]} numberOfLines={1}>
                    {bookmark.title || displayUrl(bookmark.url)}
                  </Text>
                  <Text style={[styles.rowDetail, { color: colors.textMuted }]} numberOfLines={1}>
                    {displayUrl(bookmark.url)}
                  </Text>
                </View>
                <IconButton icon="trash" label="Retirer des favoris" size={20} color={colors.textMuted} onPress={() => actions.removeBookmark(bookmark.id)} />
              </View>
            ))}
          </Group>
        )}

        <Group title="À propos" icon="info">
          <Info
            first
            icon="globe"
            label={`Browser ${APP_VERSION} (Expo SDK 58)`}
            detail={
              Platform.OS === "ios"
                ? "Moteur WebKit (imposé par iOS). Code partagé avec la version de bureau."
                : "Moteur Android System WebView (Chromium). Code partagé avec la version de bureau."
            }
          />
        </Group>
      </ScrollView>
      {scanning && (
        <PairingScanner
          onClose={() => setScanning(false)}
          onCode={(code) => {
            setScanning(false);
            void actions.sync.pair(code).then((result) =>
              Alert.alert("Synchronisation", result.ok ? "Téléphone jumelé avec votre ordinateur." : result.message),
            );
          }}
        />
      )}
    </Animated.View>
  );
});

function Group({ title, icon, children }: { title: string; icon: IconName; children: ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={styles.group}>
      <View style={styles.groupHeader}>
        <Icon name={icon} size={16} color={colors.textMuted} strokeWidth={2} />
        <Text style={[styles.groupTitle, { color: colors.textMuted }]} accessibilityRole="header">
          {title}
        </Text>
      </View>
      <View style={[styles.card, { backgroundColor: colors.bgElevated, borderColor: colors.hairline }]}>{children}</View>
    </View>
  );
}

function Row({ label, first, vertical, children }: { label: string; first?: boolean; vertical?: boolean; children: ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={[vertical ? styles.rowVertical : styles.row, !first && { borderTopColor: colors.hairline, borderTopWidth: StyleSheet.hairlineWidth }]}>
      <Text style={[styles.rowLabel, { color: colors.text }, !vertical && styles.flex]}>{label}</Text>
      {children}
    </View>
  );
}

function Toggle({ label, detail, value, first, onChange }: { label: string; detail?: string; value: boolean; first?: boolean; onChange: (value: boolean) => void }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.row, !first && { borderTopColor: colors.hairline, borderTopWidth: StyleSheet.hairlineWidth }]}>
      <View style={styles.rowText}>
        <Text style={[styles.rowLabel, { color: colors.text }]}>{label}</Text>
        {detail && <Text style={[styles.rowDetail, { color: colors.textMuted }]}>{detail}</Text>}
      </View>
      <Switch value={value} onValueChange={onChange} trackColor={{ true: colors.accent, false: colors.surfaceActive }} thumbColor="#ffffff" accessibilityLabel={label} />
    </View>
  );
}

function Choice({ label, detail, selected, first, onPress }: { label: string; detail?: string; selected: boolean; first?: boolean; onPress: () => void }) {
  const { colors, haptic } = useTheme();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      onPress={() => {
        haptic("selection");
        onPress();
      }}
      style={({ pressed }) => [styles.row, !first && { borderTopColor: colors.hairline, borderTopWidth: StyleSheet.hairlineWidth }, pressed && { backgroundColor: colors.surface }]}
    >
      <View style={styles.rowText}>
        <Text style={[styles.rowLabel, { color: colors.text }]}>{label}</Text>
        {detail && <Text style={[styles.rowDetail, { color: colors.textMuted }]}>{detail}</Text>}
      </View>
      {selected && <Icon name="check" size={20} color={colors.accentText} strokeWidth={2} />}
    </Pressable>
  );
}

function Info({ icon, label, detail, first }: { icon: IconName; label: string; detail: string; first?: boolean }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.row, !first && { borderTopColor: colors.hairline, borderTopWidth: StyleSheet.hairlineWidth }]}>
      <Icon name={icon} size={20} color={colors.accentText} />
      <View style={styles.rowText}>
        <Text style={[styles.rowLabel, { color: colors.text }]}>{label}</Text>
        <Text style={[styles.rowDetail, { color: colors.textMuted }]}>{detail}</Text>
      </View>
    </View>
  );
}

function Action({ icon, label, destructive, onPress }: { icon: IconName; label: string; destructive?: boolean; onPress: () => void }) {
  const { colors } = useTheme();
  const color = destructive ? colors.danger : colors.accentText;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.row, { borderTopColor: colors.hairline, borderTopWidth: StyleSheet.hairlineWidth }, pressed && { backgroundColor: colors.surface }]}
    >
      <Icon name={icon} size={20} color={color} />
      <Text style={[styles.rowLabel, styles.flex, { color }]}>{label}</Text>
    </Pressable>
  );
}

function Segmented<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (value: T) => void }) {
  const { colors, haptic } = useTheme();
  return (
    <View style={[styles.segmented, { backgroundColor: colors.surfaceActive }]} accessibilityRole="radiogroup">
      {options.map(([option, label]) => {
        const selected = option === value;
        return (
          <Pressable
            key={option}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            onPress={() => {
              haptic("selection");
              onChange(option);
            }}
            style={[styles.segment, selected && [styles.segmentSelected, { backgroundColor: colors.bgElevated }]]}
          >
            <Text style={[styles.segmentText, { color: selected ? colors.text : colors.textMuted }]}>{label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", height: 56, paddingLeft: 20, paddingRight: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  title: { flex: 1, fontSize: 28, fontWeight: "800", letterSpacing: -0.4 },
  done: { minWidth: 56, height: 44, alignItems: "center", justifyContent: "center" },
  doneText: { fontSize: 17, fontWeight: "700" },
  content: { padding: 16, gap: 22 },
  group: { gap: 8 },
  groupHeader: { flexDirection: "row", alignItems: "center", gap: 6, marginLeft: 6 },
  groupTitle: { fontSize: 13, fontWeight: "700", letterSpacing: 0.4, textTransform: "uppercase" },
  card: { borderRadius: 18, overflow: "hidden", borderWidth: StyleSheet.hairlineWidth },
  row: { flexDirection: "row", alignItems: "center", minHeight: 52, paddingHorizontal: 16, paddingVertical: 8, gap: 12 },
  rowVertical: { paddingHorizontal: 16, paddingVertical: 12, gap: 10 },
  rowText: { flex: 1, gap: 2 },
  rowLabel: { fontSize: 16 },
  rowDetail: { fontSize: 13, lineHeight: 18 },
  input: { minWidth: 140, fontSize: 16, textAlign: "right", paddingVertical: 6 },
  swatchRow: { paddingHorizontal: 16, paddingVertical: 12, gap: 12, borderTopWidth: StyleSheet.hairlineWidth },
  swatches: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  swatch: { width: 40, height: 40, borderRadius: 20, borderWidth: 2.5, alignItems: "center", justifyContent: "center" },
  swatchInner: { width: 30, height: 30, borderRadius: 15, overflow: "hidden" },
  swatchHalf: { position: "absolute", right: 0, bottom: 0, width: 15, height: 30, transform: [{ skewX: "0deg" }] },
  segmented: { flexDirection: "row", borderRadius: 11, padding: 2 },
  segment: { minHeight: 34, paddingHorizontal: 12, borderRadius: 9, alignItems: "center", justifyContent: "center", flexGrow: 1 },
  segmentSelected: { shadowColor: "#000", shadowOpacity: 0.12, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  segmentText: { fontSize: 14, fontWeight: "600" },
});
