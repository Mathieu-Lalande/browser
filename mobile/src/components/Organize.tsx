import type { ArchivedTab } from "@shared/archive";
import type { Favorite } from "@shared/favorites";
import { displayUrl } from "@shared/url";
import { memo } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { siteLabel } from "../lib/site";
import { useBrowserState } from "../state/BrowserProvider";
import { useTheme } from "../state/theme";
import { Icon } from "./Icon";
import { SiteIcon, Tap } from "./ui";

/** Organisation pieces of the phone UI (ADR-022): the favorites row and the archived tabs. */

export const FAVORITES_ROW = 72;

/**
 * The favorites grid as one scrolling row of tiles (start page, tab overview). `openUrls`: sites
 * with a tab open in the space shown get a dot.
 */
export const FavoritesRow = memo(function FavoritesRow({
  favorites,
  isOpen,
  onOpen,
  onLongPress,
  title,
}: {
  favorites: readonly Favorite[];
  isOpen?: (url: string) => boolean;
  onOpen: (url: string) => void;
  onLongPress: (favorite: Favorite) => void;
  title?: string;
}) {
  const { colors, haptic } = useTheme();
  if (!favorites.length) return null;
  return (
    <View style={styles.favorites} testID="favorites-row">
      {title ? (
        <Text style={[styles.sectionTitle, { color: colors.textMuted }]} accessibilityRole="header">
          {title}
        </Text>
      ) : null}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.favoritesContent}>
        {favorites.map((favorite) => {
          const open = isOpen?.(favorite.url) ?? false;
          return (
            <Tap
              key={favorite.url}
              accessibilityRole="button"
              accessibilityLabel={`${favorite.title}${open ? ", ouvert" : ""}`}
              accessibilityHint="Maintenir pour plus d'options"
              onPress={() => onOpen(favorite.url)}
              onLongPress={() => {
                haptic("medium");
                onLongPress(favorite);
              }}
              pressScale={0.9}
              style={styles.favorite}
            >
              <View style={[styles.favoriteTile, { backgroundColor: colors.bgElevated, borderColor: colors.hairline }]}>
                <SiteIcon url={favorite.url} title={favorite.title} size={26} plain />
                {open && <View style={[styles.dot, { backgroundColor: colors.accent }]} />}
              </View>
              <Text style={[styles.favoriteLabel, { color: colors.textMuted }]} numberOfLines={1}>
                {favorite.title || siteLabel(favorite.url)}
              </Text>
            </Tap>
          );
        })}
      </ScrollView>
    </View>
  );
});

/** "Archivés": tabs closed by auto-archiving, to restore (tap) or delete, in the tab overview. */
export const ArchivedTabs = memo(function ArchivedTabs({
  onRestore,
  onRemove,
  onClear,
}: {
  onRestore: (id: string) => void;
  onRemove: (id: string) => void;
  onClear: () => void;
}) {
  const { colors } = useTheme();
  const { archive } = useBrowserState();
  if (!archive.length) return null;
  return (
    <View style={styles.section} testID="archived-tabs">
      <View style={styles.header}>
        <Icon name="archive" size={14} color={colors.textMuted} strokeWidth={2.4} />
        <Text style={[styles.title, { color: colors.textMuted }]} accessibilityRole="header">
          Archivés · {archive.length}
        </Text>
        <View style={styles.spacer} />
        <Tap accessibilityRole="button" onPress={onClear} hitSlop={8} pressScale={0.92}>
          <Text style={[styles.clear, { color: colors.accentText }]}>Tout effacer</Text>
        </Tap>
      </View>
      <View style={[styles.card, { backgroundColor: colors.bgElevated, borderColor: colors.hairline }]}>
        {archive.slice(0, 30).map((entry: ArchivedTab, index) => (
          <View key={entry.id} style={[styles.row, index > 0 && { borderTopColor: colors.hairline, borderTopWidth: StyleSheet.hairlineWidth }]}>
            <Tap
              accessibilityRole="button"
              accessibilityLabel={`Restaurer ${entry.title || displayUrl(entry.url)}`}
              onPress={() => onRestore(entry.id)}
              pressScale={0.98}
              style={styles.rowMain}
            >
              <SiteIcon url={entry.url} title={entry.title} size={22} />
              <View style={styles.text}>
                <Text style={[styles.tabTitle, { color: colors.text }]} numberOfLines={1}>
                  {entry.title || displayUrl(entry.url)}
                </Text>
                <Text style={[styles.tabUrl, { color: colors.textMuted }]} numberOfLines={1}>
                  {displayUrl(entry.url)}
                </Text>
              </View>
              <Icon name="archiveRestore" size={18} color={colors.accentText} />
            </Tap>
            <Tap accessibilityRole="button" accessibilityLabel="Supprimer de l'archive" onPress={() => onRemove(entry.id)} hitSlop={6} pressScale={0.85} style={styles.remove}>
              <Icon name="trash" size={16} color={colors.textMuted} />
            </Tap>
          </View>
        ))}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  favorites: { width: "100%", height: FAVORITES_ROW, justifyContent: "center" },
  favoritesContent: { gap: 12, paddingHorizontal: 2 },
  favorite: { width: 56, alignItems: "center", gap: 4 },
  favoriteTile: { width: 48, height: 48, borderRadius: 14, alignItems: "center", justifyContent: "center", borderWidth: StyleSheet.hairlineWidth },
  favoriteLabel: { fontSize: 11, fontWeight: "500", maxWidth: 56 },
  dot: { position: "absolute", bottom: 4, width: 5, height: 5, borderRadius: 3 },
  sectionTitle: { fontSize: 13, fontWeight: "700", marginBottom: 8, marginLeft: 4, textTransform: "uppercase", letterSpacing: 0.4 },
  section: { width: "100%", gap: 8, paddingTop: 18 },
  header: { flexDirection: "row", alignItems: "center", gap: 6, marginLeft: 6, marginRight: 6 },
  title: { fontSize: 13, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.4 },
  spacer: { flex: 1 },
  clear: { fontSize: 13, fontWeight: "600" },
  card: { borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center" },
  rowMain: { flex: 1, flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, paddingLeft: 14, paddingRight: 8 },
  text: { flex: 1, minWidth: 0 },
  tabTitle: { fontSize: 15, fontWeight: "500" },
  tabUrl: { fontSize: 12 },
  remove: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
});
