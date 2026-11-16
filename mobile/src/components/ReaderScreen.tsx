import { intlLocale, t as tr, t } from "@shared/i18n";
import { SPEECH_RATES, speechRateLabel } from "@shared/read-aloud";
import { READER_THEME_LABELS, readerColors, readingTimeLabel, type ReaderArticle, type ReaderColors } from "@shared/reader";
import { LIMITS, type ReaderFont, type ReaderTheme } from "@shared/settings";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { StatusBar } from "expo-status-bar";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Image, Platform, ScrollView, StyleSheet, Text, View, type LayoutChangeEvent, type ScrollViewInstance } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useReadAloud } from "../hooks/useReadAloud";
import { readerBlocks, type ReaderBlock, type ReaderSpan } from "../lib/reader";
import { speechBlocks } from "../lib/readAloud";
import { useBrowserActions, useBrowserState } from "../state/BrowserProvider";
import { useTheme } from "../state/theme";
import { IconButton, Tap } from "./ui";

const SERIF = Platform.select({ ios: "Georgia", default: "serif" });
const MONO = Platform.select({ ios: "Menlo", default: "monospace" });
const THEMES: ReaderTheme[] = ["auto", "sepia", "dark"];
const FONTS: { value: ReaderFont; label: string }[] = [
  { value: "serif", label: "Serif" },
  { value: "sans", get label() { return tr("mobile.readerScreen.sansSerif") } },
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
  const { dark, reduceMotion } = useTheme();
  const insets = useSafeAreaInsets();
  const prefs = settings.reader;
  const colors = readerColors(prefs.theme, dark);
  const blocks = useMemo(() => readerBlocks(article.content), [article]);
  const family = prefs.font === "serif" ? SERIF : undefined;
  const update = (reader: Partial<typeof prefs>) => actions.updateSettings({ reader });

  // Read aloud and presentation mode (ADR-058).
  const paragraphs = useMemo(() => speechBlocks(article.title, blocks), [article.title, blocks]);
  const speech = useReadAloud({ paragraphs, articleLang: article.lang, rate: prefs.speechRate, voiceId: prefs.voice });
  const [presenting, setPresenting] = useState(false);
  const [controlsShown, setControlsShown] = useState(true);
  const size = presenting ? prefs.presentationSize : prefs.size;
  const scroll = useRef<ScrollViewInstance>(null);
  const offsets = useRef(new Map<string, number>());
  const playing = speech.status === "playing";
  const reading = speech.status !== "idle";

  // The screen stays on while presenting.
  useEffect(() => {
    if (!presenting) return;
    void activateKeepAwakeAsync("reader-presentation").catch(() => {});
    return () => void deactivateKeepAwake("reader-presentation").catch(() => {});
  }, [presenting]);

  // The block read aloud is kept in view (no glide with reduced motion).
  useEffect(() => {
    const y = speech.activeKey ? offsets.current.get(speech.activeKey) : undefined;
    if (y !== undefined) scroll.current?.scrollTo({ y: Math.max(0, y - 96), animated: !reduceMotion });
  }, [speech.activeKey, reduceMotion]);

  const remember = (key: string) => (event: LayoutChangeEvent) => offsets.current.set(key, event.nativeEvent.layout.y);
  const cycleRate = () => update({ speechRate: SPEECH_RATES[(SPEECH_RATES.indexOf(prefs.speechRate as (typeof SPEECH_RATES)[number]) + 1) % SPEECH_RATES.length] });
  const cycleVoice = () => {
    const index = speech.voices.findIndex((voice) => voice.id === speech.voice?.id);
    const next = speech.voices[(index + 1) % speech.voices.length];
    if (next) update({ voice: next.id });
  };
  const highlight = { backgroundColor: `${colors.link}22`, borderRadius: 6 };

  const speechBar = (
    <View style={[styles.speech, { borderTopColor: colors.rule, paddingBottom: presenting ? 8 : insets.bottom + 4 }]} accessibilityLabel={t("readAloud.controls")}>
      <IconButton
        icon={playing ? "pause" : reading ? "play" : "headphones"}
        label={playing ? t("readAloud.pause") : reading ? t("readAloud.resume") : t("readAloud.readAloud")}
        color={colors.text}
        onPress={playing ? speech.pause : speech.play}
        testID="read-aloud-play"
      />
      {reading && (
        <>
          <IconButton icon="skipBack" size={20} label={t("readAloud.previous")} color={colors.text} onPress={() => speech.step(-1)} />
          <IconButton icon="skipForward" size={20} label={t("readAloud.next")} color={colors.text} onPress={() => speech.step(1)} />
          <IconButton icon="stopSquare" size={18} label={t("readAloud.stop")} color={colors.text} onPress={speech.stop} />
        </>
      )}
      <View style={styles.spacer} />
      <Chip label={speechRateLabel(prefs.speechRate, intlLocale())} accessibilityLabel={t("readAloud.speed")} selected={false} colors={colors} onPress={cycleRate} />
      {speech.voices.length > 1 && (
        <Chip label={speech.voice?.name ?? t("readAloud.defaultVoice")} accessibilityLabel={t("readAloud.voice")} selected={false} colors={colors} onPress={cycleVoice} />
      )}
    </View>
  );

  if (presenting) {
    return (
      <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.background }]} accessibilityViewIsModal accessibilityLabel={t("presentation.enter")}>
        <StatusBar hidden />
        <ScrollView
          ref={scroll}
          bounces={false}
          overScrollMode="never"
          contentContainerStyle={[styles.content, styles.presentContent, { paddingTop: insets.top + 32, paddingBottom: insets.bottom + 160 }]}
          onTouchEnd={() => setControlsShown((shown) => !shown)}
        >
          <Text
            accessibilityRole="header"
            onLayout={remember("title")}
            style={[styles.title, { color: colors.text, fontFamily: family, fontSize: size * 1.5, lineHeight: size * 1.9 }, speech.activeKey === "title" && highlight]}
          >
            {article.title}
          </Text>
          {blocks.map((block, index) => (
            <View key={index} onLayout={remember(String(index))} style={speech.activeKey === String(index) ? highlight : undefined}>
              <Block block={block} colors={colors} family={family} size={size} onOpenLink={onOpenLink} />
            </View>
          ))}
        </ScrollView>
        {controlsShown && (
          <View style={[styles.presentBar, { backgroundColor: colors.background, borderTopColor: colors.rule, paddingBottom: insets.bottom }]}>
            <View style={styles.presentRow}>
              <IconButton icon="close" label={t("presentation.exit")} color={colors.text} onPress={() => setPresenting(false)} testID="presentation-exit" />
              <View style={styles.spacer} />
              <IconButton icon="textSize" size={16} label={t("readerView.smallerText")} color={colors.text} disabled={size <= LIMITS.readerPresentationSize.min} onPress={() => update({ presentationSize: size - 2 })} />
              <IconButton icon="textSize" size={24} label={t("readerView.largerText")} color={colors.text} disabled={size >= LIMITS.readerPresentationSize.max} onPress={() => update({ presentationSize: size + 2 })} />
              {THEMES.map((theme) => (
                <Chip key={theme} label={READER_THEME_LABELS[theme]} selected={prefs.theme === theme} colors={colors} onPress={() => update({ theme })} />
              ))}
            </View>
            {speechBar}
          </View>
        )}
      </View>
    );
  }

  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.background, paddingTop: insets.top }]} accessibilityViewIsModal>
      <View style={[styles.toolbar, { borderBottomColor: colors.rule }]}>
        <IconButton icon="close" label={t("mobile.readerScreen.exitReaderMode")} color={colors.text} onPress={onClose} />
        <View style={styles.spacer} />
        <IconButton
          icon="presentation"
          label={t("presentation.enter")}
          color={colors.text}
          onPress={() => {
            setControlsShown(true);
            setPresenting(true);
          }}
          testID="presentation-enter"
        />
        <IconButton icon="textSize" size={16} label={t("mobile.readerScreen.smallerText")} color={colors.text} disabled={size <= LIMITS.readerSize.min} onPress={() => update({ size: size - 1 })} />
        <IconButton icon="textSize" size={24} label={t("mobile.readerScreen.largerText")} color={colors.text} disabled={size >= LIMITS.readerSize.max} onPress={() => update({ size: size + 1 })} />
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
      <ScrollView ref={scroll} bounces={false} overScrollMode="never" contentContainerStyle={[styles.content, { paddingBottom: 48 }]}>
        {article.siteName && <Text style={[styles.site, { color: colors.muted }]}>{article.siteName}</Text>}
        <Text
          accessibilityRole="header"
          onLayout={remember("title")}
          style={[styles.title, { color: colors.text, fontFamily: family, fontSize: size * 1.6, lineHeight: size * 2 }, speech.activeKey === "title" && highlight]}
        >
          {article.title}
        </Text>
        <Text style={[styles.meta, { color: colors.muted }]}>
          {[article.byline, readingTimeLabel(article.minutes)].filter(Boolean).join(" · ")}
        </Text>
        <View style={[styles.rule, { backgroundColor: colors.rule }]} />
        {blocks.map((block, index) => (
          <View key={index} onLayout={remember(String(index))} style={speech.activeKey === String(index) ? highlight : undefined}>
            <Block block={block} colors={colors} family={family} size={size} onOpenLink={onOpenLink} />
          </View>
        ))}
      </ScrollView>
      {speechBar}
    </View>
  );
});

