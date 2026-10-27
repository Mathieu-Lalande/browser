import { displayUrl } from "@shared/url";
import { memo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useBrowserState } from "../state/BrowserProvider";
import { useTheme } from "../state/theme";
import { Icon } from "./Icon";
import { SiteIcon, Tap } from "./ui";

/** "Autres appareils": tabs open on the user's other synced devices (ADR-019), in the tab overview. */
export const RemoteTabs = memo(function RemoteTabs({ onOpen }: { onOpen: (url: string) => void }) {
  const { colors } = useTheme();
  const { sync } = useBrowserState();
  const devices = (sync?.devices ?? []).filter((device) => device.tabs.length > 0);
  if (!sync?.configured || devices.length === 0) return null;
  return (
    <View style={styles.section} testID="remote-tabs">
      <View style={styles.header}>
        <Icon name="cloud" size={14} color={colors.textMuted} strokeWidth={2.4} />
        <Text style={[styles.title, { color: colors.textMuted }]} accessibilityRole="header">
          Autres appareils
        </Text>
      </View>
      {devices.map((device) => (
        <View key={device.id} style={[styles.card, { backgroundColor: colors.bgElevated, borderColor: colors.hairline }]}>
          <View style={styles.device}>
            <Icon name={device.kind === "mobile" ? "smartphone" : "laptop"} size={16} color={colors.accentText} />
            <Text style={[styles.deviceName, { color: colors.text }]} numberOfLines={1}>
              {device.name}
            </Text>
            <Text style={[styles.count, { color: colors.textMuted }]}>{device.tabs.length}</Text>
          </View>
          {device.tabs.slice(0, 20).map((tab) => (
            <Tap
              key={tab.url}
              accessibilityRole="button"
              accessibilityLabel={`Ouvrir ${tab.title || displayUrl(tab.url)}`}
              onPress={() => onOpen(tab.url)}
              pressScale={0.98}
              style={[styles.row, { borderTopColor: colors.hairline }]}
            >
              <SiteIcon url={tab.url} title={tab.title} size={22} />
              <View style={styles.text}>
                <Text style={[styles.tabTitle, { color: colors.text }]} numberOfLines={1}>
                  {tab.title || displayUrl(tab.url)}
                </Text>
                <Text style={[styles.tabUrl, { color: colors.textMuted }]} numberOfLines={1}>
                  {displayUrl(tab.url)}
                </Text>
              </View>
            </Tap>
          ))}
        </View>
      ))}
    </View>
  );
});

const styles = StyleSheet.create({
  section: { width: "100%", gap: 8, paddingTop: 18 },
  header: { flexDirection: "row", alignItems: "center", gap: 6, marginLeft: 6 },
  title: { fontSize: 13, fontWeight: "700", letterSpacing: 0.4, textTransform: "uppercase" },
  card: { borderRadius: 18, overflow: "hidden", borderWidth: StyleSheet.hairlineWidth },
  device: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 14, height: 44 },
  deviceName: { flex: 1, fontSize: 15, fontWeight: "600" },
  count: { fontSize: 13 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 50, paddingHorizontal: 14, borderTopWidth: StyleSheet.hairlineWidth },
  text: { flex: 1, gap: 1 },
  tabTitle: { fontSize: 15 },
  tabUrl: { fontSize: 12 },
});
