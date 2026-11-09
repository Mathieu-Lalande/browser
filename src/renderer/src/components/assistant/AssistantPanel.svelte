<script lang="ts">
  import { t } from "@shared/i18n";
  import {
    ACTION_LABELS,
    assistantModel,
    PRIVACY_NOTICE,
    PRIVATE_NOTICE,
    QUESTION_MAX_LENGTH,
    type AssistantPanelState,
    type AssistantRequest,
  } from "@shared/assistant";
  import type { TabState } from "@shared/types";
  import { tick } from "svelte";
  import { assistantPanel } from "../../lib/assistant.svelte";
  import { api, browser } from "../../lib/browser.svelte";
  import { settings } from "../../lib/settings.svelte";
  import Icon from "../Icon.svelte";
  import Button from "../ui/Button.svelte";
  import Checkbox from "../ui/Checkbox.svelte";
  import EmptyState from "../ui/EmptyState.svelte";
  import IconButton from "../ui/IconButton.svelte";
  import AssistantTurn from "./AssistantTurn.svelte";

  /**
   * The assistant panel next to the page (ADR-044, ADR-010: it narrows the viewport, the page
   * view is native). Quick actions and questions about the tab's page; what each request sends
   * is named before it goes (page and tab titles); the privacy notice comes first (first use, and
   * every private window). Answers stream in; "Arrêter" stops one.
   */
  let { tab, onClose }: { tab: TabState; onClose: () => void } = $props();

  let panel = $state<AssistantPanelState | null>(null);
  let question = $state("");
  let includePage = $state(settings.current.assistant.includePage);
  let message = $state<string | null>(null);
  let list = $state<HTMLElement>();
  let request = 0;

  const readable = $derived(/^https?:/.test(tab.url));
  const compared = $derived(assistantPanel.compare.map((id) => browser.state.tabs.find((entry) => entry.id === id)).filter((entry) => !!entry));
  const pageTitle = $derived(tab.title || tab.url);

  async function refresh(): Promise<void> {
    const id = ++request;
    const next = await api.assistant.state(tab.id).catch(() => null);
    if (id !== request) return;
    const grew = (next?.turns.length ?? 0) !== (panel?.turns.length ?? 0) || next?.running;
    panel = next;
    if (grew) void tick().then(() => list?.scrollTo({ top: list.scrollHeight }));
  }

  $effect(() => {
    void tab.id;
    void tab.url;
    void refresh();
  });
  $effect(() => api.assistant.onChanged((id) => id === tab.id && void refresh()));

  async function send(next: AssistantRequest): Promise<void> {
    message = null;
    const result = await api.assistant.ask(tab.id, next).catch(() => ({ ok: false, message: t("assistantPanel.requestCouldntSent"), needsConsent: false }));
    if (!result.ok && !result.needsConsent) message = result.message;
    await refresh();
  }

  function ask(): void {
    const text = question.trim();
    if (!text) return;
    question = "";
    void send({ action: "ask", question: text, includePage: readable && includePage });
  }

  function compare(): void {
    const tabIds = compared.map((entry) => entry.id);
    assistantPanel.compare = [];
    void send({ action: "compare-tabs", tabIds });
  }

  async function accept(): Promise<void> {
    const result = await api.assistant.accept(tab.id).catch(() => ({ ok: false, message: t("assistantPanel.requestCouldntSent") }));
    message = result.ok ? null : result.message;
    await refresh();
  }

  function onkey(event: KeyboardEvent): void {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      ask();
    }
  }
</script>

