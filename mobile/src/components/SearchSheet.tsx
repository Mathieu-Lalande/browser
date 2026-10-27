import { commandLabel } from "@shared/commands";
import { highlightSegments, type Range } from "@shared/fuzzy";
import { searchEngineOf } from "@shared/settings";
import { memo, useDeferredValue, useMemo, useRef, useState, type ComponentRef } from "react";
import { Platform, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import Animated, { FadeIn, FadeOut, SlideInDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { isBookmarked } from "../lib/bookmarks";
import { buildSheet, type SheetItem } from "../lib/searchSheet";
import { activeTab, orderedTabs, toTabState } from "../lib/tabs";
import { useBrowserState, useHistoryEntries } from "../state/BrowserProvider";
import { useTheme } from "../state/theme";
import { COMMAND_ICONS, Icon, type IconName } from "./Icon";
import { SiteIcon, Tap } from "./ui";

interface Props {
  /** Prefilled text (the current URL), selected so typing replaces it. */
  initialText: string;
  onSubmit: (text: string) => void;
  onPick: (item: SheetItem) => void;
  onClose: () => void;
}

/**
 * Full-screen search: the field sits at the bottom, right above the keyboard (thumb zone), and
 * results grow upwards from it. Suggestions are the shared palette's: open tabs (fuzzy),
 * bookmarks + history (frecency), actions from the command registry.
 */
export const SearchSheet = memo(function SearchSheet({ initialText, onSubmit, onPick, onClose }: Props) {
  const { colors, dark, isPrivate, reduceMotion } = useTheme();
  const { model, bookmarks, settings, sync } = useBrowserState();
  const history = useHistoryEntries();
  const insets = useSafeAreaInsets();
  const [text, setText] = useState(initialText);
  const query = useDeferredValue(text);
  const input = useRef<ComponentRef<typeof TextInput> | null>(null);
  const engine = searchEngineOf(settings);

  const sections = useMemo(() => {
    const current = activeTab(model);
    const tabs = orderedTabs(model).map((tab) => toTabState(tab, isBookmarked(bookmarks, tab.url)));
    const activeState = current ? toTabState(current, isBookmarked(bookmarks, current.url)) : undefined;
    // The prefilled URL is not a query: show the "empty" sheet until the user types.
    const effective = query === initialText ? "" : query;
    return buildSheet({
      query: effective,
      tabs,
      activeTabId: current?.id ?? null,
      // Private tabs never look into history.
      history: isPrivate ? [] : history,
      bookmarks,
      engine,
      context: { activeTab: activeState },
      now: Date.now(),
      remoteTabs: isPrivate ? [] : (sync?.devices ?? []).flatMap((device) => device.tabs.map((tab) => ({ device: device.name, url: tab.url, title: tab.title }))),
    });
  }, [model, bookmarks, history, query, initialText, engine, isPrivate, sync]);

  const activeState = useMemo(() => {
    const current = activeTab(model);
    return current ? toTabState(current, isBookmarked(bookmarks, current.url)) : undefined;
  }, [model, bookmarks]);

  return (
    <Animated.View
      entering={FadeIn.duration(reduceMotion ? 80 : 160)}
      exiting={FadeOut.duration(120)}
      style={[StyleSheet.absoluteFill, { backgroundColor: colors.bg }]}
      accessibilityViewIsModal
    >
      <KeyboardAvoidingView style={[styles.flex, { paddingTop: insets.top }]} behavior="padding">
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.results}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator={false}
        >
          {sections.map((section) => (
            <View key={section.id} style={styles.section}>
              {section.title && (
                <Text style={[styles.sectionTitle, { color: colors.textMuted }]} accessibilityRole="header">
                  {section.title}
                </Text>
              )}
              <View style={[styles.card, { backgroundColor: colors.bgElevated, borderColor: colors.hairline }]}>
                {section.items.map((item, index) => (
                  <Row
                    key={item.key}
                    item={item}
                    label={item.kind === "command" ? commandLabel(item.command, { activeTab: activeState }) : item.title}
                    first={index === 0}
                    onPick={onPick}
                    onFill={(value) => {
                      setText(value);
                      input.current?.focus();
                    }}
                  />
                ))}
              </View>
            </View>
          ))}
        </ScrollView>

        <Animated.View
          entering={reduceMotion ? undefined : SlideInDown.springify().damping(24).stiffness(280)}
          style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 10), borderTopColor: colors.hairline, backgroundColor: colors.bgElevated }]}
        >
          <View style={[styles.field, { backgroundColor: dark ? "rgba(255,255,255,0.08)" : "rgba(20,16,40,0.06)" }]}>
            <Icon name={isPrivate ? "mask" : "search"} size={18} color={colors.accentText} />
            <TextInput
              ref={input}
              value={text}
              onChangeText={setText}
              autoFocus
              selectTextOnFocus
              placeholder={`Rechercher avec ${engine.name} ou saisir une adresse`}
              placeholderTextColor={colors.textFaint}
              style={[styles.input, { color: colors.text }]}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="off"
              spellCheck={false}
              keyboardType={Platform.OS === "ios" ? "web-search" : "default"}
              returnKeyType="go"
              enterKeyHint="go"
              submitBehavior="blurAndSubmit"
              keyboardAppearance={dark ? "dark" : "light"}
              selectionColor={colors.accent}
              onSubmitEditing={() => onSubmit(text)}
              accessibilityLabel="Adresse ou recherche"
              testID="search-input"
            />
            {text.length > 0 && (
              <Tap accessibilityRole="button" accessibilityLabel="Effacer" onPress={() => setText("")} style={styles.clear} pressScale={0.85}>
                <View style={[styles.clearDot, { backgroundColor: colors.textFaint }]}>
                  <Icon name="close" size={11} color={colors.bg} strokeWidth={3} />
                </View>
              </Tap>
            )}
          </View>
          <Tap accessibilityRole="button" onPress={onClose} style={styles.cancel} pressScale={0.92}>
            <Text style={[styles.cancelText, { color: colors.accentText }]}>Annuler</Text>
          </Tap>
        </Animated.View>
      </KeyboardAvoidingView>
    </Animated.View>
  );
});

