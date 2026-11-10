import { t } from "@shared/i18n";
import { formatBytes } from "@shared/downloads";
import { formatDate } from "@shared/i18n/intl";
import { displayUrl } from "@shared/url";
import { memo, useEffect } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { canOpenDownload, type MobileDownload } from "../lib/downloads";
import { downloads, loadDownloads, openDownload, removeDownload, shareDownload } from "../state/downloads";
import { useStore } from "../state/store";
import { useTheme } from "../state/theme";
import { Icon } from "./Icon";
import { IconButton, Tap } from "./ui";

/**
 * "Téléchargements" (ADR-055): the files downloaded in normal tabs, newest first (name, size,
 * date, source); open (harmless types only, as on the desktop), share, delete.
 */
export const DownloadsScreen = memo(function DownloadsScreen({ onClose }: { onClose: () => void }) {
  const list = useStore(downloads);
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  useEffect(() => {
    loadDownloads().catch(() => {});
  }, []);

  const quiet = (run: () => Promise<void>) => () => void run().catch(() => {});

  const row = (item: MobileDownload) => {
    const openable = canOpenDownload(item);
    const detail = t("mobile.downloads.detail", {
      size: item.size > 0 ? formatBytes(item.size) : "",
      date: formatDate(item.createdAt, { dateStyle: "medium", timeStyle: "short" }),
    }).replace(/^ · /, "");
    return (
      <View key={item.id} style={[styles.row, { borderTopColor: colors.hairline }]}>
        <Tap
          accessibilityRole="button"
          accessibilityLabel={openable ? t("mobile.downloads.open", { name: item.name }) : t("mobile.downloads.share", { name: item.name })}
          onPress={quiet(() => (openable ? openDownload(item) : shareDownload(item)))}
          pressScale={0.98}
          style={styles.main}
        >
          <View style={[styles.fileIcon, { backgroundColor: colors.surface }]}>
            <Icon name="download" size={18} color={colors.textMuted} />
          </View>
          <View style={styles.text}>
            <Text style={[styles.title, { color: colors.text }]} numberOfLines={2}>
              {item.name}
            </Text>
            <Text style={[styles.detail, { color: colors.textMuted }]} numberOfLines={1}>
              {item.url ? `${detail} · ${displayUrl(item.url)}` : detail}
            </Text>
          </View>
        </Tap>
        {openable && <IconButton icon="open" size={18} label={t("mobile.downloads.open", { name: item.name })} color={colors.textMuted} onPress={quiet(() => openDownload(item))} />}
        <IconButton icon="share" size={18} label={t("mobile.downloads.share", { name: item.name })} color={colors.textMuted} onPress={quiet(() => shareDownload(item))} />
        <IconButton icon="trash" size={18} label={t("mobile.downloads.remove", { name: item.name })} color={colors.textMuted} onPress={() => removeDownload(item)} />
      </View>
    );
  };

  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.bg, paddingTop: insets.top }]} accessibilityViewIsModal testID="downloads">
      <View style={styles.toolbar}>
        <IconButton icon="close" label={t("mobile.downloads.close")} color={colors.text} onPress={onClose} />
        <Text style={[styles.heading, { color: colors.text }]} accessibilityRole="header">
          {t("mobile.downloads.title")}
        </Text>
      </View>
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}>
        {list.length === 0 && (
          <View style={styles.empty}>
            <Icon name="download" size={28} color={colors.textMuted} />
            <Text style={[styles.detail, { color: colors.textMuted, textAlign: "center" }]}>{t("mobile.downloads.empty")}</Text>
          </View>
        )}
        {list.map(row)}
      </ScrollView>
    </View>
  );
});

const styles = StyleSheet.create({
  toolbar: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 8, paddingVertical: 6 },
  heading: { fontSize: 18, fontWeight: "700" },
  row: { flexDirection: "row", alignItems: "center", paddingHorizontal: 8, borderTopWidth: StyleSheet.hairlineWidth },
  main: { flex: 1, flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, paddingHorizontal: 8 },
  fileIcon: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  text: { flex: 1 },
  title: { fontSize: 15, fontWeight: "600" },
  detail: { fontSize: 12, marginTop: 2 },
  empty: { alignItems: "center", gap: 12, padding: 32 },
});
