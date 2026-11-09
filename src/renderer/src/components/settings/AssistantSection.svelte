<script lang="ts">
  import { t } from "@shared/i18n";
  import { ASSISTANT_MODELS, PRIVACY_NOTICE, type AssistantKeyStatus, type AssistantModelId } from "@shared/assistant";
  import { api, browser } from "../../lib/browser.svelte";
  import { platform } from "../../lib/platform.svelte";
  import { settings } from "../../lib/settings.svelte";
  import Icon from "../Icon.svelte";
  import Button from "../ui/Button.svelte";
  import IconButton from "../ui/IconButton.svelte";
  import Row from "../ui/Row.svelte";
  import Toggle from "../ui/Toggle.svelte";

  /**
   * "Assistant IA" (ADR-044): off by default; the user's own Anthropic API key (saved by main in
   * the OS keychain, never shown again, never synced), the model, a test, and what is sent.
   */
  const a = $derived(settings.current.assistant);

  let key = $state<AssistantKeyStatus | null>(null);
  let draft = $state("");
  let result = $state<{ ok: boolean; message: string } | null>(null);
  let busy = $state(false);

  const refreshKey = () => api.assistant.key().then((next) => (key = next), () => null);
  $effect(() => void refreshKey());

  async function saveKey(value: string): Promise<void> {
    busy = true;
    result = await api.assistant.setKey(value).catch(() => ({ ok: false, message: t("assistantSection.keyWasntSaved") }));
    busy = false;
    if (result.ok) draft = "";
    await refreshKey();
  }

  async function test(): Promise<void> {
    busy = true;
    result = await api.assistant.test().catch(() => ({ ok: false, message: t("assistantSection.testFailed") }));
    busy = false;
  }
</script>

<Row anchor="enabled" label={t("assistantSection.turnAssistant")} hint={PRIVACY_NOTICE()} keywords={t("assistantSection.aiClaudeAnthropicPrivacy")}>
  <Toggle label={t("assistantSection.turnAssistant")} checked={a.enabled} onchange={(enabled) => settings.update({ assistant: { enabled } })} />
</Row>

<Row
  anchor="api-key"
  label={t("assistantSection.anthropicApiKey")}
  id="assistant-key"
  hint={browser.isPrivate
    ? t("assistantSection.unavailablePrivateBrowsing")
    : key && !key.available
      ? (key.message ?? undefined)
      : key?.set
        ? t("assistantSection.keySavedEncryptedSystem")
        : t("assistantSection.createConsoleAnthropicCom")}
>
  {#if key?.set && !browser.isPrivate}
    <IconButton icon="trash" size="row" label={t("assistantSection.deleteKey")} onclick={() => saveKey("")} />
  {/if}
  <input
    id="assistant-key"
    class="ui-field"
    type="password"
    autocomplete="off"
    spellcheck="false"
    placeholder={key?.set ? "••••••••" : "sk-ant-…"}
    bind:value={draft}
    disabled={browser.isPrivate || key?.available === false}
  />
  <Button onclick={() => saveKey(draft)} disabled={busy || !draft.trim() || browser.isPrivate}>{t("assistantSection.save")}</Button>
</Row>

<Row anchor="model" label={t("assistantSection.model")} id="assistant-model" hint={ASSISTANT_MODELS.find((model) => model.id === a.model)?.hint}>
  <select id="assistant-model" class="ui-field" value={a.model} onchange={(event) => settings.update({ assistant: { model: event.currentTarget.value as AssistantModelId } })}>
    {#each ASSISTANT_MODELS as model (model.id)}
      <option value={model.id}>{model.label}{model.id === "claude-fable-5-1" ? t("assistantSection.morePowerful") : ""}</option>
    {/each}
  </select>
</Row>

<Row anchor="test" label={t("assistantSection.testKey")} hint={t("assistantSection.checksKeyAccessModel")}>
  {#if result}
    <span class="result" class:error={!result.ok} role="status"><Icon name={result.ok ? "check" : "warning"} size={12} /> {result.message}</span>
  {/if}
  <Button icon="sparkles" onclick={test} disabled={busy || !key?.set}>{t("assistantSection.test")}</Button>
</Row>

<Row anchor="include-page" label={t("assistantSection.attachPageQuestions")} hint={t("assistantSection.defaultQuestionAskedPanel")}>
  <Toggle label={t("assistantSection.attachPageQuestions")} checked={a.includePage} onchange={(includePage) => settings.update({ assistant: { includePage } })} />
</Row>

<Row
  anchor="keep"
  label={t("assistantSection.keepConversations")}
  hint={t("assistantSection.defaultTabsConversationErased")}
>
  <Toggle label={t("assistantSection.keepConversations")} checked={a.keepConversations} onchange={(keepConversations) => settings.update({ assistant: { keepConversations } })} />
</Row>

<Row
  anchor="usage"
  label={t("assistantSection.usage")}
  hint={(platform.shortcut("toggle-assistant") ? t("assistantSection.usageShortcut", { shortcut: platform.shortcut("toggle-assistant") }) : "") + t("assistantSection.usageHint")}
>
  <span></span>
</Row>

<style>
  .result {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    max-width: 260px;
    color: var(--text-muted);
    font-size: var(--text-xs);
  }
  .result.error {
    color: var(--danger);
  }
  .ui-field {
    width: 200px;
  }
</style>
