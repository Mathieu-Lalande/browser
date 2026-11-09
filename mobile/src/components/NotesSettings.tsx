import { memo, useMemo, useState } from "react";
import { Pressable, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { annotatedPages, HIGHLIGHT_SWATCHES, removeHighlight } from "@shared/annotations/model";
import { displayUrl } from "@shared/url";
import { useBrowserActions, useBrowserState } from "../state/BrowserProvider";
import { useTheme } from "../state/theme";
import { Icon } from "./Icon";
import { IconButton } from "./ui";

/**
 * "Notes et surlignages" (ADR-037): every highlight and page note of the phone (made here with
 * "Surligner" in the selection menu, or synced from the desktop when opted in), searched, opened
 * or deleted. Notes are written in the page (a highlight's sheet, or "Note de la page" of the page
 * menu, ADR-050) and shown here.
 */
export const NotesSettings = memo(function NotesSettings({ onOpen }: { onOpen: (url: string) => void }) {
  const { colors, dark } = useTheme();
  const { annotations, settings } = useBrowserState();
  const actions = useBrowserActions();
  const [query, setQuery] = useState("");
  const pages = useMemo(() => annotatedPages(annotations, { query }), [annotations, query]);
  const border = { borderTopColor: colors.hairline, borderTopWidth: StyleSheet.hairlineWidth };

  return (
    <View>
      <Text style={[styles.intro, { color: colors.textMuted }]}>
        Sélectionnez du texte dans une page puis « Surligner ». Touchez un passage surligné pour changer sa couleur, y ajouter une note ou le supprimer ; « Note de la page » est dans le menu de la page.
      </Text>
      <View style={[styles.row, border]}>
        <View style={styles.text}>
          <Text style={[styles.title, { color: colors.text }]}>Synchroniser les notes</Text>
          <Text style={[styles.detail, { color: colors.textMuted }]}>Chiffrées comme le reste ; jamais celles des onglets privés.</Text>
        </View>
        <Switch
          value={settings.annotations.sync}
          onValueChange={(sync) => actions.updateSettings({ annotations: { sync } })}
          trackColor={{ true: colors.accent, false: colors.surfaceActive }}
          thumbColor="#ffffff"
          accessibilityLabel="Synchroniser les notes et surlignages"
        />
      </View>
      {annotations.highlights.length + annotations.notes.length > 0 && (
        <View style={[styles.row, border]}>
          <Icon name="search" size={18} color={colors.textMuted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Rechercher dans les notes"
            placeholderTextColor={colors.textMuted}
            accessibilityLabel="Rechercher dans les notes"
            style={[styles.input, { color: colors.text }]}
            autoCorrect={false}
            autoCapitalize="none"
          />
        </View>
      )}
      {pages.map((page) => (
        <View key={page.url} style={[styles.page, border]}>
          <Pressable onPress={() => onOpen(page.url)} accessibilityRole="link" accessibilityLabel={`Ouvrir ${page.title || displayUrl(page.url)}`}>
            <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>
              {page.title || displayUrl(page.url)}
            </Text>
            <Text style={[styles.detail, { color: colors.textMuted }]} numberOfLines={1}>
              {displayUrl(page.url)}
            </Text>
          </Pressable>
          {page.note && <Text style={[styles.detail, { color: colors.text }]}>{page.note.text}</Text>}
          {page.highlights.map((highlight) => (
            <View key={highlight.id} style={styles.highlight}>
              <View style={[styles.bar, { backgroundColor: HIGHLIGHT_SWATCHES[highlight.color][dark ? "dark" : "light"] }]} />
              <View style={styles.text}>
                <Text style={[styles.quote, { color: colors.text }]}>{highlight.exact}</Text>
                {highlight.note !== "" && <Text style={[styles.detail, { color: colors.textMuted }]}>{highlight.note}</Text>}
              </View>
              <IconButton
                icon="trash"
                label="Supprimer le surlignage"
                size={18}
                color={colors.danger}
                onPress={() => actions.setAnnotations((data) => removeHighlight(data, highlight.id))}
              />
            </View>
          ))}
        </View>
      ))}
      {pages.length === 0 && (
        <View style={[styles.row, border]}>
          <Icon name="highlighter" size={20} color={colors.textMuted} />
          <Text style={[styles.detail, styles.text, { color: colors.textMuted }]}>{query ? "Aucun résultat." : "Aucune note pour l'instant."}</Text>
        </View>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  intro: { paddingHorizontal: 16, paddingVertical: 12, fontSize: 13, lineHeight: 18 },
  row: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingVertical: 10, minHeight: 52 },
  page: { gap: 8, paddingHorizontal: 16, paddingVertical: 12 },
  highlight: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  bar: { width: 4, alignSelf: "stretch", borderRadius: 2 },
  text: { flex: 1, minWidth: 0, gap: 2 },
  title: { fontSize: 15, fontWeight: "600" },
  quote: { fontSize: 15, lineHeight: 21 },
  detail: { fontSize: 13 },
  input: { flex: 1, fontSize: 15, paddingVertical: 6 },
});