function iconFor(item: SheetItem): IconName {
  switch (item.kind) {
    case "command":
      return COMMAND_ICONS[item.command.icon] ?? "command";
    case "action":
      return item.action.icon as IconName;
    case "search":
      return "search";
    case "remote":
      return "cloud";
    case "navigate":
      return "globe";
    default:
      return "globe";
  }
}

const Row = memo(function Row({
  item,
  label,
  first,
  onPick,
  onFill,
}: {
  item: SheetItem;
  label: string;
  first: boolean;
  onPick: (item: SheetItem) => void;
  onFill: (value: string) => void;
}) {
  const { colors } = useTheme();
  const siteUrl = item.kind === "tab" ? item.tab.url : item.kind === "bookmark" || item.kind === "history" || item.kind === "remote" ? item.url : null;
  const fillValue = item.kind === "bookmark" || item.kind === "history" ? item.url : null;
  const badge = item.kind === "tab" ? "Onglet" : item.kind === "bookmark" ? "Favori" : null;
  return (
    <Tap
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => onPick(item)}
      pressScale={0.985}
      style={[styles.row, !first && { borderTopColor: colors.hairline, borderTopWidth: StyleSheet.hairlineWidth }]}
    >
      <View style={styles.rowIcon}>
        {siteUrl !== null ? (
          <SiteIcon url={siteUrl} title={item.title} size={28} />
        ) : (
          <View style={[styles.glyph, { backgroundColor: item.kind === "navigate" || item.kind === "search" ? colors.accentSoft : colors.surface }]}>
            <Icon name={iconFor(item)} size={17} color={item.kind === "navigate" || item.kind === "search" ? colors.accentText : colors.text} />
          </View>
        )}
      </View>
      <View style={styles.rowText}>
        <Highlighted text={label} ranges={item.kind === "command" && label !== item.title ? [] : item.titleRanges} style={[styles.rowTitle, { color: colors.text }]} />
        {item.detail ? <Highlighted text={item.detail} ranges={item.detailRanges} style={[styles.rowDetail, { color: colors.textMuted }]} /> : null}
      </View>
      {badge && (
        <Text style={[styles.badge, { color: colors.textMuted, backgroundColor: colors.surface }]} allowFontScaling={false}>
          {badge}
        </Text>
      )}
      {fillValue && (
        <Tap accessibilityRole="button" accessibilityLabel="Modifier cette adresse" onPress={() => onFill(fillValue)} style={styles.fill} pressScale={0.85}>
          <Icon name="fill" size={18} color={colors.textFaint} />
        </Tap>
      )}
    </Tap>
  );
});

function Highlighted({ text, ranges, style }: { text: string; ranges: Range[]; style: object }) {
  const { colors } = useTheme();
  if (!ranges.length) {
    return (
      <Text style={style} numberOfLines={1}>
        {text}
      </Text>
    );
  }
  return (
    <Text style={style} numberOfLines={1}>
      {highlightSegments(text, ranges).map((segment, index) =>
        segment.match ? (
          <Text key={index} style={{ color: colors.accentText, fontWeight: "700" }}>
            {segment.text}
          </Text>
        ) : (
          segment.text
        ),
      )}
    </Text>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  results: { flexGrow: 1, justifyContent: "flex-end", paddingHorizontal: 12, paddingTop: 16, paddingBottom: 8, gap: 16 },
  section: { gap: 6 },
  sectionTitle: { fontSize: 13, fontWeight: "700", letterSpacing: 0.4, textTransform: "uppercase", marginLeft: 8 },
  card: { borderRadius: 18, overflow: "hidden", borderWidth: StyleSheet.hairlineWidth },
  row: { flexDirection: "row", alignItems: "center", minHeight: 56, paddingLeft: 12, paddingRight: 6, gap: 12 },
  rowIcon: { width: 30, alignItems: "center" },
  glyph: { width: 30, height: 30, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  rowText: { flex: 1, paddingVertical: 9, gap: 1 },
  rowTitle: { fontSize: 16, fontWeight: "500" },
  rowDetail: { fontSize: 13 },
  badge: { fontSize: 11, fontWeight: "600", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, overflow: "hidden", marginRight: 6 },
  fill: { width: 40, height: 44, alignItems: "center", justifyContent: "center" },
  bar: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth },
  field: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", height: 48, borderRadius: 16, paddingLeft: 14, gap: 8 },
  input: { flex: 1, minWidth: 0, fontSize: 17, height: 48, paddingVertical: 0, ...(Platform.OS === "web" ? ({ outlineStyle: "none" } as object) : {}) },
  clear: { width: 40, height: 44, alignItems: "center", justifyContent: "center" },
  clearDot: { width: 18, height: 18, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  cancel: { height: 44, paddingHorizontal: 8, justifyContent: "center" },
  cancelText: { fontSize: 16, fontWeight: "600" },
});
