import { READER_THEME_LABELS, readerColors, readingTimeLabel, type ReaderArticle, type ReaderColors } from "@shared/reader";
import { LIMITS, type ReaderFont, type ReaderTheme } from "@shared/settings";
import { memo, useMemo } from "react";
import { Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { readerBlocks, type ReaderBlock, type ReaderSpan } from "../lib/reader";
import { useBrowserActions, useBrowserState } from "../state/BrowserProvider";
import { useTheme } from "../state/theme";
import { IconButton, Tap } from "./ui";

const SERIF = Platform.select({ ios: "Georgia", default: "serif" });
const MONO = Platform.select({ ios: "Menlo", default: "monospace" });
const THEMES: ReaderTheme[] = ["auto", "sepia", "dark"];
const FONTS: { value: ReaderFont; label: string }[] = [
  { value: "serif", label: "Serif" },
  { value: "sans", label: "Sans serif" },
];

interface Props {
  article: ReaderArticle;
  onClose: () => void;
  onOpenLink: (url: string) => void;
}

/**
 * Native reader (ADR-026): the validated article drawn with `Text` (no WebView, no HTML), with
 * the shared reader preferences (font, size, theme; the line length is the screen's).
 */
export const ReaderScreen = memo(function ReaderScreen({ article, onClose, onOpenLink }: Props) {
  const { settings } = useBrowserState();
  const actions = useBrowserActions();
  const { dark } = useTheme();
  const insets = useSafeAreaInsets();
  const prefs = settings.reader;
  const colors = readerColors(prefs.theme, dark);
  const blocks = useMemo(() => readerBlocks(article.content), [article]);
  const family = prefs.font === "serif" ? SERIF : undefined;
  const size = prefs.size;
  const update = (reader: Partial<typeof prefs>) => actions.updateSettings({ reader });

  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.background, paddingTop: insets.top }]} accessibilityViewIsModal>
      <View style={[styles.toolbar, { borderBottomColor: colors.rule }]}>
        <IconButton icon="close" label="Quitter le mode lecture" color={colors.text} onPress={onClose} />
        <View style={styles.spacer} />
        <IconButton icon="textSize" size={16} label="Réduire le texte" color={colors.text} disabled={size <= LIMITS.readerSize.min} onPress={() => update({ size: size - 1 })} />
        <IconButton icon="textSize" size={24} label="Agrandir le texte" color={colors.text} disabled={size >= LIMITS.readerSize.max} onPress={() => update({ size: size + 1 })} />
      </View>
      <View style={[styles.options, { borderBottomColor: colors.rule }]}>
        {FONTS.map((font) => (
          <Chip key={font.value} label={font.label} selected={prefs.font === font.value} colors={colors} onPress={() => update({ font: font.value })} />
        ))}
        <View style={styles.spacer} />
        {THEMES.map((theme) => (
          <Chip key={theme} label={READER_THEME_LABELS[theme]} selected={prefs.theme === theme} colors={colors} onPress={() => update({ theme })} />
        ))}
      </View>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 48 }]}>
        {article.siteName && <Text style={[styles.site, { color: colors.muted }]}>{article.siteName}</Text>}
        <Text accessibilityRole="header" style={[styles.title, { color: colors.text, fontFamily: family, fontSize: size * 1.6, lineHeight: size * 2 }]}>
          {article.title}
        </Text>
        <Text style={[styles.meta, { color: colors.muted }]}>
          {[article.byline, readingTimeLabel(article.minutes)].filter(Boolean).join(" · ")}
        </Text>
        <View style={[styles.rule, { backgroundColor: colors.rule }]} />
        {blocks.map((block, index) => (
          <Block key={index} block={block} colors={colors} family={family} size={size} onOpenLink={onOpenLink} />
        ))}
      </ScrollView>
    </View>
  );
});

