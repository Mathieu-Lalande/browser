import { t } from "@shared/i18n";
import { PRIVACY_NOTICE, PRIVATE_NOTICE, type AssistantTurn } from "@shared/assistant";
import { memo, useState } from "react";
import { ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { AssistantController } from "../hooks/useAssistant";
import { answerBlocks } from "../lib/assistant";
import type { ReaderSpan } from "../lib/reader";
import { useTheme } from "../state/theme";
import { Icon } from "./Icon";
import { IconButton, Tap } from "./ui";

/**
 * The assistant sheet (ADR-044), from the page menu: summarize, key points or a question about
 * the page. The notice comes first; each question shows which page went with it; answers are
 * drawn natively from the sanitized Markdown tree (never as HTML).
 */
export const AssistantSheet = memo(function AssistantSheet({ assistant, includePage }: { assistant: AssistantController; includePage: boolean }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [question, setQuestion] = useState("");

  const spans = (list: ReaderSpan[]) =>
    list.map((span, index) => (
      <Text key={index} style={[span.bold && styles.bold, span.italic && styles.italic, span.code && styles.code, span.href ? { color: colors.accentText } : null]}>
        {span.text}
      </Text>
    ));

  const answer = (turn: AssistantTurn) =>
    answerBlocks(turn.text).map((block, index) => {
      const text = { color: colors.text };
      switch (block.kind) {
        case "heading":
          return <Text key={index} style={[styles.heading, text]}>{spans(block.spans)}</Text>;
        case "item":
          return <Text key={index} style={[styles.body, text, { paddingLeft: 12 * (block.depth + 1) }]}>{block.marker} {spans(block.spans)}</Text>;
        case "pre":
          return <Text key={index} style={[styles.body, styles.code, text]}>{block.text}</Text>;
        case "rule":
          return <View key={index} style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.hairline }} />;
        case "image":
          // Answers never carry inlined images.
          return null;
        default:
          return <Text key={index} style={[styles.body, text]}>{spans(block.spans)}</Text>;
      }
    });

  const ask = () => {
    const text = question.trim();
    if (!text) return;
    setQuestion("");
    assistant.run({ action: "ask", question: text, includePage });
  };

  return (
    <View style={[styles.sheet, { backgroundColor: colors.bgElevated, paddingBottom: insets.bottom + 8, paddingTop: insets.top + 8 }]} accessibilityLabel={t("mobile.assistantSheet.aiAssistant")}>
      <View style={styles.header}>
        <Icon name="sparkles" size={18} color={colors.accentText} />
        <Text style={[styles.title, { color: colors.text }]}>{t("mobile.assistantSheet.assistant")}</Text>
        {assistant.turns.length > 0 && <IconButton icon="trash" label={t("mobile.assistantSheet.newConversation")} onPress={assistant.clear} size={20} />}
        <IconButton icon="close" label={t("mobile.assistantSheet.closeAssistant")} onPress={assistant.close} size={20} />
      </View>
      <ScrollView style={styles.list} contentContainerStyle={styles.content}>
        {assistant.waitingConsent && (
          <View style={[styles.notice, { backgroundColor: colors.surface }]}>
            {assistant.isPrivate && <Text style={[styles.small, { color: colors.text }]}>{PRIVATE_NOTICE}</Text>}
            <Text style={[styles.small, { color: colors.text }]}>{PRIVACY_NOTICE}</Text>
            {assistant.pendingLabel ? <Text style={[styles.small, { color: colors.textMuted }]}>{t("mobile.assistantSheet.pendingRequest")} {assistant.pendingLabel}</Text> : null}
            <Tap accessibilityRole="button" onPress={assistant.accept} style={[styles.button, { backgroundColor: colors.accent }]}>
              <Text style={{ color: colors.onAccent, fontWeight: "600" }}>{t("mobile.assistantSheet.acceptSend")}</Text>
            </Tap>
          </View>
        )}
        {assistant.turns.map((turn) =>
          turn.role === "user" ? (
            <View key={turn.id} style={[styles.question, { backgroundColor: colors.accentSoft }]}>
              <Text style={[styles.body, { color: colors.text }]}>{turn.text}</Text>
              <Text style={[styles.small, { color: colors.textMuted }]}>
                {turn.reusedContext
                  ? t("mobile.assistantSheet.pageAlreadySentAbove")
                  : turn.sent?.length
                    ? `Envoyé à Anthropic : ${turn.sent.map((source) => `${source.title}${source.truncated ? " (tronqué)" : ""}`).join(", ")}`
                    : t("mobile.assistantSheet.withoutPage")}
              </Text>
            </View>
          ) : (
            <View key={turn.id} style={styles.answer}>
              {turn.status === "streaming" && !turn.text ? <Text style={[styles.small, { color: colors.textMuted }]}>{t("mobile.assistantSheet.thinking")}</Text> : answer(turn)}
              {turn.error || turn.status === "stopped" ? (
                <Text style={[styles.small, { color: turn.status === "error" || turn.status === "refused" ? colors.danger : colors.textMuted }]}>
                  {turn.error ?? t("mobile.assistantSheet.responseStopped")}
                </Text>
              ) : null}
            </View>
          ),
        )}
      </ScrollView>
      <View style={styles.actions}>
        {(["summarize", "key-points"] as const).map((action) => (
          <Tap
            key={action}
            accessibilityRole="button"
            disabled={assistant.busy}
            onPress={() => assistant.run({ action, includePage: true })}
            style={[styles.chip, { backgroundColor: colors.surface }]}
          >
            <Text style={{ color: colors.text, fontSize: 13 }}>{action === "summarize" ? t("mobile.assistantSheet.summarizePage") : t("mobile.assistantSheet.keyPoints")}</Text>
          </Tap>
        ))}
      </View>
      <View style={[styles.composer, { borderTopColor: colors.hairline }]}>
        <TextInput
          value={question}
          onChangeText={setQuestion}
          onSubmitEditing={ask}
          placeholder={t("mobile.assistantSheet.askQuestionAboutPage")}
          placeholderTextColor={colors.textFaint}
          returnKeyType="send"
          style={[styles.input, { color: colors.text }]}
          accessibilityLabel={t("mobile.assistantSheet.questionAssistant")}
        />
        {assistant.busy ? (
          <IconButton icon="close" label={t("mobile.assistantSheet.stopResponse")} onPress={assistant.stop} size={22} />
        ) : (
          <IconButton icon="send" label={t("mobile.assistantSheet.sendQuestion")} onPress={ask} disabled={!question.trim()} size={22} />
        )}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  sheet: { flex: 1, paddingHorizontal: 12 },
  header: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 8 },
  title: { flex: 1, fontSize: 17, fontWeight: "600" },
  list: { flex: 1 },
  content: { gap: 12, paddingVertical: 8 },
  notice: { gap: 8, padding: 12, borderRadius: 12 },
  question: { alignSelf: "flex-end", maxWidth: "90%", gap: 4, padding: 10, borderRadius: 12 },
  answer: { gap: 6 },
  heading: { fontSize: 16, fontWeight: "600" },
  body: { fontSize: 15, lineHeight: 21 },
  small: { fontSize: 13, lineHeight: 18 },
  bold: { fontWeight: "700" },
  italic: { fontStyle: "italic" },
  code: { fontFamily: "monospace" },
  button: { alignSelf: "flex-start", paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 6, paddingVertical: 6 },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999 },
  composer: { flexDirection: "row", alignItems: "center", gap: 6, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 6 },
  input: { flex: 1, fontSize: 15, paddingVertical: 8 },
});
