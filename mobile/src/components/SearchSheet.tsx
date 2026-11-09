import { t as tr, t } from "@shared/i18n";
import { highlightSegments, type Range } from "@shared/fuzzy";
import { searchEngineOf } from "@shared/settings";
import { memo, useDeferredValue, useMemo, useRef, useState, type ComponentRef } from "react";
import { Platform, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import Animated from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { isBookmarked } from "../lib/bookmarks";
import { focusOnFirstLayout } from "../lib/focus";
import { buildSheet, itemUrl, mobileAction, type SheetItem } from "../lib/searchSheet";
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
  const { colors, dark, isPrivate } = useTheme();
  const { model, bookmarks, settings, sync } = useBrowserState();
  const history = useHistoryEntries();
  const insets = useSafeAreaInsets();
  const [text, setText] = useState(initialText);
  const query = useDeferredValue(text);
  const input = useRef<ComponentRef<typeof TextInput> | null>(null);
  const engine = searchEngineOf(settings);
  // Focused after the first layout (not autoFocus while mounting): see focusOnFirstLayout.
  const [onFieldLayout] = useState(() => focusOnFirstLayout(() => input.current?.focus()));

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
      spaceCount: model.spaces.length,
      isPrivate,
    });
  }, [model, bookmarks, history, query, initialText, engine, isPrivate, sync]);

  return (
    <Animated.View
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
                    first={index === 0}
                    onPick={(picked) => {
                      // A scope row or Tab-like completion stays in the sheet.
                      if (picked.action.type === "scope") setText(picked.completion ?? "");
                      else onPick(picked);
                    }}
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
          style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 10), borderTopColor: colors.hairline, backgroundColor: colors.bgElevated }]}
        >
          <View style={[styles.field, { backgroundColor: dark ? "rgba(255,255,255,0.08)" : "rgba(20,16,40,0.06)" }]} onLayout={onFieldLayout}>
            <Icon name={isPrivate ? "mask" : "search"} size={20} color={colors.accentText} />
            <TextInput
              ref={input}
              value={text}
              onChangeText={setText}
              selectTextOnFocus
              placeholder={t("mobile.searchSheet.searchEnterAddress")}
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
              accessibilityLabel={t("mobile.searchSheet.addressSearch")}
              testID="search-input"
            />
            {text.length > 0 && (
              <Tap accessibilityRole="button" accessibilityLabel={t("mobile.searchSheet.clear")} onPress={() => setText("")} style={styles.clear} pressScale={0.85}>
                <View style={[styles.clearDot, { backgroundColor: colors.textFaint }]}>
                  <Icon name="close" size={12} color={colors.bg} strokeWidth={2} />
                </View>
              </Tap>
            )}
          </View>
          <Tap accessibilityRole="button" onPress={onClose} style={styles.cancel} pressScale={0.92} hitSlop={8}>
            <Text style={[styles.cancelText, { color: colors.accentText }]}>{t("mobile.searchSheet.cancel")}</Text>
          </Tap>
        </Animated.View>
      </KeyboardAvoidingView>
    </Animated.View>
  );
});

function iconFor(item: SheetItem): IconName {
  const { action } = item;
  if (action.type === "command") return COMMAND_ICONS[action.command.icon] ?? "command";
  if (action.type === "custom") return (mobileAction(action.id)?.icon ?? "command") as IconName;
  return OMNIBOX_ICONS[item.icon] ?? "globe";
}

/** The shared bar's semantic icons, as the phone's names. */
const OMNIBOX_ICONS: Partial<Record<SheetItem["icon"], IconName>> = {
  search: "search",
  globe: "globe",
  calculator: "calculator",
  ruler: "ruler",
  clock: "clock",
  binary: "binary",
  star: "star",
  bookmark: "star",
  history: "clock",
  settings: "settings",
  cloud: "cloud",
  archive: "archive",
  tab: "tabs",
  command: "command",
  highlighter: "highlighter",
  at: "atSign",
};

const Row = memo(function Row({ item, first, onPick, onFill }: { item: SheetItem; first: boolean; onPick: (item: SheetItem) => void; onFill: (value: string) => void }) {
  const { colors } = useTheme();
  const label = item.title;
  const answer = item.section === "answer";
  const accent = answer || item.section === "go" || item.section === "web";
  const siteUrl = item.action.type === "tab" ? (item.completion ?? null) : item.icon === "cloud" || item.favicon !== undefined ? itemUrl(item) : null;
  const fillValue = item.section === "bookmarks" || item.section === "history" ? itemUrl(item) : null;
  const badge = item.section === "tabs" ? t("mobile.searchSheet.tab") : item.section === "bookmarks" ? tr("mobile.searchSheet.bookmark") : answer ? t("mobile.searchSheet.copy") : null;
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
          <View style={[styles.glyph, { backgroundColor: accent ? colors.accentSoft : colors.surface }]}>
            <Icon name={iconFor(item)} size={20} color={accent ? colors.accentText : colors.text} />
          </View>
        )}
      </View>
      <View style={styles.rowText}>
        {answer && item.detail ? <Text style={[styles.rowDetail, { color: colors.textMuted }]}>{item.detail}</Text> : null}
        <Highlighted text={label} ranges={item.titleRanges} style={[answer ? styles.answerTitle : styles.rowTitle, { color: colors.text }]} />
        {item.detail && !answer ? <Highlighted text={item.detail} ranges={item.detailRanges} style={[styles.rowDetail, { color: colors.textMuted }]} /> : null}
      </View>
      {badge && (
        <Text style={[styles.badge, { color: colors.textMuted, backgroundColor: colors.surface }]} allowFontScaling={false}>
          {badge}
        </Text>
      )}
      {fillValue && (
        <Tap accessibilityRole="button" accessibilityLabel={t("mobile.searchSheet.editAddress")} onPress={() => onFill(fillValue)} style={styles.fill} pressScale={0.85}>
          <Icon name="fill" size={20} color={colors.textFaint} />
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
  answerTitle: { fontSize: 24, fontWeight: "700", fontVariant: ["tabular-nums"] },
  badge: { fontSize: 11, fontWeight: "600", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, overflow: "hidden", marginRight: 6 },
  fill: { width: 40, height: 44, alignItems: "center", justifyContent: "center" },
  bar: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth },
  field: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", height: 48, borderRadius: 16, paddingLeft: 14, gap: 8 },
  // A placeholder too long for a narrow phone ends with an ellipsis (native fields truncate on their own).
  input: { flex: 1, minWidth: 0, fontSize: 17, height: 48, paddingVertical: 0, ...(Platform.OS === "web" ? ({ outlineStyle: "none", textOverflow: "ellipsis" } as object) : {}) },
  clear: { width: 40, height: 44, alignItems: "center", justifyContent: "center" },
  clearDot: { width: 18, height: 18, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  cancel: { height: 44, paddingHorizontal: 8, justifyContent: "center" },
  cancelText: { fontSize: 16, fontWeight: "600" },
});
