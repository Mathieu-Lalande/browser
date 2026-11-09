import { t } from "@shared/i18n";
import { memo } from "react";
import { Alert, Pressable, StyleSheet, Switch, Text, View } from "react-native";
import { confirmBoostScript } from "@shared/boosts";
import { useBrowserActions, useBrowserState } from "../state/BrowserProvider";
import { useTheme } from "../state/theme";
import { Icon } from "./Icon";
import { IconButton } from "./ui";

/**
 * "Boosts" in the settings (ADR-029): every boost (made here from the page menu, or synced from
 * the desktop), to switch on/off or delete. Editing CSS, scripts and zaps is done on the desktop.
 */
export const BoostsSettings = memo(function BoostsSettings() {
  const { colors } = useTheme();
  const { boosts } = useBrowserState();
  const actions = useBrowserActions();
  const border = (index: number) => index > 0 && { borderTopColor: colors.hairline, borderTopWidth: StyleSheet.hairlineWidth };

  const remove = (id: string, name: string) =>
    Alert.alert(t("mobile.boostsSettings.deleteBoost", { name }), t("mobile.boostsSettings.willAlsoDeletedFrom"), [
      { text: t("mobile.boostsSettings.cancel"), style: "cancel" },
      { text: t("mobile.boostsSettings.delete"), style: "destructive", onPress: () => actions.setBoosts((list) => list.filter((boost) => boost.id !== id)) },
    ]);

  return (
    <View>
      <Text style={[styles.intro, { color: colors.textMuted }]}>
        {t("mobile.boostsSettings.filtersFontHiddenElements")}
      </Text>
      {boosts.map((boost, index) => (
        <View key={boost.id} style={[styles.row, border(index + 1)]}>
          <View style={styles.text}>
            <Text style={[styles.site, { color: colors.text }]} numberOfLines={1}>
              {boost.name}
            </Text>
            <Text style={[styles.detail, { color: colors.textMuted }]} numberOfLines={1}>
              {boost.match}
              {boost.zaps.length ? t("mobile.boostsSettings.hidden", { zapsCount: boost.zaps.length }) : ""}
              {boost.script.enabled ? " · JavaScript" : ""}
            </Text>
            {boost.script.pending && (
              <View style={styles.pending}>
                <Text style={[styles.detail, styles.text, { color: colors.text }]}>{t("mobile.boostsSettings.scriptReceivedFromAnother")}</Text>
                <Pressable
                  onPress={() => actions.setBoosts((list) => list.map((item) => (item.id === boost.id ? confirmBoostScript(item, Date.now()) : item)))}
                  accessibilityRole="button"
                  accessibilityLabel={t("mobile.boostsSettings.turnScript", { name: boost.name })}
                  hitSlop={8}
                >
                  <Text style={[styles.detail, styles.confirm, { color: colors.accent }]}>{t("mobile.boostsSettings.turn")}</Text>
                </Pressable>
              </View>
            )}
          </View>
          <Switch
            value={boost.enabled}
            onValueChange={(enabled) => actions.setBoosts((list) => list.map((item) => (item.id === boost.id ? { ...item, enabled, updatedAt: Date.now() } : item)))}
            trackColor={{ true: colors.accent, false: colors.surfaceActive }}
            thumbColor="#ffffff"
            accessibilityLabel={`${boost.enabled ? t("mobile.boostsSettings.turnOff") : t("mobile.boostsSettings.turn")} ${boost.name}`}
          />
          <IconButton icon="trash" label={t("mobile.boostsSettings.delete2", { name: boost.name })} size={20} color={colors.danger} onPress={() => remove(boost.id, boost.name)} />
        </View>
      ))}
      {boosts.length === 0 && (
        <View style={[styles.row, border(1)]}>
          <Icon name="rocket" size={20} color={colors.textMuted} />
          <Text style={[styles.detail, styles.text, { color: colors.textMuted }]}>{t("mobile.boostsSettings.noBoosts")}</Text>
        </View>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  intro: { paddingHorizontal: 16, paddingVertical: 12, fontSize: 13, lineHeight: 18 },
  row: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingVertical: 10, minHeight: 52 },
  text: { flex: 1, minWidth: 0, gap: 2 },
  site: { fontSize: 15, fontWeight: "600" },
  detail: { fontSize: 13 },
  pending: { flexDirection: "row", alignItems: "center", gap: 8 },
  confirm: { fontWeight: "600" },
});
