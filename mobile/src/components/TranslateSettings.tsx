import { LANGUAGES, normalizeServerUrl, testTranslation, TRANSLATE_PROVIDERS, type TranslateProviderChoice } from "@shared/translate";
import { memo, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { needsKey, providerConfig, translatorFor } from "../lib/translate";
import { useBrowserActions, useBrowserState } from "../state/BrowserProvider";
import { useTheme } from "../state/theme";
import { translateKeys } from "../state/translate";
import { Icon } from "./Icon";
import { Tap } from "./ui";

const CHOICES: { id: TranslateProviderChoice; label: string }[] = [{ id: "none", label: "Désactivée" }, ...TRANSLATE_PROVIDERS];

/**
 * "Traduction" in the settings (ADR-036): the provider (off by default: the page's text is sent to
 * it), its key in `expo-secure-store` (never shown again), the LibreTranslate server, a test, and
 * the target language. Pages are translated from the page menu.
 */
export const TranslateSettings = memo(function TranslateSettings() {
  const { colors, haptic } = useTheme();
  const { settings } = useBrowserState();
  const actions = useBrowserActions();
  const t = settings.translate;
  const provider = t.provider === "none" ? null : t.provider;
  const [hasKey, setHasKey] = useState(false);
  const [key, setKey] = useState("");
  const [server, setServer] = useState(t.libreUrl);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setResult(null);
    setKey("");
    if (provider) translateKeys.get(provider).then((stored) => setHasKey(!!stored), () => setHasKey(false));
  }, [provider]);

  const border = { borderTopColor: colors.hairline, borderTopWidth: StyleSheet.hairlineWidth };

  const saveKey = async (value: string) => {
    if (!provider) return;
    await translateKeys.set(provider, value).catch(() => {});
    setHasKey(!!value.trim());
    setKey("");
    haptic("success");
  };

  const saveServer = () => {
    const url = server.trim() ? normalizeServerUrl(server) : "";
    if (url === null) return setResult({ ok: false, message: "Adresse invalide (http:// ou https://)." });
    actions.updateSettings({ translate: { libreUrl: url } });
    setServer(url);
    setResult({ ok: true, message: "Adresse enregistrée." });
  };

  const test = async () => {
    const config = providerConfig(t, provider ? await translateKeys.get(provider) : "");
    if (!config) return;
    setBusy(true);
    try {
      const sample = await testTranslation(translatorFor(config), t.target || "fr");
      setResult({ ok: true, message: `Fonctionne : « ${sample} »` });
    } catch (error) {
      setResult({ ok: false, message: error instanceof Error ? error.message : "Le test a échoué." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <View>
      <Text style={[styles.intro, { color: colors.textMuted }]}>
        Désactivée par défaut. Pour traduire (menu de la page), le texte de la page est envoyé au service choisi : une confirmation est demandée la
        première fois, et à chaque session pour les onglets privés.
      </Text>
      {CHOICES.map((choice) => (
        <Pressable
          key={choice.id}
          accessibilityRole="radio"
          accessibilityState={{ selected: t.provider === choice.id }}
          onPress={() => actions.updateSettings({ translate: { provider: choice.id } })}
          style={[styles.row, border]}
        >
          <Text style={[styles.label, { color: colors.text }]}>{choice.label}</Text>
          {t.provider === choice.id && <Icon name="check" size={20} color={colors.accentText} strokeWidth={2} />}
        </Pressable>
      ))}
      {provider === "deepl" && (
        <Pressable
          accessibilityRole="switch"
          accessibilityState={{ checked: t.deeplPlan === "pro" }}
          onPress={() => actions.updateSettings({ translate: { deeplPlan: t.deeplPlan === "pro" ? "free" : "pro" } })}
          style={[styles.row, border]}
        >
          <Text style={[styles.label, { color: colors.text }]}>Formule DeepL</Text>
          <Text style={[styles.detail, { color: colors.accentText }]}>{t.deeplPlan === "pro" ? "Pro" : "Free"}</Text>
        </Pressable>
      )}
      {provider === "libretranslate" && (
        <View style={[styles.row, border]}>
          <TextInput
            value={server}
            onChangeText={setServer}
            placeholder="https://serveur-libretranslate"
            placeholderTextColor={colors.textFaint}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            style={[styles.input, { color: colors.text }]}
            accessibilityLabel="Serveur LibreTranslate"
          />
          <Tap accessibilityRole="button" onPress={saveServer} style={styles.action}>
            <Text style={[styles.detail, { color: colors.accentText }]}>Enregistrer</Text>
          </Tap>
        </View>
      )}
      {provider && (
        <View style={[styles.row, border]}>
          <TextInput
            value={key}
            onChangeText={setKey}
            placeholder={hasKey ? "Clé enregistrée (saisir pour remplacer)" : needsKey(provider) ? "Clé d'API" : "Clé d'API (facultative)"}
            placeholderTextColor={colors.textFaint}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            style={[styles.input, { color: colors.text }]}
            accessibilityLabel="Clé d'API"
          />
          {key.trim() ? (
            <Tap accessibilityRole="button" onPress={() => void saveKey(key)} style={styles.action}>
              <Text style={[styles.detail, { color: colors.accentText }]}>Enregistrer</Text>
            </Tap>
          ) : hasKey ? (
            <Tap accessibilityRole="button" accessibilityLabel="Supprimer la clé" onPress={() => void saveKey("")} style={styles.action}>
              <Icon name="trash" size={18} color={colors.textMuted} />
            </Tap>
          ) : null}
        </View>
      )}
      {provider && (
        <Tap accessibilityRole="button" onPress={() => void test()} disabled={busy} style={[styles.row, border]}>
          <Icon name="languages" size={18} color={colors.accentText} />
          <Text style={[styles.label, { color: colors.accentText }]}>Tester le service</Text>
        </Tap>
      )}
      {result && <Text style={[styles.intro, { color: result.ok ? colors.textMuted : colors.danger }]}>{result.message}</Text>}
      <View style={[styles.row, styles.languages, border]}>
        <Text style={[styles.label, { color: colors.text }]}>Traduire vers</Text>
        <View style={styles.chips}>
          {[{ code: "", name: "Langue du téléphone" }, ...LANGUAGES.slice(0, 8)].map((language) => (
            <Tap
              key={language.code}
              accessibilityRole="radio"
              accessibilityState={{ selected: t.target === language.code }}
              onPress={() => actions.updateSettings({ translate: { target: language.code } })}
              style={[styles.chip, { backgroundColor: t.target === language.code ? colors.accent : colors.surface }]}
            >
              <Text style={[styles.detail, { color: t.target === language.code ? "#ffffff" : colors.text }]}>{language.name}</Text>
            </Tap>
          ))}
        </View>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  intro: { paddingHorizontal: 16, paddingVertical: 12, fontSize: 13, lineHeight: 18 },
  row: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingVertical: 10, minHeight: 48 },
  label: { flex: 1, fontSize: 15 },
  detail: { fontSize: 14, fontWeight: "500" },
  input: { flex: 1, fontSize: 15, paddingVertical: 6 },
  action: { paddingHorizontal: 8, paddingVertical: 6 },
  languages: { flexDirection: "column", alignItems: "stretch" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999 },
});
