import { topSites } from "@shared/search";
import { displayUrl } from "@shared/url";
import { LinearGradient } from "expo-linear-gradient";
import { memo, useEffect, useMemo, useState } from "react";
import { Platform, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import { withAlpha } from "../lib/colors";
import { privateModeNotice } from "../lib/navigation";
import { greeting } from "../lib/site";
import { useBrowserState, useHistoryEntries } from "../state/BrowserProvider";
import { useTheme } from "../state/theme";
import { Icon } from "./Icon";
import { SiteIcon, Tap } from "./ui";

interface Props {
  bottomInset: number;
  onSearch: () => void;
  onOpen: (url: string) => void;
  onLongPressSite: (url: string, title: string) => void;
}

const TOP_SITES = 8;

/** New tab page: greeting, search pill, most visited sites (frecency) and favorites. */
export const StartPage = memo(function StartPage({ bottomInset, onSearch, onOpen, onLongPressSite }: Props) {
  const { colors, dark, isPrivate, reduceMotion } = useTheme();
  const { settings, bookmarks } = useBrowserState();
  const history = useHistoryEntries();
  const { width } = useWindowDimensions();
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(timer);
  }, []);

  const options = settings.startPage;
  const sites = useMemo(() => (options.showTopSites ? topSites(history, TOP_SITES, Date.now()) : []), [history, options.showTopSites]);
  const favorites = useMemo(() => [...bookmarks].reverse().slice(0, 12), [bookmarks]);
  const name = options.greetingName.trim();
  const columns = width >= 600 ? 6 : 4;
  const tile = Math.min(88, Math.floor((Math.min(width, 640) - 32 - (columns - 1) * 12) / columns));
  const entering = (index: number) => (reduceMotion ? undefined : FadeInDown.delay(60 + index * 30).duration(320));

  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.bg }]}>
      <LinearGradient
        colors={[withAlpha(colors.accent, dark ? 0.32 : 0.22), withAlpha(colors.accent2, dark ? 0.12 : 0.1), "transparent"]}
        locations={[0, 0.45, 1]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0.8, y: 0.9 }}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: bottomInset + 32 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {isPrivate ? (
          <Animated.View entering={entering(0)} style={styles.hero}>
            <View style={[styles.privateBadge, { backgroundColor: colors.accentSoft }]}>
              <Icon name="mask" size={32} color={colors.accentText} />
            </View>
            <Text style={[styles.greeting, { color: colors.text }]} accessibilityRole="header">
              Navigation privée
            </Text>
            <Text style={[styles.privateText, { color: colors.textMuted }]}>
              {privateModeNotice(Platform.OS)}
            </Text>
          </Animated.View>
        ) : (
          <Animated.View entering={entering(0)} style={styles.hero}>
            {options.showClock && (
              <Text style={[styles.time, { color: colors.textMuted }]}>
                {now.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
              </Text>
            )}
            <Text style={[styles.greeting, { color: colors.text }]} accessibilityRole="header">
              {greeting(now.getHours())}
              {name ? `, ${name}` : ""}.
            </Text>
          </Animated.View>
        )}

        <Animated.View entering={entering(1)}>
          <Tap
            accessibilityRole="search"
            accessibilityLabel="Rechercher ou saisir une adresse"
            onPress={onSearch}
            pressScale={0.97}
            style={[styles.search, { backgroundColor: colors.bgElevated, borderColor: colors.border, shadowColor: "#000" }]}
            testID="start-search"
          >
            <Icon name="search" size={20} color={colors.textMuted} />
            <Text style={[styles.searchText, { color: colors.textMuted }]}>Rechercher ou saisir une adresse</Text>
          </Tap>
        </Animated.View>

        {favorites.length > 0 && !isPrivate && (
          <Animated.View entering={entering(2)} style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.textMuted }]} accessibilityRole="header">
              Favoris
            </Text>
            <View style={styles.grid}>
              {favorites.map((bookmark) => (
                <SiteTile
                  key={bookmark.id}
                  url={bookmark.url}
                  title={bookmark.title || displayUrl(bookmark.url)}
                  size={tile}
                  onPress={onOpen}
                  onLongPress={onLongPressSite}
                />
              ))}
            </View>
          </Animated.View>
        )}

        {sites.length > 0 && !isPrivate && (
          <Animated.View entering={entering(3)} style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.textMuted }]} accessibilityRole="header">
              Sites fréquents
            </Text>
            <View style={styles.grid}>
              {sites.map((site) => (
                <SiteTile
                  key={site.url}
                  url={site.url}
                  title={site.title || displayUrl(site.url)}
                  size={tile}
                  onPress={onOpen}
                  onLongPress={onLongPressSite}
                />
              ))}
            </View>
          </Animated.View>
        )}

        {sites.length === 0 && favorites.length === 0 && !isPrivate && (
          <Animated.View entering={entering(2)} style={[styles.tips, { backgroundColor: colors.surface, borderColor: colors.hairline }]}>
            <Tip icon="tabs" text="Balayez la barre d'adresse vers la gauche ou la droite pour changer d'onglet." />
            <Tip icon="layers" text="Balayez-la vers le haut pour voir tous vos onglets et vos espaces." />
            <Tip icon="link" text="Maintenez un lien pour l'ouvrir dans un nouvel onglet, le copier ou le partager." />
          </Animated.View>
        )}
      </ScrollView>
    </View>
  );
});