<aside class="assistant" aria-label={t("assistantPanel.aiAssistant")} data-testid="assistant-panel">
  <header>
    <Icon name="sparkles" size={16} />
    <h2>{t("assistantPanel.assistant")}</h2>
    {#if panel?.turns.length}
      <IconButton size="sm" icon="trash" iconSize={14} label={t("assistantPanel.newConversation")} onclick={() => api.assistant.clear(tab.id)} />
    {/if}
    <IconButton size="sm" icon="close" iconSize={14} label={t("assistantPanel.closeAssistant")} command="toggle-assistant" onclick={onClose} />
  </header>

  {#if panel && !panel.enabled}
    <EmptyState icon="sparkles" title={t("assistantPanel.assistantTurnedOff")} hint={t("assistantPanel.turnAddAnthropicApi")}>
      {#snippet action()}
        <Button icon="settings" onclick={() => api.omnibox.open("browser://settings#assistant", "new")}>{t("assistantPanel.openSettings")}</Button>
      {/snippet}
    </EmptyState>
  {:else if panel && !panel.configured}
    <EmptyState icon="key" title={t("assistantPanel.apiKeyMissing")} hint={t("assistantPanel.assistantUsesOwnAnthropic")}>
      {#snippet action()}
        <Button icon="settings" onclick={() => api.omnibox.open("browser://settings#assistant/api-key", "new")}>{t("assistantPanel.addKey")}</Button>
      {/snippet}
    </EmptyState>
  {:else if panel}
    {#if panel.needsConsent}
      <div class="notice" role="alert" data-testid="assistant-notice">
        <p><Icon name={panel.isPrivate ? "mask" : "info"} size={14} /> <strong>{panel.isPrivate ? t("assistantPanel.privateWindow") : t("assistantPanel.beforeFirstSend")}</strong></p>
        {#if panel.isPrivate}<p>{PRIVATE_NOTICE}</p>{/if}
        <p>{PRIVACY_NOTICE}</p>
        {#if panel.pending}<p class="pending">{t("assistantPanel.pendingRequest", { pending: panel.pending })}</p>{/if}
        <Button variant="primary" onclick={accept}>{panel.pending ? t("assistantPanel.acceptSend") : t("assistantPanel.accept")}</Button>
      </div>
    {/if}

    <ol class="turns" bind:this={list} aria-live="polite">
      {#each panel.turns as turn (turn.id)}
        <AssistantTurn {turn} tabId={tab.id} onmessage={(text) => (message = text)} />
      {/each}
    </ol>

    {#if message}<p class="hint" role="status">{message}</p>{/if}

    {#if compared.length >= 2}
      <div class="compare" data-testid="assistant-compare">
        <span class="label">{t("assistantPanel.compareTabs", { comparedCount: compared.length })}</span>
        <ul>
          {#each compared as entry (entry.id)}<li>{entry.title || entry.url}</li>{/each}
        </ul>
        <div class="row">
          <Button variant="primary" icon="sparkles" size="sm" onclick={compare} disabled={panel.running}>{t("assistantPanel.compare")}</Button>
          <Button variant="quiet" size="sm" onclick={() => (assistantPanel.compare = [])}>{t("assistantPanel.cancel")}</Button>
        </div>
      </div>
    {/if}

    {#if readable}
      <div class="actions" role="group" aria-label={t("assistantPanel.quickActions")}>
        {#each ["summarize", "key-points", "explain-selection", "translate-selection"] as const as action (action)}
          <button class="chip" disabled={panel.running} onclick={() => send({ action })}>{ACTION_LABELS[action]}</button>
        {/each}
      </div>
    {/if}

    <div class="composer">
      <p class="context" title={tab.url}>
        {#if readable}
          <Checkbox checked={includePage} onchange={(value) => (includePage = value)}>{t("assistantPanel.attachPage", { pageTitle })}</Checkbox>
        {:else}
          {t("assistantPanel.questionsOnlyNoPage")}
        {/if}
      </p>
      <div class="input">
        <textarea
          class="ui-field"
          rows="2"
          maxlength={QUESTION_MAX_LENGTH}
          placeholder={readable ? t("assistantPanel.askQuestionAboutPage") : t("assistantPanel.askQuestion")}
          aria-label={t("assistantPanel.questionAssistant")}
          bind:value={question}
          onkeydown={onkey}
        ></textarea>
        {#if panel.running}
          <IconButton icon="stop-recording" label={t("assistantPanel.stopResponse")} onclick={() => api.assistant.stop(tab.id)} />
        {:else}
          <IconButton icon="send" label={t("assistantPanel.sendQuestion")} disabled={!question.trim()} onclick={ask} />
        {/if}
      </div>
      <p class="foot">{t("assistantPanel.answersMayContainMistakes", { p: assistantModel(panel.model).label })}</p>
    </div>
  {/if}
</aside>

<style>
  .assistant {
    display: flex;
    flex: none;
    flex-direction: column;
    gap: var(--space-3);
    width: 340px;
    min-height: 0;
    padding: var(--space-3);
    border-radius: var(--page-radius, var(--radius-md));
    background: var(--bg-elevated);
    box-shadow: var(--viewport-shadow);
    animation: rise var(--motion-base) var(--ease);
  }
  header {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  h2 {
    flex: 1;
    margin: 0;
    font-size: var(--text-sm);
    font-weight: 600;
  }
  .notice {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3);
    border-radius: var(--radius-md);
    background: var(--surface);
    font-size: var(--text-xs);
    line-height: 1.45;
  }
  .notice p {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-1);
    margin: 0;
  }
  .pending {
    color: var(--text-muted);
  }
  .turns {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: var(--space-3);
    min-height: 0;
    margin: 0;
    padding: 0;
    overflow-y: auto;
    list-style: none;
  }
  .hint,
  .foot,
  .context {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--text-xs);
    line-height: 1.4;
  }
  .context {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .compare {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-2);
    border-radius: var(--radius-md);
    background: var(--surface);
    font-size: var(--text-xs);
  }
  .compare ul {
    margin: 0;
    padding-left: var(--space-4);
  }
  .label {
    color: var(--text-muted);
    font-weight: 600;
  }
  .row,
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
  }
  .chip {
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-pill, 999px);
    background: var(--surface);
    font-size: var(--text-xs);
  }
  .chip:hover:not(:disabled) {
    background: var(--surface-hover);
  }
  .chip:disabled {
    opacity: 0.5;
  }
  .composer {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  .input {
    display: flex;
    align-items: flex-end;
    gap: var(--space-1);
  }
  textarea {
    flex: 1;
    height: auto;
    min-height: 44px;
    resize: none;
    font: inherit;
  }
  @keyframes rise {
    from {
      opacity: 0;
    }
  }
</style>