function Chip({ label, selected, colors, onPress, accessibilityLabel }: { label: string; selected: boolean; colors: ReaderColors; onPress: () => void; accessibilityLabel?: string }) {
  return (
    <Tap
      accessibilityRole={accessibilityLabel ? "button" : "radio"}
      accessibilityLabel={accessibilityLabel ? `${accessibilityLabel}, ${label}` : undefined}
      accessibilityState={accessibilityLabel ? undefined : { selected }}
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
    case "image":
      return <ReaderImage src={block.src} alt={block.alt} />;
    default:
      return <Text style={[body, styles.paragraph]}>{spans(block.spans)}</Text>;
  }
}

/** An inlined (`data:`) article image at the column's width, keeping its proportions. */
function ReaderImage({ src, alt }: { src: string; alt: string }) {
  const [ratio, setRatio] = useState<number | null>(null);
  useEffect(() => {
    let live = true;
    Image.getSize(src, (width, height) => live && width > 0 && height > 0 && setRatio(width / height), () => {});
    return () => {
      live = false;
    };
  }, [src]);
  if (!ratio) return null;
  return <Image source={{ uri: src }} style={[styles.image, { aspectRatio: ratio }]} resizeMode="contain" accessible={!!alt} accessibilityLabel={alt || undefined} />;
}

const styles = StyleSheet.create({
  image: { width: "100%", borderRadius: 6, marginBottom: 14 },
  toolbar: { flexDirection: "row", alignItems: "center", paddingHorizontal: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  options: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  spacer: { flex: 1 },
  speech: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingTop: 4, borderTopWidth: StyleSheet.hairlineWidth },
  presentContent: { paddingHorizontal: 28 },
  presentBar: { position: "absolute", left: 0, right: 0, bottom: 0, borderTopWidth: StyleSheet.hairlineWidth },
  presentRow: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 8, paddingTop: 4 },
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
