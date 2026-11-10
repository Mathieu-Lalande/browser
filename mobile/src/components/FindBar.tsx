import { t } from "@shared/i18n";
import { memo, useEffect, useRef, useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { FindResult, FindStep } from "../lib/findInPage";
import { useTheme } from "../state/theme";
import { IconButton } from "./ui";

/** Typing pause before the page is searched again. */
const SEARCH_DELAY_MS = 250;

interface Props {
  result: FindResult | null;
  onSearch: (query: string) => void;
  onStep: (direction: FindStep) => void;
  onClose: () => void;
}

/**
 * "Rechercher dans la page" (ADR-055): a bar above the keyboard, in place of the toolbar. Typing
 * searches (after a short pause), Enter or the arrows move between matches, the cross clears the
 * marks. No animation: it appears and leaves at once.
 */
export const FindBar = memo(function FindBar({ result, onSearch, onStep, onClose }: Props) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const change = (text: string) => {
    setQuery(text);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => onSearch(text), SEARCH_DELAY_MS);
  };

  const hasMatches = !!result && result.total > 0;
  const status = !query.trim() || !result ? "" : hasMatches ? t("mobile.findBar.count", { current: result.current, total: result.total }) : t("mobile.findBar.noMatch");

  return (
    <KeyboardAvoidingView behavior="padding" style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <View style={styles.spacer} pointerEvents="none" />
      <View style={[styles.bar, { backgroundColor: colors.bgElevated, borderTopColor: colors.hairline, paddingBottom: Math.max(insets.bottom, 8) }]} testID="find-bar">
        <TextInput
          value={query}
          onChangeText={change}
          onSubmitEditing={() => hasMatches && onStep("next")}
          placeholder={t("mobile.findBar.placeholder")}
          placeholderTextColor={colors.textMuted}
          accessibilityLabel={t("mobile.findBar.placeholder")}
          autoFocus
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          submitBehavior="submit"
          style={[styles.input, { color: colors.text, backgroundColor: colors.surface }]}
        />
        <Text style={[styles.count, { color: colors.textMuted }]} accessibilityLiveRegion="polite" numberOfLines={1}>
          {status}
        </Text>
        <IconButton icon="chevronUp" size={22} label={t("mobile.findBar.previous")} disabled={!hasMatches} onPress={() => onStep("previous")} />
        <IconButton icon="chevronDown" size={22} label={t("mobile.findBar.next")} disabled={!hasMatches} onPress={() => onStep("next")} />
        <IconButton icon="close" size={20} label={t("mobile.findBar.close")} color={colors.textMuted} onPress={onClose} />
      </View>
    </KeyboardAvoidingView>
  );
});

const styles = StyleSheet.create({
  spacer: { flex: 1 },
  bar: { flexDirection: "row", alignItems: "center", gap: 4, paddingTop: 8, paddingHorizontal: 8, borderTopWidth: StyleSheet.hairlineWidth },
  input: { flex: 1, height: 40, borderRadius: 12, paddingHorizontal: 12, fontSize: 16 },
  count: { minWidth: 56, fontSize: 13, textAlign: "center", fontVariant: ["tabular-nums"] },
});