function Tip({ icon, text }: { icon: "tabs" | "layers" | "link"; text: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.tip}>
      <View style={[styles.tipIcon, { backgroundColor: colors.bgElevated, borderColor: colors.hairline }]}>
        <Icon name={icon} size={20} color={colors.textMuted} />
      </View>
      <Text style={[styles.tipText, { color: colors.textMuted }]}>{text}</Text>
    </View>
  );
}

const SiteTile = memo(function SiteTile({
  url,
  title,
  size,
  onPress,
  onLongPress,
}: {
  url: string;
  title: string;
  size: number;
  onPress: (url: string) => void;
  onLongPress: (url: string, title: string) => void;
}) {
  const { colors } = useTheme();
  return (
    <Tap
      accessibilityRole="link"
      accessibilityLabel={title}
      onPress={() => onPress(url)}
      onLongPress={() => onLongPress(url, title)}
      style={[styles.tile, { width: size }]}
      pressScale={0.92}
    >
      <View style={[styles.tileIcon, { width: size - 16, height: size - 16, backgroundColor: colors.bgElevated, borderColor: colors.hairline }]}>
        <SiteIcon url={url} title={title} size={Math.round((size * 0.42) / 4) * 4} plain />
      </View>
      <Text style={[styles.tileLabel, { color: colors.text }]} numberOfLines={1}>
        {title}
      </Text>
    </Tap>
  );
});

const styles = StyleSheet.create({
  content: { paddingHorizontal: 16, paddingTop: 56, alignItems: "center", gap: 28 },
  hero: { alignItems: "center", gap: 6, maxWidth: 520 },
  time: { fontSize: 15, fontWeight: "600", letterSpacing: 0.5, fontVariant: ["tabular-nums"] },
  greeting: { fontSize: 34, fontWeight: "800", letterSpacing: -0.6, textAlign: "center" },
  privateBadge: { width: 64, height: 64, borderRadius: 32, alignItems: "center", justifyContent: "center", marginBottom: 6 },
  privateText: { fontSize: 15, lineHeight: 21, textAlign: "center", marginTop: 4 },
  search: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    height: 54,
    width: "100%",
    maxWidth: 560,
    minWidth: 300,
    borderRadius: 27,
    paddingHorizontal: 20,
    borderWidth: StyleSheet.hairlineWidth,
    shadowOpacity: 0.1,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  },
  searchText: { fontSize: 16, flex: 1 },
  section: { width: "100%", maxWidth: 640 },
  sectionTitle: { fontSize: 13, fontWeight: "700", letterSpacing: 0.4, textTransform: "uppercase", marginBottom: 12, marginLeft: 4 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  tile: { alignItems: "center", gap: 6 },
  tileIcon: { borderRadius: 20, alignItems: "center", justifyContent: "center", borderWidth: StyleSheet.hairlineWidth },
  tileLabel: { fontSize: 12, fontWeight: "500", maxWidth: "100%" },
  tips: { width: "100%", maxWidth: 560, borderRadius: 22, padding: 16, gap: 14, borderWidth: StyleSheet.hairlineWidth },
  tip: { flexDirection: "row", alignItems: "center", gap: 12 },
  tipIcon: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center", borderWidth: StyleSheet.hairlineWidth },
  tipText: { flex: 1, fontSize: 14, lineHeight: 19 },
});