function Chip({ label, selected, colors, onPress }: { label: string; selected: boolean; colors: ReaderColors; onPress: () => void }) {
  return (
    <Tap
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.chip, { borderColor: selected ? colors.link : colors.rule }]}
    >
      <Text style={[styles.chipText, { color: colors.text, fontWeight: selected ? "600" : "400" }]}>{label}</Text>
    </Tap>
  );
}

interface BlockProps {
  block: ReaderBlock;
  colors: ReaderColors;
  family: string | undefined;
  size: number;
  onOpenLink: (url: string) => void;
}

function Block({ block, colors, family, size, onOpenLink }: BlockProps) {
  const body = { color: colors.text, fontFamily: family, fontSize: size, lineHeight: Math.round(size * 1.6) };
  const spans = (list: ReaderSpan[]) =>
    list.map((span, index) => (
      <Text
        key={index}
        onPress={span.href ? () => onOpenLink(span.href!) : undefined}
        accessibilityRole={span.href ? "link" : undefined}
        style={[
          span.bold && styles.bold,
          span.italic && styles.italic,
          span.code && { fontFamily: MONO, fontSize: size * 0.9 },
          span.href ? { color: colors.link, textDecorationLine: "underline" } : null,
        ]}
      >
        {span.text}
      </Text>
    ));
  switch (block.kind) {
    case "heading":
      return (
        <Text accessibilityRole="header" style={[body, styles.heading, { fontSize: size * (block.level === 2 ? 1.35 : block.level === 3 ? 1.2 : 1.05), lineHeight: size * 1.8 }]}>
          {spans(block.spans)}
        </Text>
      );
    case "quote":
      return (
        <View style={[styles.quote, { borderLeftColor: colors.rule }]}>
          <Text style={[body, { color: colors.muted }]}>{spans(block.spans)}</Text>
        </View>
      );
    case "caption":
      return <Text style={[body, styles.caption, { color: colors.muted, fontSize: size * 0.85 }]}>{spans(block.spans)}</Text>;
    case "pre":
      return (
        <ScrollView horizontal style={[styles.pre, { backgroundColor: colors.rule }]}>
          <Text style={{ color: colors.text, fontFamily: MONO, fontSize: size * 0.8 }}>{block.text}</Text>
        </ScrollView>
      );
    case "item":
      return (
        <View style={[styles.item, { paddingLeft: 8 + block.depth * 20 }]}>
          <Text style={[body, styles.marker]}>{block.marker}</Text>
          <Text style={[body, styles.flex]}>{spans(block.spans)}</Text>
        </View>
      );
    case "rule":
      return <View style={[styles.rule, { backgroundColor: colors.rule }]} />;
    default:
      return <Text style={[body, styles.paragraph]}>{spans(block.spans)}</Text>;
  }
}

const styles = StyleSheet.create({
  toolbar: { flexDirection: "row", alignItems: "center", paddingHorizontal: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  options: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  spacer: { flex: 1 },
  chip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 14, borderWidth: 1 },
  chipText: { fontSize: 13 },
  content: { paddingHorizontal: 20, paddingTop: 24 },
  site: { fontSize: 12, letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 6 },
  title: { fontWeight: "700", marginBottom: 8 },
  meta: { fontSize: 13 },
  rule: { height: StyleSheet.hairlineWidth, marginVertical: 18 },
  heading: { fontWeight: "700", marginTop: 16, marginBottom: 8 },
  paragraph: { marginBottom: 14 },
  quote: { borderLeftWidth: 3, paddingLeft: 12, marginBottom: 14 },
  caption: { textAlign: "center", fontStyle: "italic", marginBottom: 14 },
  pre: { borderRadius: 6, padding: 10, marginBottom: 14 },
  item: { flexDirection: "row", gap: 8, marginBottom: 6 },
  marker: { minWidth: 18 },
  flex: { flex: 1 },
  bold: { fontWeight: "700" },
  italic: { fontStyle: "italic" },
});
