<script lang="ts">
  import { markdownToNodes, type AssistantTurnView } from "@shared/assistant";
  import { api } from "../../lib/browser.svelte";
  import Icon from "../Icon.svelte";
  import IconButton from "../ui/IconButton.svelte";
  import ReaderNodes from "../reader/ReaderNodes.svelte";

  /**
   * One turn of the conversation (ADR-044). The user's: what was asked and which pages went with
   * it. The assistant's: its Markdown drawn as a sanitized reader tree (never as HTML), then
   * "Copier" and "Ajouter aux notes" once it is written.
   */
  let { turn, tabId, onmessage }: { turn: AssistantTurnView; tabId: string; onmessage: (text: string) => void } = $props();

  const nodes = $derived(turn.role === "assistant" ? markdownToNodes(turn.text) : []);
  const streaming = $derived(turn.status === "streaming");
  const STATUS: Partial<Record<NonNullable<AssistantTurnView["status"]>, string>> = { stopped: "Réponse arrêtée." };

  async function insertNote(): Promise<void> {
    const result = await api.assistant.insertNote(tabId, turn.id).catch(() => ({ ok: false, message: "La note n'a pas été enregistrée." }));
    onmessage(result.message);
  }
</script>

{#if turn.role === "user"}
  <li class="user" data-testid="assistant-question">
    <p class="asked">{turn.text}</p>
    {#if turn.reusedContext}
      <p class="sent">Page déjà envoyée plus haut</p>
    {:else if turn.sent?.length}
      <p class="sent">
        Envoyé à Anthropic :
        {#each turn.sent as source, index (index)}{index ? ", " : " "}<span class:empty={source.empty} title={source.url}
            >{source.title || source.url}{source.truncated && !source.empty ? " (tronqué)" : ""}{source.empty ? " (illisible, non envoyé)" : ""}</span
          >{/each}
      </p>
    {/if}
  </li>
{:else}
  <li class="answer" aria-busy={streaming} data-testid="assistant-answer" data-status={turn.status}>
    {#if turn.text}
      <div class="markdown"><ReaderNodes {nodes} onlink={(href) => api.tabs.create(href)} /></div>
    {:else if streaming}
      <p class="muted"><Icon name="sparkles" size={13} /> Réflexion…</p>
    {/if}
    {#if turn.error || STATUS[turn.status!]}
      <p class="status" class:error={turn.status === "error" || turn.status === "refused"} role="status">{turn.error ?? STATUS[turn.status!]}</p>
    {/if}
    {#if !streaming && turn.text.trim()}
      <div class="tools">
        <IconButton size="row" icon="copy-text" iconSize={13} label="Copier la réponse" onclick={() => (api.assistant.copy(tabId, turn.id), onmessage("Réponse copiée."))} />
        <IconButton size="row" icon="notebook-pen" iconSize={13} label="Ajouter aux notes de la page" onclick={insertNote} />
      </div>
    {/if}
  </li>
{/if}

<style>
  li {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  .user {
    align-self: flex-end;
    max-width: 90%;
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-md);
    background: color-mix(in srgb, var(--accent) 14%, transparent);
  }
  .asked {
    margin: 0;
    font-size: var(--text-sm);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .sent,
  .muted {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-1);
    margin: 0;
    color: var(--text-muted);
    font-size: var(--text-xs);
  }
  .sent .empty {
    text-decoration: line-through;
  }
  .markdown {
    font-size: var(--text-sm);
    line-height: 1.5;
    overflow-wrap: anywhere;
  }
  .markdown :global(:is(p, ul, ol, pre, blockquote, table)) {
    margin: 0 0 var(--space-2);
  }
  .markdown :global(:is(h2, h3, h4, h5, h6)) {
    margin: var(--space-3) 0 var(--space-1);
    font-size: var(--text-sm);
  }
  .markdown :global(:is(ul, ol)) {
    padding-left: var(--space-5);
  }
  .markdown :global(pre) {
    overflow-x: auto;
    padding: var(--space-2);
    border-radius: var(--radius-sm);
    background: var(--surface);
  }
  .markdown :global(code) {
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: 0.92em;
  }
  .markdown :global(blockquote) {
    padding-left: var(--space-2);
    border-left: 3px solid var(--border);
    color: var(--text-muted);
  }
  .markdown :global(table) {
    display: block;
    overflow-x: auto;
    border-collapse: collapse;
    font-size: var(--text-xs);
  }
  .markdown :global(:is(td, th)) {
    padding: var(--space-1) var(--space-2);
    border: 1px solid var(--border);
    text-align: left;
  }
  .markdown :global(a) {
    color: var(--accent-text);
  }
  .status {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--text-xs);
  }
  .status.error {
    color: var(--danger);
  }
  .tools {
    display: flex;
    gap: var(--space-1);
  }
</style>
