import { t } from "@shared/i18n";
import { ASSISTANT_MODELS, PRIVACY_NOTICE } from "@shared/assistant";
import { memo, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { errorMessage, testClaude } from "../lib/assistantClient";
import { useBrowserActions, useBrowserState } from "../state/BrowserProvider";
import { assistantKey } from "../state/assistant";
import { useTheme } from "../state/theme";
import { Icon } from "./Icon";
import { Tap } from "./ui";

/**
 * "Assistant IA" in the settings (ADR-044): off by default; the user's Anthropic API key in
 * `expo-secure-store` (never synced, never shown again), the model, a test. Used from the page menu.
 */
export const AssistantSettings = memo(function AssistantSettings() {
  const { colors, haptic } = useTheme();
  const { settings } = useBrowserState();
  const actions = useBrowserActions();
  const a = settings.assistant;
  const [hasKey, setHasKey] = useState(false);
  const [key, setKey] = useState("");
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  useEffect(() => {
    assistantKey.get().then((stored) => setHasKey(!!stored), () => setHasKey(false));
  }, []);

  const border = { borderTopColor: colors.hairline, borderTopWidth: StyleSheet.hairlineWidth };

  const saveKey = async (value: string) => {
    await assistantKey.set(value).catch(() => {});
    setHasKey(!!value.trim());
    setKey("");
    haptic("success");
  };

  const test = async () => {
    try {
      await testClaude(await assistantKey.get(), a.model);
      setResult({ ok: true, message: t("mobile.assistantSettings.worksKeyAccepted") });
    } catch (error) {
      setResult({ ok: false, message: errorMessage(error) });
    }
  };

  return (
    <View>
      <Text style={[styles.intro, { color: colors.textMuted }]}>{t("mobile.assistantSettings.offDefault")} {PRIVACY_NOTICE()}</Text>
      <Pressable
        accessibilityRole="switch"
        accessibilityState={{ checked: a.enabled }}
        onPress={() => actions.updateSettings({ assistant: { enabled: !a.enabled } })}
        style={[styles.row, border]}
      >
        <Text style={[styles.label, { color: colors.text }]}>{t("mobile.assistantSettings.turnAssistant")}</Text>
        <Text style={[styles.detail, { color: colors.accentText }]}>{a.enabled ? t("mobile.assistantSettings.on") : t("mobile.assistantSettings.off")}</Text>
      </Pressable>
      <View style={[styles.row, border]}>
        <TextInput
          value={key}
          onChangeText={setKey}
          placeholder={hasKey ? t("mobile.assistantSettings.keySavedTypeReplace") : t("mobile.assistantSettings.anthropicApiKey")}
          placeholderTextColor={colors.textFaint}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          style={[styles.input, { color: colors.text }]}
          accessibilityLabel={t("mobile.assistantSettings.anthropicApiKey")}
        />
        {key.trim() ? (
          <Tap accessibilityRole="button" onPress={() => void saveKey(key)} style={styles.action}>
            <Text style={[styles.detail, { color: colors.accentText }]}>{t("mobile.assistantSettings.save")}</Text>
          </Tap>
        ) : hasKey ? (
          <Tap accessibilityRole="button" accessibilityLabel={t("mobile.assistantSettings.deleteKey")} onPress={() => void saveKey("")} style={styles.action}>
            <Icon name="trash" size={18} color={colors.textMuted} />
          </Tap>
        ) : null}
      </View>
      {ASSISTANT_MODELS.map((model) => (
        <Pressable
          key={model.id}
          accessibilityRole="radio"
          accessibilityState={{ selected: a.model === model.id }}
          onPress={() => actions.updateSettings({ assistant: { model: model.id } })}
          style={[styles.row, border]}
        >
          <View style={styles.label}>
            <Text style={{ color: colors.text, fontSize: 15 }}>{model.label}</Text>
            <Text style={{ color: colors.textMuted, fontSize: 12 }}>{model.hint}</Text>
          </View>
          {a.model === model.id && <Icon name="check" size={20} color={colors.accentText} strokeWidth={2} />}
        </Pressable>
      ))}
      {hasKey && (
        <Tap accessibilityRole="button" onPress={() => void test()} style={[styles.row, border]}>
          <Icon name="sparkles" size={18} color={colors.accentText} />
          <Text style={[styles.label, { color: colors.accentText }]}>{t("mobile.assistantSettings.testKey")}</Text>
        </Tap>
      )}
      {result && <Text style={[styles.intro, { color: result.ok ? colors.textMuted : colors.danger }]}>{result.message}</Text>}
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
});
