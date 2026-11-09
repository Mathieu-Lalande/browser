import { readingTimeLabel } from "@shared/reader";
import type { ReadingItem } from "@shared/reading-list";
import { displayUrl } from "@shared/url";
import { memo } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { readingSections } from "../lib/readingList";
import { useBrowserActions, useBrowserState } from "../state/BrowserProvider";
import { useTheme } from "../state/theme";
import { Icon } from "./Icon";
import { IconButton, SiteIcon, Tap } from "./ui";

interface Props {
  onClose: () => void;
  /** Reads the offline copy (the reader, without the network). */
  onRead: (item: ReadingItem) => void;
  /** Opens the live page in a tab. */
  onOpen: (url: string) => void;
}

/**
 * "Liste de lecture" (ADR-047): the pages kept with "Lire plus tard" on any device (synced), unread
 * first; a page with an offline copy opens in the reader, the others in a tab.
 */
export const ReadingListScreen = memo(function ReadingListScreen({ onClose, onRead, onOpen }: Props) {
  const { reading } = useBrowserState();
  const actions = useBrowserActions();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { unread, read } = readingSections(reading);

  const setRead = (item: ReadingItem, value: boolean) =>
    actions.setReadingList((list) => list.map((entry) => (entry.id === item.id ? { ...entry, readAt: value ? (entry.readAt ?? Date.now()) : null } : entry)));
  const remove = (item: ReadingItem) => actions.setReadingList((list) => list.filter((entry) => entry.id !== item.id));
  const open = (item: ReadingItem) => {
    if (item.readAt === null) setRead(item, true);
    if (item.text) onRead(item);
    else onOpen(item.url);
  };

  const row = (item: ReadingItem) => (
    <View key={item.id} style={[styles.row, { borderTopColor: colors.hairline }]}>
      <Tap accessibilityRole="button" accessibilityLabel={`Lire ${item.title}`} onPress={() => open(item)} pressScale={0.98} style={styles.main}>
        <SiteIcon url={item.url} title={item.title} size={22} />
        <View style={styles.text}>
          <Text style={[styles.title, { color: item.readAt === null ? colors.text : colors.textMuted }]} numberOfLines={2}>
            {item.title}
          </Text>
          <Text style={[styles.detail, { color: colors.textMuted }]} numberOfLines={1}>
            {item.siteName || displayUrl(item.url)}
            {item.minutes ? ` · ${readingTimeLabel(item.minutes)}` : ""}
            {item.text ? " · hors ligne" : ""}
          </Text>
        </View>
      </Tap>
      <IconButton icon="open" size={18} label={`Ouvrir ${item.title}`} color={colors.textMuted} onPress={() => onOpen(item.url)} />
      <IconButton
        icon={item.readAt === null ? "check" : "undo"}
        size={18}
        label={item.readAt === null ? `Marquer ${item.title} comme lue` : `Marquer ${item.title} comme non lue`}
        color={colors.textMuted}
        onPress={() => setRead(item, item.readAt === null)}
      />
      <IconButton icon="trash" size={18} label={`Retirer ${item.title}`} color={colors.textMuted} onPress={() => remove(item)} />
    </View>
  );

  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.bg, paddingTop: insets.top }]} accessibilityViewIsModal testID="reading-list">
      <View style={styles.toolbar}>
        <IconButton icon="close" label="Fermer la liste de lecture" color={colors.text} onPress={onClose} />
        <Text style={[styles.heading, { color: colors.text }]} accessibilityRole="header">
          Liste de lecture
        </Text>
      </View>
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}>
        {reading.length === 0 && (
          <View style={styles.empty}>
            <Icon name="bookMarked" size={28} color={colors.textMuted} />
            <Text style={[styles.detail, { color: colors.textMuted, textAlign: "center" }]}>
              « Lire plus tard » (menu de la page) garde une page et son texte, lisible même hors ligne, sur tous vos appareils.
            </Text>
          </View>
        )}
        {unread.length > 0 && <Text style={[styles.section, { color: colors.textMuted }]}>Non lues</Text>}
        {unread.map(row)}
        {read.length > 0 && <Text style={[styles.section, { color: colors.textMuted }]}>Lues</Text>}
        {read.map(row)}
      </ScrollView>
    </View>
  );
});

const styles = StyleSheet.create({
  toolbar: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 8, paddingVertical: 6 },
  heading: { fontSize: 18, fontWeight: "700" },
  section: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 6, fontSize: 12, fontWeight: "700", textTransform: "uppercase" },
  row: { flexDirection: "row", alignItems: "center", paddingHorizontal: 8, borderTopWidth: StyleSheet.hairlineWidth },
  main: { flex: 1, flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, paddingHorizontal: 8 },
  text: { flex: 1 },
  title: { fontSize: 15, fontWeight: "600" },
  detail: { fontSize: 12, marginTop: 2 },
  empty: { alignItems: "center", gap: 12, padding: 32 },
});
