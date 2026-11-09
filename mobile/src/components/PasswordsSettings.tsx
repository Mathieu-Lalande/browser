import { t } from "@shared/i18n";
import { originLabel, searchPasswords, summarize } from "@shared/passwords";
import * as Clipboard from "expo-clipboard";
import { memo, useMemo, useState } from "react";
import { Alert, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { useBrowserActions, useBrowserState } from "../state/BrowserProvider";
import { passwords, usePasswords } from "../state/passwords";
import { useTheme } from "../state/theme";
import { Icon } from "./Icon";
import { IconButton, Tap } from "./ui";

/** Shown passwords stay this long on the clipboard before it is cleared (if unchanged). */
const CLIPBOARD_CLEAR_MS = 30_000;

/**
 * "Mots de passe" in the settings (ADR-025): saved passwords with search, reveal (after a
 * confirmation), copy and delete, and the sites never to ask about.
 */
export const PasswordsSettings = memo(function PasswordsSettings() {
  const { colors, haptic } = useTheme();
  const vault = usePasswords();
  const { settings } = useBrowserState();
  const actions = useBrowserActions();
  const [query, setQuery] = useState("");
  const [revealed, setRevealed] = useState<Record<string, true>>({});
  const shown = useMemo(() => searchPasswords(vault.entries.map(summarize), query), [vault, query]);
  const passwordOf = (id: string) => vault.entries.find((entry) => entry.id === id)?.password ?? "";

  const reveal = (id: string, site: string) =>
    Alert.alert(t("mobile.passwordsSettings.showPassword", { site }), t("mobile.passwordsSettings.makeSureNoOne"), [
      { text: t("mobile.passwordsSettings.cancel"), style: "cancel" },
      { text: t("mobile.passwordsSettings.show"), onPress: () => setRevealed((current) => ({ ...current, [id]: true })) },
    ]);

  const copy = (id: string) => {
    const password = passwordOf(id);
    if (!password) return;
    void Clipboard.setStringAsync(password);
    haptic("success");
    setTimeout(() => {
      Clipboard.getStringAsync().then((text) => text === password && Clipboard.setStringAsync(""), () => {});
    }, CLIPBOARD_CLEAR_MS);
  };

  const remove = (id: string, site: string) =>
    Alert.alert(t("mobile.passwordsSettings.deletePassword", { site }), t("mobile.passwordsSettings.canNoLongerFilled"), [
      { text: t("mobile.passwordsSettings.cancel"), style: "cancel" },
      { text: t("mobile.passwordsSettings.delete"), style: "destructive", onPress: () => void passwords.remove(id) },
    ]);

  // Opt-in (ADR-050): turning it on says plainly who can then read the passwords.
  const setSync = (sync: boolean) => {
    if (!sync) return actions.updateSettings({ passwords: { sync } });
    Alert.alert(
      t("mobile.passwordsSettings.syncPasswords"),
      t("mobile.passwordsSettings.theyAreEndEnd"),
      [
        { text: t("mobile.passwordsSettings.cancel"), style: "cancel" },
        { text: t("mobile.passwordsSettings.turn"), onPress: () => actions.updateSettings({ passwords: { sync: true } }) },
      ],
    );
  };

  const border = (index: number) => index > 0 && { borderTopColor: colors.hairline, borderTopWidth: StyleSheet.hairlineWidth };

  return (
    <View>
      <Text style={[styles.intro, { color: colors.textMuted }]}>
        {t("mobile.passwordsSettings.offeredAfterSignEncrypted")}
      </Text>
      <View style={[styles.row, border(1)]}>
        <View style={styles.text}>
          <Text style={[styles.site, { color: colors.text }]}>{t("mobile.passwordsSettings.syncPasswords2")}</Text>
          <Text style={[styles.detail, { color: colors.textMuted }]}>{t("mobile.passwordsSettings.offDefaultEndEnd")}</Text>
        </View>
        <Switch
          value={settings.passwords.sync}
          onValueChange={setSync}
          trackColor={{ true: colors.accent, false: colors.surfaceActive }}
          thumbColor="#ffffff"
          accessibilityLabel={t("mobile.passwordsSettings.syncPasswords2")}
        />
      </View>
      {vault.entries.length > 0 && (
        <View style={[styles.search, { backgroundColor: colors.surface, borderTopColor: colors.hairline }]}>
          <Icon name="search" size={16} color={colors.textMuted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={t("mobile.passwordsSettings.searchSiteUsername")}
            placeholderTextColor={colors.textFaint}
            style={[styles.searchInput, { color: colors.text }]}
            autoCapitalize="none"
            autoCorrect={false}
            accessibilityLabel={t("mobile.passwordsSettings.searchPasswords")}
          />
        </View>
      )}
      {shown.map((entry, index) => {
        const site = originLabel(entry.origin);
        return (
          <View key={entry.id} style={[styles.row, border(index + 1)]}>
            <View style={styles.text}>
              <Text style={[styles.site, { color: colors.text }]} numberOfLines={1}>
                {site}
              </Text>
              <Text style={[styles.detail, { color: colors.textMuted }]} numberOfLines={1}>
                {entry.username || "Sans identifiant"}
              </Text>
              <Text style={[styles.detail, { color: revealed[entry.id] ? colors.text : colors.textFaint }]} selectable={!!revealed[entry.id]}>
                {revealed[entry.id] ? passwordOf(entry.id) : "••••••••••"}
              </Text>
            </View>
            {revealed[entry.id] ? (
              <IconButton icon="eyeOff" label={t("mobile.passwordsSettings.hidePassword", { site })} size={20} onPress={() => setRevealed(({ [entry.id]: _hidden, ...rest }) => rest)} />
            ) : (
              <IconButton icon="eye" label={t("mobile.passwordsSettings.showPassword2", { site })} size={20} onPress={() => reveal(entry.id, site)} />
            )}
            <IconButton icon="copy" label={t("mobile.passwordsSettings.copyPassword", { site })} size={20} onPress={() => copy(entry.id)} />
            <IconButton icon="trash" label={t("mobile.passwordsSettings.deletePassword2", { site })} size={20} color={colors.danger} onPress={() => remove(entry.id, site)} />
          </View>
        );
      })}
      {vault.entries.length === 0 && (
        <View style={[styles.row, border(1)]}>
          <Icon name="key" size={20} color={colors.textMuted} />
          <Text style={[styles.detail, styles.text, { color: colors.textMuted }]}>{t("mobile.passwordsSettings.noSavedPasswords")}</Text>
        </View>
      )}
      {vault.never.map((origin, index) => (
        <View key={origin} style={[styles.row, border(index + 1)]}>
          <Icon name="ban" size={20} color={colors.textMuted} />
          <View style={styles.text}>
            <Text style={[styles.site, { color: colors.text }]} numberOfLines={1}>
              {originLabel(origin)}
            </Text>
            <Text style={[styles.detail, { color: colors.textMuted }]}>{t("mobile.passwordsSettings.neverSaved")}</Text>
          </View>
          <Tap accessibilityRole="button" accessibilityLabel={t("mobile.passwordsSettings.removeFromList", { p: originLabel(origin) })} onPress={() => void passwords.removeNever(origin)} style={styles.action}>
            <Text style={{ color: colors.accentText }}>{t("mobile.passwordsSettings.remove")}</Text>
          </Tap>
        </View>
      ))}
    </View>
  );
});

const styles = StyleSheet.create({
  intro: { paddingHorizontal: 16, paddingVertical: 12, fontSize: 13, lineHeight: 18 },
  search: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, height: 44, borderTopWidth: StyleSheet.hairlineWidth },
  searchInput: { flex: 1, fontSize: 15 },
  row: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 16, paddingVertical: 10, minHeight: 52 },
  text: { flex: 1, minWidth: 0, gap: 2 },
  site: { fontSize: 15, fontWeight: "600" },
  detail: { fontSize: 13 },
  action: { paddingHorizontal: 8, paddingVertical: 6 },
});
