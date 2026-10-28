import { originLabel, searchPasswords, summarize } from "@shared/passwords";
import * as Clipboard from "expo-clipboard";
import { memo, useMemo, useState } from "react";
import { Alert, StyleSheet, Text, TextInput, View } from "react-native";
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
  const [query, setQuery] = useState("");
  const [revealed, setRevealed] = useState<Record<string, true>>({});
  const shown = useMemo(() => searchPasswords(vault.entries.map(summarize), query), [vault, query]);
  const passwordOf = (id: string) => vault.entries.find((entry) => entry.id === id)?.password ?? "";

  const reveal = (id: string, site: string) =>
    Alert.alert(`Afficher le mot de passe de ${site} ?`, "Assurez-vous que personne ne regarde votre écran.", [
      { text: "Annuler", style: "cancel" },
      { text: "Afficher", onPress: () => setRevealed((current) => ({ ...current, [id]: true })) },
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
    Alert.alert(`Supprimer le mot de passe de ${site} ?`, "Il ne pourra plus être rempli.", [
      { text: "Annuler", style: "cancel" },
      { text: "Supprimer", style: "destructive", onPress: () => void passwords.remove(id) },
    ]);

  const border = (index: number) => index > 0 && { borderTopColor: colors.hairline, borderTopWidth: StyleSheet.hairlineWidth };

  return (
    <View>
      <Text style={[styles.intro, { color: colors.textMuted }]}>
        Proposés après une connexion, chiffrés dans le trousseau du téléphone. Touchez la clé de la barre d'adresse pour remplir un formulaire.
      </Text>
      {vault.entries.length > 0 && (
        <View style={[styles.search, { backgroundColor: colors.surface, borderTopColor: colors.hairline }]}>
          <Icon name="search" size={16} color={colors.textMuted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Rechercher un site ou un identifiant"
            placeholderTextColor={colors.textFaint}
            style={[styles.searchInput, { color: colors.text }]}
            autoCapitalize="none"
            autoCorrect={false}
            accessibilityLabel="Rechercher dans les mots de passe"
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
              <IconButton icon="eyeOff" label={`Masquer le mot de passe de ${site}`} size={20} onPress={() => setRevealed(({ [entry.id]: _hidden, ...rest }) => rest)} />
            ) : (
              <IconButton icon="eye" label={`Afficher le mot de passe de ${site}`} size={20} onPress={() => reveal(entry.id, site)} />
            )}
            <IconButton icon="copy" label={`Copier le mot de passe de ${site}`} size={20} onPress={() => copy(entry.id)} />
            <IconButton icon="trash" label={`Supprimer le mot de passe de ${site}`} size={20} color={colors.danger} onPress={() => remove(entry.id, site)} />
          </View>
        );
      })}
      {vault.entries.length === 0 && (
        <View style={[styles.row, border(1)]}>
          <Icon name="key" size={20} color={colors.textMuted} />
          <Text style={[styles.detail, styles.text, { color: colors.textMuted }]}>Aucun mot de passe enregistré.</Text>
        </View>
      )}
      {vault.never.map((origin, index) => (
        <View key={origin} style={[styles.row, border(index + 1)]}>
          <Icon name="ban" size={20} color={colors.textMuted} />
          <View style={styles.text}>
            <Text style={[styles.site, { color: colors.text }]} numberOfLines={1}>
              {originLabel(origin)}
            </Text>
            <Text style={[styles.detail, { color: colors.textMuted }]}>Jamais enregistré</Text>
          </View>
          <Tap accessibilityRole="button" accessibilityLabel={`Retirer ${originLabel(origin)} de la liste`} onPress={() => void passwords.removeNever(origin)} style={styles.action}>
            <Text style={{ color: colors.accentText }}>Retirer</Text>
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
